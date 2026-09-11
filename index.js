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

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const SESSION_PATH = fs.existsSync('/data') ? '/data/auth_info' : './auth_info';

let sock = null;

function clearSession() {
    try {
        if (fs.existsSync(SESSION_PATH)) {
            fs.rmSync(SESSION_PATH, { recursive: true, force: true });
            console.log("[SYSTEM] ✓ Session cleared.");
        }
    } catch (e) {
        console.error("[ERROR] Clear failed:", e.message);
    }
}

async function startWhatsApp() {
    try {
        console.log("[SYSTEM] Initializing WhatsApp...");
        
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            connectTimeoutMs: 20000,  // Reduced to 20s
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 20000,
            retryRequestDelayMs: 100,
            maxRetries: 3,
            qrTimeout: 60000
        });

        sock.ev.on('creds.update', saveCreds);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.log("[ERROR] Connection timeout 25s exceeded");
                reject(new Error("Connection timeout"));
            }, 25000);

            sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (qr) {
                    console.log("[QR] QR code generated");
                }
                
                if (connection === 'open') {
                    clearTimeout(timeout);
                    console.log('✅ [SUCCESS] WhatsApp Connected!');
                    resolve(sock);
                } else if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log(`[DISCONNECT] Status: ${statusCode}`);

                    if (statusCode === 401 || statusCode === 403) {
                        clearTimeout(timeout);
                        console.log("[AUTH] Session invalid, clearing...");
                        clearSession();
                        reject(new Error("Session invalid"));
                    } else if (statusCode === 428) {
                        clearTimeout(timeout);
                        console.log("[PRECONDITION] WhatsApp verification needed");
                        reject(new Error("WhatsApp verification required - try later"));
                    } else {
                        console.log("[RETRY] Reconnecting in 3s...");
                        setTimeout(() => startWhatsApp().then(resolve).catch(reject), 3000);
                    }
                }
            });
        });
    } catch (err) {
        console.error("[ERROR] Init failed:", err.message);
        throw err;
    }
}

app.get('/get-code', async (req, res) => {
    const timeout = setTimeout(() => {
        console.log("[TIMEOUT] Request exceeded 10s");
        if (!res.headersSent) {
            res.status(504).json({ error: "Timeout - try again" });
        }
    }, 10000);

    try {
        let number = req.query.number;
        if (!number) {
            clearTimeout(timeout);
            return res.status(400).json({ error: "Number required: ?number=923001234567" });
        }

        number = number.replace(/\D/g, '');
        if (number.length < 10) {
            clearTimeout(timeout);
            return res.status(400).json({ error: "Invalid number" });
        }

        console.log(`[REQUEST] Code for ${number}`);

        if (sock?.user) {
            clearTimeout(timeout);
            return res.json({ status: "already_linked", user: sock.user.id });
        }

        if (!sock || sock.ws?.readyState !== 1) {
            console.log("[INIT] Connecting...");
            try {
                await startWhatsApp();
            } catch (err) {
                clearTimeout(timeout);
                console.error("[INIT ERROR]", err.message);
                return res.status(503).json({ 
                    error: err.message,
                    suggestion: "Try /reset endpoint or wait 2 minutes"
                });
            }
        }

        // Wait for ready
        let ready = false;
        for (let i = 0; i < 5; i++) {
            if (sock.ws?.readyState === 1) {
                ready = true;
                break;
            }
            await delay(1000);
        }

        if (ready) {
            await delay(500);
            const code = await Promise.race([
                sock.requestPairingCode(number),
                new Promise((_, rej) => setTimeout(() => rej(new Error("Pairing timeout")), 5000))
            ]);

            clearTimeout(timeout);
            console.log(`✅ Code ready: ${code}`);
            return res.json({ status: "success", code });
        } else {
            throw new Error("Connection not ready");
        }

    } catch (err) {
        clearTimeout(timeout);
        console.error("[ERROR]", err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

app.get('/health', (req, res) => {
    res.json({
        server: "online",
        whatsapp: sock?.user ? "connected" : "disconnected"
    });
});

app.get('/reset', (req, res) => {
    clearSession();
    sock = null;
    console.log("[RESET] Session cleared");
    res.json({ status: "reset" });
});

app.listen(port, "0.0.0.0", () => {
    console.log(`[SERVER] Port ${port}`);
    startWhatsApp().catch(() => {
        console.log("[STARTUP] Will init on first request");
    });
});
