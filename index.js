const { default: makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const express = require("express");
const pino = require("pino");
const QRCode = require("qrcode");

const app = express();
const port = process.env.PORT || 3000;
let sock;
let qrCodeBase64 = "";
let connectionStatus = "DISCONNECTED";

async function connectToWhatsApp() {
    // 💡 Ab hum data '/data' folder mein save karenge jo volume se juda hai
    const { state, saveCreds } = await useMultiFileAuthState('/data/auth_info');
    
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'info' }),
        browser: ["TM Whatsapp Tool", "Chrome", "1.0.0"],
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            QRCode.toDataURL(qr, (err, url) => {
                qrCodeBase64 = url;
                connectionStatus = "WAITING_QR";
            });
        }
        if (connection === 'close') {
            connectionStatus = "DISCONNECTED";
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log("✅ WhatsApp Connected!");
            connectionStatus = "CONNECTED";
            qrCodeBase64 = "";
        }
    });
}

// ... baaqi endpoints (qr, check) wahi rahenge ...

app.get('/qr', (req, res) => {
    if (connectionStatus === "CONNECTED") return res.send("<h1>✅ Connected!</h1>");
    if (!qrCodeBase64) return res.send("<h1>⏳ Loading QR...</h1>");
    res.send(`<img src="${qrCodeBase64}" style="width:300px;">`);
});

app.get('/check', async (req, res) => {
    const number = req.query.number;
    if (!number) return res.json({ error: "No number" });
    if (connectionStatus !== "CONNECTED") return res.json({ error: "Not linked" });
    try {
        const cleanNumber = number.replace(/[^\d]/g, '');
        const [result] = await sock.onWhatsApp(cleanNumber);
        res.json({ exists: !!result?.exists });
    } catch (err) {
        res.json({ error: "Failed" });
    }
});

app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on port ${port}`);
    connectToWhatsApp();
});
