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

// Session folder saaf karne ka function
function clearSession() {
    try {
        if (fs.existsSync(SESSION_PATH)) {
            fs.rmSync(SESSION_PATH, { recursive: true, force: true });
            console.log("[SYSTEM] Invalid session cleared.");
        }
    } catch (e) {
        console.error("[ERROR] Could not clear session:", e.message);
    }
}

async function startWhatsApp() {
    console.log(`[SYSTEM] Starting session at ${SESSION_PATH}...`);
    
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"], // Stable browser for pairing
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`[CONNECTION] Closed. Status: ${statusCode}`);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log("[CRITICAL] Session invalid. Clearing and restarting...");
                clearSession();
                setTimeout(startWhatsApp, 3000);
            } else {
                console.log("[CONNECTION] Reconnecting...");
                setTimeout(startWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ [SUCCESS] WhatsApp Linked!');
        }
    });

    return sock;
}

app.get('/get-code', async (req, res) => {
    let number = req.query.number;
    if (!number) return res.status(400).json({ error: "Number required" });
    number = number.replace(/\D/g, '');

    console.log(`[REQUEST] Pairing code for ${number}`);

    try {
        // Agar socket pehle se linked hai toh error dein
        if (sock?.user) {
            return res.json({ error: "Already linked to " + sock.user.id });
        }

        // Force initialize if needed
        if (!sock || sock.ws?.readyState !== 1) {
            await startWhatsApp();
        }

        // Wait up to 20 seconds for WS to open
        let attempts = 0;
        while (sock.ws?.readyState !== 1 && attempts < 20) {
            await delay(1000);
            attempts++;
        }

        if (sock.ws?.readyState === 1) {
            await delay(2000); // Wait for keys to settle
            const code = await sock.requestPairingCode(number);
            console.log(`[SUCCESS] Generated Code: ${code}`);
            res.json({ code });
        } else {
            res.status(500).json({ error: "Connection Timeout. Please try again." });
        }
    } catch (err) {
        console.error("[ERROR] Failed:", err.message);
        // Agar pairing failed due to closed connection, clear it
        if (err.message.includes("Closed")) {
            sock = null;
        }
        res.status(500).json({ error: err.message });
    }
});

// Route to manually reset session if something goes wrong
app.get('/reset', (req, res) => {
    clearSession();
    sock = null;
    startWhatsApp();
    res.send("Session has been reset.");
});

app.listen(port, "0.0.0.0", () => {
    console.log(`[SERVER] Running on port ${port}`);
    startWhatsApp().catch(console.error);
});
