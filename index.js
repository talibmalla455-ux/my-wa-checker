// TOP PAR YE LINE ADD KI HAI ERROR FIX KARNE KE LIYE
const crypto = require('crypto');
if (!global.crypto) {
    global.crypto = crypto;
}

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
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            printQRInTerminal: false,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ["Ubuntu", "Chrome", "20.0.04"] 
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) connectToWhatsApp();
            } else if (connection === 'open') {
                console.log('WhatsApp Connected Successfully!');
            }
        });

        sock.ev.on('creds.update', saveCreds);
    } catch (e) {
        console.error("Connection Error:", e);
    }
}

app.get('/', (req, res) => {
    res.send('<h1>TK WhatsApp Server is Online!</h1>');
});

app.get('/get-code', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    num = num.replace(/\D/g, '');

    try {
        if (!sock || sock.ws?.readyState !== 1) {
            await connectToWhatsApp();
            await delay(3000);
        }
        
        const code = await sock.requestPairingCode(num);
        res.json({ code: code });
    } catch (err) {
        console.error("Pairing Error:", err);
        res.status(500).json({ error: "Failed to generate code", details: err.message });
    }
});

app.get('/check', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    num = num.replace(/\D/g, '');

    try {
        if (!sock || sock.ws?.readyState !== 1) {
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
