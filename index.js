if (!global.crypto) {
    try { global.crypto = require('crypto'); } catch (e) {}
}

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const express = require("express");
const cors = require("cors");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const SESSION_PATH = fs.existsSync('/data') ? '/data/auth_info' : './auth_info';

let sock = null;
let connectionAttempts = 0;
const MAX_ATTEMPTS = 3;

// Session folder saaf karne ka function
function clearSession() {
    try {
        if (fs.existsSync(SESSION_PATH)) {
            fs.rmSync(SESSION_PATH, { recursive: true, force: true });
            console.log("[SYSTEM] ✓ Session cleared successfully.");
        }
    } catch (e) {
        console.error("[ERROR] Could not clear session:", e.message);
    }
}

async function startWhatsApp() {
    return new Promise(async (resolve, reject) => {
        try {
            console.log(`[SYSTEM] Starting WhatsApp session...`);
            
            const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
            const { version } = await fetchLatestBaileysVersion();

            sock = makeWASocket({
                version,
                auth: state,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                browser: ["Ubuntu", "Chrome", "20.0.04"],
                connectTimeoutMs: 30000,  // Reduced from 60000
                defaultQueryTimeoutMs: 0,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5
            });

            sock.ev.on('creds.update', saveCreds);

            // Connection timeout handler
            const connectionTimeout = setTimeout(() => {
                console.log("[ERROR] Connection took too long, closing...");
                if (sock?.ws) {
                    sock.ws.close();
                }
                reject(new Error("Connection timeout"));
            }, 35000);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === 'close') {
                    clearTimeout(connectionTimeout);
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log(`[CONNECTION] Closed. Status: ${statusCode}`);

                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        console.log("[CRITICAL] Session logged out. Clearing...");
                        clearSession();
                        setTimeout(() => startWhatsApp().catch(console.error), 2000);
                    } else if (statusCode === 408 || statusCode === 429) {
                        console.log("[WARNING] Rate limited or timeout. Retrying in 5s...");
                        setTimeout(() => startWhatsApp().catch(console.error), 5000);
                    } else {
                        console.log("[CONNECTION] Attempting reconnect...");
                        setTimeout(() => startWhatsApp().catch(console.error), 3000);
                    }
                } else if (connection === 'open') {
                    clearTimeout(connectionTimeout);
                    console.log('✅ [SUCCESS] WhatsApp Connected!');
                    resolve(sock);
                }
            });

        } catch (err) {
            console.error("[ERROR] Failed to start:", err.message);
            reject(err);
        }
    });
}

app.get('/get-code', async (req, res) => {
    const requestTimeout = setTimeout(() => {
        console.log("[TIMEOUT] /get-code request exceeded 8 seconds");
        if (!res.headersSent) {
            res.status(504).json({ error: "Request timeout - please try again" });
        }
    }, 8000);

    try {
        let number = req.query.number;
        if (!number) {
            clearTimeout(requestTimeout);
            return res.status(400).json({ error: "Number required (e.g., ?number=923001234567)" });
        }
        number = number.replace(/\D/g, '');

        if (!number || number.length < 10) {
            clearTimeout(requestTimeout);
            return res.status(400).json({ error: "Invalid number format" });
        }

        console.log(`[REQUEST] Pairing code for ${number}`);

        // Check if already linked
        if (sock?.user) {
            clearTimeout(requestTimeout);
            return res.json({ 
                status: "already_linked",
                message: "Already linked to " + sock.user.id 
            });
        }

        // Initialize if needed
        if (!sock || sock.ws?.readyState !== 1) {
            console.log("[SYSTEM] Initializing WhatsApp connection...");
            sock = await Promise.race([
                startWhatsApp(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Init timeout")), 6000)
                )
            ]);
        }

        // Wait max 5 seconds for WS to be ready
        let attempts = 0;
        while (sock.ws?.readyState !== 1 && attempts < 5) {
            await delay(1000);
            attempts++;
        }

        if (sock.ws?.readyState === 1) {
            await delay(1000);
            console.log("[SYSTEM] Requesting pairing code...");
            const code = await Promise.race([
                sock.requestPairingCode(number),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Pairing timeout")), 4000)
                )
            ]);
            
            clearTimeout(requestTimeout);
            console.log(`✅ [SUCCESS] Code generated: ${code}`);
            return res.json({ 
                status: "success",
                code,
                message: "Pairing code generated successfully"
            });
        } else {
            throw new Error("WhatsApp connection not ready");
        }

    } catch (err) {
        clearTimeout(requestTimeout);
        console.error(`❌ [ERROR] ${err.message}`);
        
        if (err.message.includes("Closed") || err.message.includes("timeout")) {
            sock = null;
        }
        
        const statusCode = err.message.includes("timeout") ? 504 : 500;
        if (!res.headersSent) {
            res.status(statusCode).json({ 
                status: "error",
                error: err.message,
                suggestion: "Try again or visit /reset endpoint"
            });
        }
    }
});

// Health check
app.get('/health', (req, res) => {
    const status = {
        server: "running",
        whatsapp: sock?.user ? "connected" : "disconnected",
        sessionPath: SESSION_PATH
    };
    res.json(status);
});

// Manual reset
app.get('/reset', (req, res) => {
    clearSession();
    sock = null;
    console.log("[SYSTEM] Session reset by user request");
    res.json({ 
        status: "reset",
        message: "Session cleared. WhatsApp will reconnect on next request."
    });
});

app.listen(port, "0.0.0.0", () => {
    console.log(`[SERVER] Running on port ${port}`);
    console.log(`[SERVER] Session path: ${SESSION_PATH}`);
    startWhatsApp().catch(err => {
        console.error("[STARTUP] WhatsApp init failed:", err.message);
        console.log("[SYSTEM] Will retry on first request...");
    });
});
