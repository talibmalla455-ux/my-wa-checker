const { default: makeWASocket, useMultiFileAuthState, delay } = require("@whiskeysockets/baileys");
const express = require("express");
const pino = require("pino");
const QRCode = require("qrcode");

const app = express();
const port = process.env.PORT || 3000;
let sock;
let qrCodeBase64 = "";

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            QRCode.toDataURL(qr, (err, url) => {
                qrCodeBase64 = url; // Ye QR code ko image mein badal dega
            });
        }
        if (connection === 'open') {
            console.log("✅ WhatsApp Connected!");
            qrCodeBase64 = "CONNECTED";
        }
    });
}

// 1. QR Code dekhne ke liye endpoint
app.get('/qr', (req, res) => {
    if (qrCodeBase64 === "CONNECTED") return res.send("<h1>Already Connected!</h1>");
    if (!qrCodeBase64) return res.send("<h1>Loading QR... Refresh in 5s</h1>");
    res.send(`<img src="${qrCodeBase64}" style="width:300px;">`);
});

// 2. Number check karne ke liye endpoint
app.get('/check', async (req, res) => {
    const number = req.query.number;
    if (!number) return res.json({ error: "No number provided" });

    try {
        const [result] = await sock.onWhatsApp(number);
        res.json({
            phone: number,
            exists: !!result?.exists
        });
    } catch (err) {
        res.json({ error: "Check failed", details: err.message });
    }
});

app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on port ${port}`);
    connectToWhatsApp();
});