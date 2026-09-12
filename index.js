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

// Volume Setup: /data volume ke andar session folder
const SESSION_PATH = fs.existsSync('/data') ? '/data/session' : './session';
if (!fs.existsSync(SESSION_PATH)) {
    fs.mkdirSync(SESSION_PATH, { recursive: true });
}

let sock = null;
let isConnecting = false;

async function startWhatsApp() {
    if (isConnecting) return;
    isConnecting = true;
    
    console.log(`[SYSTEM] Initializing socket at: ${SESSION_PATH}`);
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
        
        // Version fetch with timeout to prevent hanging
        let version = [2, 3000, 1015901307]; // Fallback version
        try {
            const latest = await fetchLatestBaileysVersion().catch(() => null);
            if (latest) version = latest.version;
        } catch (e) {}

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            console.log(`[CONN] State: ${connection}`);
            
            if (connection === 'open') {
                isConnecting = false;
                console.log('✅ WhatsApp Linked!');
            }
            
            if (connection === 'close') {
                isConnecting = false;
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason !== DisconnectReason.loggedOut) {
                    console.log(`[CONN] Restarting in 5s (Reason: ${reason})...`);
                    setTimeout(startWhatsApp, 5000);
                }
            }
        });
    } catch (err) {
        isConnecting = false;
        console.error("[CRITICAL ERROR]", err);
    }
}

app.get('/get-code', async (req, res) => {
    let number = req.query.number?.replace(/\D/g, '');
    if (!number) return res.status(400).json({ error: "Number required" });

    try {
        // Force initiate connection
        if (!sock || sock.ws?.readyState !== 1) {
            startWhatsApp();
        }

        console.log(`[REQUEST] Waiting for socket readiness for ${number}...`);
        
        let attempts = 0;
        while ((!sock || sock.ws?.readyState !== 1) && attempts < 40) {
            await delay(1000);
            attempts++;
        }

        if (sock && sock.ws?.readyState === 1) {
            await delay(3000);
            const code = await sock.requestPairingCode(number);
            console.log(`[PAIR] SUCCESS: ${code}`);
            res.json({ code });
        } else {
            res.status(503).json({ error: "WhatsApp server is slow. Please try again in a few seconds." });
        }
    } catch (err) {
        console.error("[PAIR ERROR]", err.message);
        res.status(500).json({ error: "Pairing failed. Server busy." });
    }
});

app.get('/', (req, res) => res.send("Stable Server Active"));

app.listen(port, "0.0.0.0", () => {
    console.log(`[SERVER] Port ${port} | Path ${SESSION_PATH}`);
    startWhatsApp();
});
