const { 
    default: makeWASocket, 
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const express = require("express");
const pino = require("pino");
const cors = require("cors");

const app = express();
app.use(cors());
const port = process.env.PORT || 3000;

let sock;

app.get('/', (req, res) => {
    res.send("TK TOOL SERVER IS LIVE! PAIRING MODE ENABLED.");
});

async function connectToWhatsApp() {
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
            console.log('CONNECTED TO WHATSAPP');
        }
    });

    sock.ev.on('creds.update', saveCreds);
    return sock;
}

app.get('/get-code', async (req, res) => {
    // Number ko saaf karna (remove +, spaces, dashes)
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    num = num.replace(/[^0-9]/g, ''); 

    try {
        if (!sock) await connectToWhatsApp();
        
        // Pairing code request
        const code = await sock.requestPairingCode(num);
        res.json({ code: code });
        console.log(`Code generated for: ${num}`);
    } catch (err) {
        console.error("Pairing Error:", err);
        // Asli error dikhane ke liye
        res.status(500).json({ error: err.message || "Failed to generate code" });
    }
});

app.get('/check', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    num = num.replace(/[^0-9]/g, '');

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
