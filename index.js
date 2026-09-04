const { 
    default: makeWASocket, 
    useMultiFileAuthState,
    DisconnectReason
} = require("@whiskeysockets/baileys");
const express = require("express");
const pino = require("pino");
const cors = require("cors");

const app = express();
app.use(cors());
const port = process.env.PORT || 3000;

let sock;

// Ye line "Cannot GET" ko khatam karegi
app.get('/', (req, res) => {
    res.send("TK TOOL SERVER IS LIVE! PAIRING MODE ENABLED.");
});

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        printQRInTerminal: false,
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('CONNECTED TO WHATSAPP');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.get('/get-code', async (req, res) => {
    const num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    try {
        if (!sock) await connectToWhatsApp();
        // Pairing code ki request
        const code = await sock.requestPairingCode(num);
        res.json({ code: code });
    } catch (err) {
        res.status(500).json({ error: "Try again in 60 seconds" });
    }
});

app.get('/check', async (req, res) => {
    const num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    try {
        if (!sock || sock.ws.readyState !== 1) return res.json({ exists: false, error: "Not linked" });
        const [result] = await sock.onWhatsApp(num);
        res.json({ exists: !!(result && result.exists) });
    } catch (err) {
        res.status(500).json({ error: "API Error" });
    }
});

app.listen(port, () => {
    console.log(`Server started on ${port}`);
    connectToWhatsApp();
});
