const { default: makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const express = require("express");
const pino = require("pino");
const fs = require("fs");

const app = express();
const port = process.env.PORT || 3000;

// Global variables taaki session zinda rahe
let sock = null;
let pairingCodeRequested = false;

async function startWhatsApp(phoneNumber = null) {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // Hum pairing code use karenge
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) startWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Linked Successfully!');
            pairingCodeRequested = false;
        }
    });

    return sock;
}

// Pairing Code mangwane ka sahi tareeka
app.get('/get-code', async (req, res) => {
    const number = req.query.number;
    if (!number) return res.status(400).json({ error: "Number required" });

    try {
        // Purana session agar chal raha ho toh initialize karein
        await startWhatsApp();
        
        // Thora intezar karein socket ready hone ka
        await delay(3000);

        if (sock && !sock.authState.creds.registered) {
            const code = await sock.requestPairingCode(number.replace(/\+/g, ''));
            console.log(`Pairing Code for ${number}: ${code}`);
            res.json({ code: code });
        } else {
            res.json({ error: "Already registered or socket not ready" });
        }
    } catch (err) {
        console.error("Pairing Error:", err);
        res.status(500).json({ error: "Failed to get code. Try again." });
    }
});

// Check number status
app.get('/check', async (req, res) => {
    const number = req.query.number;
    if (!sock || !number) return res.status(400).json({ error: "Service not ready" });

    try {
        const [result] = await sock.onWhatsApp(number);
        res.json({ exists: !!result?.exists });
    } catch (err) {
        res.status(500).json({ error: "Check failed" });
    }
});

app.listen(port, "0.0.0.0", () => {
    console.log(`Server is running on port ${port}`);
});
