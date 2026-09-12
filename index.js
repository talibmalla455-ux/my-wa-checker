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

// Volume Path: Persistent storage for Railway
const SESSION_PATH = fs.existsSync('/data') ? '/data' : './session';
let sock = null;
let connectionState = 'closed';

async function startWhatsApp() {
    console.log(`[SYSTEM] Starting session at ${SESSION_PATH}...`);
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    // Reset socket if already exists
    if (sock) {
        sock.ev.removeAllListeners();
        try { sock.ws.close(); } catch(e) {}
    }

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ["Chrome (Linux)", "", ""], // Official pairing format
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        connectionState = connection;
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`[CONN] Closed. Reason: ${reason}`);
            if (reason !== DisconnectReason.loggedOut) {
                console.log("[CONN] Reconnecting...");
                setTimeout(startWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ [SUCCESS] WhatsApp Linked!');
        }
    });

    return sock;
}

// Pairing Endpoint
app.get('/get-code', async (req, res) => {
    let number = req.query.number?.replace(/\D/g, '');
    if (!number) return res.status(400).json({ error: "No number provided" });

    console.log(`[REQUEST] Pairing code for ${number}`);

    try {
        // Force start if not connected
        if (!sock || sock.ws?.readyState !== 1) {
            await startWhatsApp();
        }

        // Wait up to 30 seconds for socket to be ready
        let attempts = 0;
        const maxAttempts = 30;
        
        while ((!sock || sock.ws?.readyState !== 1) && attempts < maxAttempts) {
            await delay(1000);
            attempts++;
            if (attempts % 5 === 0) console.log(`[WAIT] Socket not ready yet... (${attempts}s)`);
        }

        if (sock && sock.ws?.readyState === 1) {
            await delay(2000); // Small buffer for encryption keys
            console.log(`[PAIR] Requesting code for ${number}`);
            const code = await sock.requestPairingCode(number);
            console.log(`[PAIR] SUCCESS: ${code}`);
            res.json({ code });
        } else {
            console.error("[ERROR] Socket initialization failed after 30s");
            res.status(503).json({ error: "Server is taking too long to connect. Please try again in 10 seconds." });
        }
    } catch (err) {
        console.error("[PAIR ERROR]", err.message);
        res.status(500).json({ error: "Pairing failed. Please ensure the number is correct and try again." });
    }
});

app.get('/check', async (req, res) => {
    const number = req.query.number;
    if (!sock?.user) return res.status(400).json({ error: "Not linked" });
    try {
        const [result] = await sock.onWhatsApp(number);
        res.json({ exists: !!result?.exists });
    } catch (err) {
        res.status(500).json({ error: "Check failed" });
    }
});

app.get('/', (req, res) => res.send("WhatsApp Tool Server is Online"));

app.listen(port, "0.0.0.0", () => {
    console.log(`[SERVER] Online on port ${port}`);
    startWhatsApp().catch(console.error);
});
