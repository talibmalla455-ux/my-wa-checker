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

// VOLUME PATH: Agar /data mounted hai toh session wahan store hoga
const SESSION_PATH = fs.existsSync('/data') ? '/data' : './session';
let sock = null;

async function startWhatsApp() {
    console.log(`[SYSTEM] Initializing WhatsApp session at ${SESSION_PATH}...`);
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }), // Silent logs to prevent spam
        printQRInTerminal: false,
        browser: ["Chrome (Linux)", "", ""], // Official pairing format
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`[CONN] Closed. Reason: ${reason}`);
            // Reconnect logic
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(startWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ [SUCCESS] WhatsApp Linked!');
        }
    });

    return sock;
}

// Pairing Endpoint
app.get('/get-code', async (req, res) => {
    const number = req.query.number?.replace(/\D/g, '');
    if (!number) return res.status(400).json({ error: "No number provided" });

    try {
        // Force reset socket if not connected
        if (!sock || sock.ws?.readyState !== 1) {
            await startWhatsApp();
            await delay(5000);
        }

        // Wait up to 15s for readyState
        let attempts = 0;
        while (sock.ws?.readyState !== 1 && attempts < 15) {
            await delay(1000);
            attempts++;
        }

        if (sock.ws?.readyState === 1) {
            await delay(3000); // Wait for keys to settle
            const code = await sock.requestPairingCode(number);
            console.log(`[PAIR] Code generated for ${number}: ${code}`);
            res.json({ code });
        } else {
            res.status(503).json({ error: "Connection Timeout. Try again in 5s." });
        }
    } catch (err) {
        console.error("[PAIR ERROR]", err.message);
        res.status(500).json({ error: "Could not generate code. Please retry." });
    }
});

// Check Number Status
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

app.get('/', (req, res) => res.send("Server is Active"));

app.listen(port, "0.0.0.0", () => {
    console.log(`[SERVER] Online on port ${port}`);
    startWhatsApp().catch(console.error);
});
