const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    delay,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const express = require("express");
const pino = require("pino");
const cors = require("cors");

const app = express();
app.use(cors());
const port = process.env.PORT || 3000;

let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: state,
        logger: pino({ level: 'silent' }),
        // PAIRING CODE KE LIYE YE BROWSER CONFIG ZAROORI HAI
        browser: ["Ubuntu", "Chrome", "20.0.04"] 
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('Successfully connected to WhatsApp!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Pairing Code Endpoint
app.get('/get-code', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });

    // Number cleaning (sirf digits rakhein)
    num = num.replace(/\D/g, '');

    try {
        if (!sock || sock.ws.readyState !== 1) {
            await connectToWhatsApp();
            await delay(3000); // 3 seconds wait socket ready hone ke liye
        }

        // WhatsApp pairing code request
        const code = await sock.requestPairingCode(num);
        res.json({ code: code });
    } catch (err) {
        console.error("Pairing Error:", err);
        res.status(500).json({ error: "Failed to generate code", details: err.message });
    }
});

// Check Endpoint
app.get('/check', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    num = num.replace(/\D/g, '');

    try {
        if (!sock || sock.ws.readyState !== 1) {
            return res.json({ exists: false, error: "WhatsApp not connected" });
        }
        const [result] = await sock.onWhatsApp(num);
        res.json({ exists: result ? result.exists : false });
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    connectToWhatsApp();
});
