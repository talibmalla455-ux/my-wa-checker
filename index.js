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
let isWsReady = false; // Connection status track karne ke liye

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'connecting') {
            isWsReady = false;
            console.log("Connecting to WhatsApp...");
        }

        if (connection === 'open') {
            isWsReady = true;
            console.log('✅ WhatsApp Linked!');
        }

        if (connection === 'close') {
            isWsReady = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startWhatsApp();
        }
        
        // Agar QR ya connecting state mein hai, toh hum messages bhej sakte hain
        // isWsReady ko hum true kar sakte hain agar socket open hai
        if(sock?.ws?.readyState === 1) {
            isWsReady = true;
        }
    });

    return sock;
}

app.get('/get-code', async (req, res) => {
    let number = req.query.number;
    if (!number) return res.status(400).json({ error: "Number required" });
    number = number.replace(/\D/g, '');

    try {
        // Socket initialization agar zarurat ho
        if (!sock) {
            await startWhatsApp();
        }

        // Wait loop: Jab tak connection ready nahi hoti (max 15 seconds)
        let attempts = 0;
        while (!isWsReady && sock?.ws?.readyState !== 1 && attempts < 15) {
            console.log("Waiting for socket to be ready...");
            await delay(1000);
            attempts++;
        }

        if (sock?.ws?.readyState === 1 || isWsReady) {
            console.log(`Requesting code for ${number}...`);
            const code = await sock.requestPairingCode(number);
            res.json({ code });
        } else {
            throw new Error("Connection Timeout: WhatsApp server not responding.");
        }
    } catch (err) {
        console.error("Pairing Error:", err);
        // Agar connection close ho gayi ho toh reset karein
        sock = null; 
        res.status(500).json({ error: err.message || "Connection Closed. Please try again." });
    }
});

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
    console.log(`Server running on port ${port}. Volume: ${SESSION_PATH}`);
    startWhatsApp().catch(console.error);
});
