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

// SESSION PATH: Volume check
const SESSION_PATH = fs.existsSync('/data') ? '/data/session' : './session';
if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });

let sock = null;

async function startWhatsApp() {
    console.log(`[SYSTEM] Attempting Connection at ${SESSION_PATH}...`);
    
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    
    // Static version to avoid network hang during fetch
    const version = [2, 3000, 1015901307];

    if (sock) {
        sock.ev.removeAllListeners();
        try { sock.ws.terminate(); } catch(e) {}
    }

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        // Official Android Identity (Better for pairing)
        browser: ["Android", "Chrome", "11.0.0"], 
        connectTimeoutMs: 90000, // 90 Seconds timeout
        keepAliveIntervalMs: 15000,
        retryRequestDelayMs: 2000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        console.log(`[SOCKET] Current State: ${connection || 'processing'}`);
        
        if (connection === 'open') {
            console.log('✅ [CONNECTED] WhatsApp is fully operational!');
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`[SOCKET] Closed. Reason: ${reason}`);
            if (reason !== DisconnectReason.loggedOut) {
                console.log("[SYSTEM] Retrying in 5s...");
                setTimeout(startWhatsApp, 5000);
            }
        }
    });

    return sock;
}

app.get('/get-code', async (req, res) => {
    let number = req.query.number?.replace(/\D/g, '');
    if (!number) return res.status(400).json({ error: "Number required" });

    console.log(`[REQUEST] Requesting code for ${number}...`);

    try {
        // Start connection if not active
        if (!sock || !sock.ws || sock.ws.readyState !== 1) {
            startWhatsApp();
        }

        // WAIT LOOP: 45 Seconds for Railway environment
        let waitTime = 0;
        while ((!sock.ws || sock.ws.readyState !== 1) && waitTime < 45) {
            await delay(1000);
            waitTime++;
            if (waitTime % 5 === 0) console.log(`[WAIT] Still connecting... (${waitTime}s)`);
        }

        if (sock && sock.ws && sock.ws.readyState === 1) {
            console.log("[SYSTEM] WebSocket Ready! Fetching Code...");
            await delay(3000); // Wait for keys
            const code = await sock.requestPairingCode(number);
            console.log(`[SUCCESS] Pairing Code: ${code}`);
            res.json({ code });
        } else {
            console.error("[ERROR] Connection could not be established in 45s.");
            res.status(503).json({ error: "Railway server is having network issues connecting to WhatsApp. Please try again." });
        }
    } catch (err) {
        console.error("[CRITICAL]", err.message);
        res.status(500).json({ error: "Server Error. Restarting..." });
        sock = null;
    }
});

// Health check
app.get('/', (req, res) => res.send("Stable Server Online"));

// Manual Reset
app.get('/reset', (req, res) => {
    fs.rmSync(SESSION_PATH, { recursive: true, force: true });
    fs.mkdirSync(SESSION_PATH, { recursive: true });
    sock = null;
    startWhatsApp();
    res.send("Session Reset Done.");
});

app.listen(port, "0.0.0.0", () => {
    console.log(`[SERVER] Started on port ${port}`);
    startWhatsApp();
});
