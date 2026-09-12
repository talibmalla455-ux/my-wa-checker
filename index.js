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

// SESSION PATH SETUP
const SESSION_PATH = fs.existsSync('/data') ? '/data/session' : './session';
if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });

let sock = null;

async function startWhatsApp() {
    console.log(`[SYSTEM] Initializing WhatsApp on: ${SESSION_PATH}`);
    
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    if (sock) {
        sock.ev.removeAllListeners();
        try { sock.ws.close(); } catch(e) {}
    }

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ["Chrome (Linux)", "", ""],
        connectTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection) console.log(`[CONN] Status: ${connection}`);
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`[CONN] Closed. Status Code: ${statusCode}`);
            
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log("[SYSTEM] Session expired/invalid. Deleting session...");
                fs.rmSync(SESSION_PATH, { recursive: true, force: true });
                fs.mkdirSync(SESSION_PATH, { recursive: true });
                setTimeout(startWhatsApp, 3000);
            } else {
                setTimeout(startWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ [SUCCESS] Linked to WhatsApp!');
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
        // 1. Restart socket if it's dead
        if (!sock || !sock.ws || sock.ws.readyState !== 1) {
            console.log("[SOCKET] Restarting connection...");
            await startWhatsApp();
            await delay(5000); // Initial wait
        }

        // 2. Wait up to 20s for WebSocket to connect
        let wait = 0;
        while ((!sock.ws || sock.ws.readyState !== 1) && wait < 20) {
            await delay(1000);
            wait++;
        }

        if (sock.ws && sock.ws.readyState === 1) {
            console.log("[PAIR] Socket Ready. Requesting code...");
            await delay(2000);
            const code = await sock.requestPairingCode(number);
            console.log(`[PAIR] SUCCESS: ${code}`);
            res.json({ code });
        } else {
            console.error("[ERROR] WebSocket Timeout");
            res.status(503).json({ error: "WhatsApp server is not responding. Please try again." });
        }
    } catch (err) {
        console.error("[CRITICAL ERROR]", err.message);
        // Force reset on error
        sock = null;
        res.status(500).json({ error: "System Busy. Re-initializing..." });
    }
});

app.get('/reset', (req, res) => {
    console.log("[SYSTEM] Manual reset triggered.");
    fs.rmSync(SESSION_PATH, { recursive: true, force: true });
    fs.mkdirSync(SESSION_PATH, { recursive: true });
    sock = null;
    startWhatsApp();
    res.send("Session folder cleared. Restarting...");
});

app.get('/', (req, res) => res.send("WhatsApp Tool Server is Online"));

app.listen(port, "0.0.0.0", () => {
    console.log(`[SERVER] Online on port ${port}`);
    startWhatsApp().catch(console.error);
});
