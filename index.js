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

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const SESSION_PATH = fs.existsSync('/data') ? '/data/auth_info' : './auth_info';
let sock = null;
let isConnecting = false;

function clearSession() {
 try {
 if (fs.existsSync(SESSION_PATH)) {
 fs.rmSync(SESSION_PATH, { recursive: true, force: true });
 console.log("[✓] Session deleted");
 }
 } catch (e) {
 console.error("[ERROR]", e.message);
 }
}

async function connectSocket() {
 if (isConnecting) {
 console.log("[SKIP] Already connecting...");
 return sock;
 }
 
 isConnecting = true;
 
 try {
 console.log("[START] WhatsApp connection...");
 const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
 const { version } = await fetchLatestBaileysVersion();
 
 sock = makeWASocket({
 version,
 auth: state,
 logger: pino({ level: 'silent' }),
 printQRInTerminal: false,
 browser: ["Ubuntu", "Chrome", "20.0.04"],
 connectTimeoutMs: 30000,
 keepAliveIntervalMs: 20000,
 retryRequestDelayMs: 250,
 shouldIgnoreJid: () => false,
 });
 
 sock.ev.on('creds.update', saveCreds);
 
 sock.ev.on('connection.update', (update) => {
 const { connection, lastDisconnect } = update;
 
 if (connection === 'open') {
 console.log('[✅] CONNECTED');
 isConnecting = false;
 } else if (connection === 'close') {
 const code = lastDisconnect?.error?.output?.statusCode;
 console.log(`[CLOSE] ${code}`);
 
 if (code === 401 || code === 403) {
 clearSession();
 sock = null;
 isConnecting = false;
 } else {
 setTimeout(connectSocket, 5000);
 }
 }
 });
 
 return sock;
 } catch (err) {
 console.error("[ERROR]", err.message);
 isConnecting = false;
 throw err;
 }
}

// Main endpoint
app.get('/get-code', async (req, res) => {
 res.setTimeout(12000);
 
 try {
 const number = (req.query.number || '').replace(/\D/g, '');
 
 if (number.length < 10) {
 return res.status(400).json({ error: "Invalid number" });
 }
 
 console.log(`[GET-CODE] ${number}`);
 
 // Connect
 if (!sock || sock.ws?.readyState !== 1) {
 console.log("[INIT]");
 sock = await Promise.race([
 connectSocket(),
 new Promise((_, reject) => 
 setTimeout(() => reject(new Error("Init timeout")), 10000)
 )
 ]);
 }
 
 // Wait ready
 for (let i = 0; i < 8; i++) {
 if (sock.ws?.readyState === 1) break;
 await delay(500);
 }
 
 // Code
 const code = await Promise.race([
 sock.requestPairingCode(number),
 new Promise((_, reject) => 
 setTimeout(() => reject(new Error("Code timeout")), 8000)
 )
 ]);
 
 console.log(`[✅] ${code}`);
 res.json({ code });
 
 } catch (err) {
 console.error(`[ERROR] ${err.message}`);
 res.status(503).json({ error: err.message });
 }
});

app.get('/reset', (req, res) => {
 clearSession();
 sock = null;
 isConnecting = false;
 console.log("[RESET]");
 res.json({ ok: true });
});

app.listen(port, "0.0.0.0", () => {
 console.log(`[SERVER] ${port}`);
 connectSocket().catch(() => console.log("[READY] Init later"));
});
