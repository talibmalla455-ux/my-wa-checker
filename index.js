// 1. GLOBAL CRYPTO FIX
if (!global.crypto) {
    try {
        global.crypto = require('crypto');
    } catch (e) {
        console.error("Failed to load crypto module");
    }
}

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const express = require("express");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

// Yahan hum check kar rahe hain ke /data folder exist karta hai ya nahi (Volume check)
const SESSION_PATH = fs.existsSync('/data') ? '/data/auth_info' : './auth_info';

let sock = null;

async function startWhatsApp() {
    // Session files ko /data/auth_info folder mein store karega (jo ke aapki Volume hai)
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    console.log(`Starting WhatsApp on ${SESSION_PATH} with version: ${version.join('.')}`);

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
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('Reconnecting...');
                startWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Success: WhatsApp Linked!');
        }
    });

    return sock;
}

app.get('/get-code', async (req, res) => {
    let number = req.query.number;
    if (!number) return res.status(400).json({ error: "Number required" });
    
    number = number.replace(/\D/g, '');

    try {
        // Force restart socket if it's not connected
        if (!sock || !sock.user) {
            await startWhatsApp();
            await delay(5000);
        }

        if (sock) {
            const code = await sock.requestPairingCode(number);
            res.json({ code });
        } else {
            res.status(500).json({ error: "Socket error" });
        }
    } catch (err) {
        console.error("Pairing Error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/check', async (req, res) => {
    const number = req.query.number;
    if (!sock || !sock.user) return res.status(400).json({ error: "Not linked" });

    try {
        const [result] = await sock.onWhatsApp(number);
        res.json({ exists: !!result?.exists });
    } catch (err) {
        res.status(500).json({ error: "Failed" });
    }
});

app.listen(port, "0.0.0.0", () => {
    console.log(`Server started. Volume Path: ${SESSION_PATH}`);
    startWhatsApp().catch(console.error);
});
