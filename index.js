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

function clearSession() {
 try {
 if (fs.existsSync(SESSION_PATH)) {
 fs.rmSync(SESSION_PATH, { recursive: true, force: true });
 console.log("[✓] Session cleared");
 }
 } catch (e) {
 console.error("[ERROR] Clear failed:", e.message);
 }
}

async function initSocket() {
 try {
 console.log("[INIT] Starting WhatsApp socket...");
 
 const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
 const { version } = await fetchLatestBaileysVersion();

 sock = makeWASocket({
 version,
 auth: state,
 logger: pino({ level: 'silent' }),
 printQRInTerminal: false,
 browser: ["Ubuntu", "Chrome", "20.0.04"],
 connectTimeoutMs: 20000,
 defaultQueryTimeoutMs: 60000,
 keepAliveIntervalMs: 15000
 });

 sock.ev.on('creds.update', saveCreds);

 sock.ev.on('connection.update', async (update) => {
 const { connection, lastDisconnect } = update;
 
 if (connection === 'open') {
 console.log('[✅] WhatsApp Connected!');
 } else if (connection === 'close') {
 const code = lastDisconnect?.error?.output?.statusCode;
 console.log(`[CLOSE] Status: ${code}`);
 
 if (code === 401 || code === 403) {
 console.log("[LOGOUT] Invalid session, clearing...");
 clearSession();
 } else if (code === 428) {
 console.log("[WAIT] WhatsApp throttling, wait 2 mins");
 } else {
 console.log("[RECONNECT] In 5s...");
 setTimeout(initSocket, 5000);
 }
 }
 });

 return sock;
 } catch (err) {
 console.error("[ERROR] Socket init:", err.message);
 throw err;
 }
}

app.get('/get-code', async (req, res) => {
 const reqTimeout = setTimeout(() => {
 if (!res.headersSent) {
 res.status(504).json({ error: "Timeout - try again" });
 }
 }, 10000);

 try {
 let number = req.query.number;
 
 if (!number) {
 clearTimeout(reqTimeout);
 return res.status(400).json({ error: "?number=923001234567" });
 }

 // Clean number - sirf digits
 number = number.replace(/\D/g, '');

 if (number.length < 10) {
 clearTimeout(reqTimeout);
 return res.status(400).json({ error: "Invalid number" });
 }

 console.log(`[REQUEST] Pairing code for: ${number}`);

 // Agar pehle se linked hai
 if (sock?.user) {
 clearTimeout(reqTimeout);
 return res.json({ 
 status: "already_linked",
 user: sock.user.id
 });
 }

 // Socket init karo agar nahi hai
 if (!sock) {
 console.log("[CONNECT] Initializing...");
 sock = await initSocket();
 }

 // Wait for connection - max 5 seconds
 let connected = false;
 for (let i = 0; i < 5; i++) {
 if (sock.ws?.readyState === 1) {
 connected = true;
 break;
 }
 await delay(1000);
 }

 if (!connected) {
 throw new Error("Connection timeout - try again");
 }

 // Small delay
 await delay(500);

 // **PAIRING CODE GENERATE KARO**
 console.log("[CODE] Requesting pairing code...");
 const code = await Promise.race([
 sock.requestPairingCode(number),
 new Promise((_, reject) => 
 setTimeout(() => reject(new Error("Code timeout")), 6000)
 )
 ]);

 clearTimeout(reqTimeout);
 console.log(`[✅] Code: ${code}`);

 return res.json({ 
 status: "success",
 code: code,
 number: number,
 message: "Pairing code generated - WhatsApp mein enter karo"
 });

 } catch (err) {
 clearTimeout(reqTimeout);
 console.error("[ERROR]", err.message);

 if (!res.headersSent) {
 res.status(500).json({ 
 error: err.message,
 tip: "Try /reset and wait 2 minutes"
 });
 }
 }
});

app.get('/health', (req, res) => {
 res.json({
 online: true,
 whatsapp: sock?.user ? "connected" : "not_connected"
 });
});

app.get('/reset', (req, res) => {
 clearSession();
 sock = null;
 console.log("[RESET] Session cleared - wait 2 mins");
 res.json({ status: "ok", message: "Wait 2 minutes pehle request karna" });
});

app.listen(port, "0.0.0.0", () => {
 console.log(`[SERVER] http://0.0.0.0:${port}`);
 initSocket().catch(() => {
 console.log("[READY] Init on first request");
 });
});
