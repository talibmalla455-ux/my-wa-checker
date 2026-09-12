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

// Log every request to help debugging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// VOLUME PATH: Direct /data use karein agar exists
const SESSION_PATH = fs.existsSync('/data') ? '/data' : './auth_info';
let sock = null;

async function startWhatsApp() {
    console.log(`[SYSTEM] Starting WhatsApp session at ${SESSION_PATH}...`);
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'info' }), // Detailed logs
        printQRInTerminal: false,
        browser: ["Chrome (Linux)", "", ""], // Official pairing browser format
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log(`[CONN] Reconnecting (Reason: ${reason})...`);
                setTimeout(startWhatsApp, 5000);
            } else {
                console.log("[CONN] Logged out. Clearing /data...");
                if (fs.existsSync(SESSION_PATH + '/creds.json')) fs.unlinkSync(SESSION_PATH + '/creds.json');
                startWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ [SUCCESS] WhatsApp Linked!');
        }
    });

    return sock;
}

// Pairing Endpoint
app.get('/get-code', async (req, res) => {
    let number = req.query.number;
    if (!number) return res.status(400).json({ error: "No number provided" });
    number = number.replace(/\D/g, '');

    try {
        if (!sock || sock.ws?.readyState !== 1) {
            await startWhatsApp();
            await delay(5000);
        }

        // Wait up to 20s for readyState
        let attempts = 0;
        while (sock.ws?.readyState !== 1 && attempts < 20) {
            await delay(1000);
            attempts++;
        }

        if (sock.ws?.readyState === 1) {
            await delay(2000); // Buffer for stability
            const code = await sock.requestPairingCode(number);
            console.log(`[PAIR] Code for ${number}: ${code}`);
            res.json({ code });
        } else {
            res.status(503).json({ error: "Server initializing. Try again in 10s." });
        }
    } catch (err) {
        console.error("[PAIR ERROR]", err.message);
        res.status(500).json({ error: "Pairing failed. Server busy." });
    }
});

// Check Number
app.get('/check', async (req, res) => {
    const number = req.query.number;
    if (!sock?.user) return res.status(400).json({ error: "Server not linked" });
    try {
        const [result] = await sock.onWhatsApp(number);
        res.json({ exists: !!result?.exists });
    } catch (err) {
        res.status(500).json({ error: "Check failed" });
    }
});

app.get('/', (req, res) => res.send("Server is Healthy"));

app.listen(port, "0.0.0.0", () => {
    console.log(`[SERVER] Online on port ${port}`);
    startWhatsApp().catch(console.error);
});
