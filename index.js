const { 
    default: makeWASocket, 
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");
const express = require("express");
const pino = require("pino");
const cors = require("cors");
const fs = require("fs");

const app = express();
app.use(cors());
const port = process.env.PORT || 3000;

let sock;

app.get('/', (req, res) => {
    res.send("TK TOOL SERVER STATUS: ONLINE // PAIRING READY");
});

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        logger: pino({ level: 'silent' }),
        // Modern Browser Identity
        browser: ["TK-TOOL", "Chrome", "128.0.0.0"]
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('--- WHATSAPP CONNECTED SUCCESSFULLY ---');
        }
    });

    sock.ev.on('creds.update', saveCreds);
    return sock;
}

// Pairing Code Endpoint
app.get('/get-code', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    num = num.replace(/[^0-9]/g, ''); 

    try {
        // Purana session agar logged out hai to clear karein
        if (sock) {
            try { sock.logout(); } catch(e) {}
        }
        
        await connectToWhatsApp();
        
        // Thoda intezar taaki socket ready ho jaye
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log(`Requesting code for: ${num}`);
        const code = await sock.requestPairingCode(num);
        res.json({ code: code });
        
    } catch (err) {
        console.error("Critical Pairing Error:", err);
        let msg = "FAILED TO GENERATE CODE";
        if (err.message.includes("429")) msg = "TOO MANY REQUESTS. WAIT 5 MINUTES.";
        if (err.message.includes("not-authorized")) msg = "SESSION ERROR. RESTART RAILWAY.";
        res.status(500).json({ error: msg, detail: err.message });
    }
});

app.get('/check', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    num = num.replace(/[^0-9]/g, '');
    try {
        if (!sock || sock.ws.readyState !== 1) return res.json({ exists: false, error: "Server Not Linked" });
        const [result] = await sock.onWhatsApp(num);
        res.json({ exists: !!(result && result.exists) });
    } catch (err) {
        res.status(500).json({ error: "Check Failed" });
    }
});

app.listen(port, () => {
    console.log(`TK TOOL Server running on port ${port}`);
    connectToWhatsApp();
});
