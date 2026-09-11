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

async function startWhatsApp() {
    console.log(`[SYSTEM] Initializing WhatsApp session at ${SESSION_PATH}...`);
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    // Purane listeners saaf karein agar exist karte hain
    if (sock) {
        sock.ev.removeAllListeners();
        try { sock.ws.close(); } catch(e) {}
    }

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeoutMs: 60000, // Connection timeout barha diya
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`[CONNECTION] Closed. Reason: ${reason}`);
            if (reason !== DisconnectReason.loggedOut) {
                console.log("[CONNECTION] Attempting to reconnect...");
                setTimeout(startWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ [SUCCESS] WhatsApp Connected and Ready!');
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
        // Agar socket nahi hai ya closed hai toh naya banayein
        if (!sock || sock.ws?.readyState !== 1) {
            console.log("[SOCKET] Starting new connection...");
            await startWhatsApp();
        }

        // Wait loop: 30 seconds tak socket open hone ka intezar karein
        let attempts = 0;
        while (sock.ws?.readyState !== 1 && attempts < 30) {
            process.stdout.write("."); // Railway logs mein progress dikhayega
            await delay(1000);
            attempts++;
        }
        console.log(""); // New line after dots

        if (sock.ws?.readyState === 1) {
            console.log("[SOCKET] Ready! Requesting code...");
            // Thora sa extra delay taaki encryption keys stable ho jayein
            await delay(2000);
            const code = await sock.requestPairingCode(number);
            console.log(`[SUCCESS] Code Generated: ${code}`);
            res.json({ code });
        } else {
            throw new Error("WhatsApp connection is still initializing. Please try again in a few seconds.");
        }
    } catch (err) {
        console.error("[ERROR] Pairing Failed:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Check status endpoint
app.get('/check', async (req, res) => {
    const number = req.query.number;
    if (!sock || !sock.user) return res.status(400).json({ error: "Not linked" });
    try {
        const [result] = await sock.onWhatsApp(number);
        res.json({ exists: !!result?.exists });
    } catch (err) {
        res.status(500).json({ error: "Check failed" });
    }
});

app.listen(port, "0.0.0.0", () => {
    console.log(`[SERVER] Online on port ${port}`);
    startWhatsApp().catch(err => console.error("[STARTUP ERROR]", err));
});
