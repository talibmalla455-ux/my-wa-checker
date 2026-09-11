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
let connectionPromise = null;

function clearSession() {
 try {
 if (fs.existsSync(SESSION_PATH)) {
 fs.rmSync(SESSION_PATH, { recursive: true, force: true });
 console.log("[✓] Session deleted");
 }
 } catch (e) {
 console.error("[ERROR] Clear:", e.message);
 }
}

async function initSocket() {
 if (sock) return sock; // Already exists
 if (connectionPromise) return connectionPromise; // Already connecting
 
 connectionPromise = (async () => {
 try {
 console.log("[INIT] Starting WhatsApp...");
 
 const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
 const { version } = await fetchLatestBaileysVersion();
 
 sock = makeWASocket({
 version,
 auth: state,
 logger: pino({ level: 'silent' }),
 printQRInTerminal: false,
 browser: ["Ubuntu", "Chrome", "20.0.04"],
 connectTimeoutMs: 25000,
 keepAliveIntervalMs: 15000,
 });
 
 sock.ev.on('creds.update', saveCreds);
 
 sock.ev.on('connection.update', async (update) => {
 const { connection, lastDisconnect, isNewLogin } = update;
 
 if (connection === 'open') {
 console.log('✅ [LINKED] Success!');
 if (isNewLogin) {
 console.log('[USER]', sock.user.id);
 }
 } 
 
 if (connection === 'close') {
 const code = lastDisconnect?.error?.output?.statusCode;
 console.log(`[CLOSE] Code: ${code}`);
 
 sock = null;
 connectionPromise = null;
 
 if (code !== 401 && code !== 403) {
 // Reconnect after delay
 setTimeout(() => {
 console.log('[RECONNECT] Trying...');
 initSocket().catch(console.error);
 }, 5000);
 }
 }
 });
 
 // Wait for connection
 await new Promise((resolve, reject) => {
 const timeout = setTimeout(() => {
 reject(new Error("Connection timeout"));
 }, 20000);
 
 sock.ev.once('connection.update', (update) => {
 if (update.connection === 'open') {
 clearTimeout(timeout);
 resolve();
 }
 });
 });
 
 return sock;
 
 } catch (err) {
 console.error("[ERROR]", err.message);
 sock = null;
 connectionPromise = null;
 throw err;
 }
 })();
 
 return connectionPromise;
}

app.get('/get-code', async (req, res) => {
 res.setTimeout(18000);
 
 try {
 const number = (req.query.number || '').replace(/\D/g, '');
 
 if (number.length < 10) {
 return res.status(400).json({ error: "Number invalid" });
 }
 
 console.log(`[REQUEST] ${number}`);
 
 // Initialize socket
 try {
 sock = await Promise.race([
 initSocket(),
 new Promise((_, reject) => 
 setTimeout(() => reject(new Error("Init timeout")), 15000)
 )
 ]);
 } catch (err) {
 console.error("[INIT ERROR]", err.message);
 return res.status(503).json({ error: "Cannot connect to WhatsApp - try /reset" });
 }
 
 // Check socket exists
 if (!sock || !sock.requestPairingCode) {
 return res.status(503).json({ error: "Socket error - try /reset" });
 }
 
 // Already linked?
 if (sock.user) {
 return res.json({ status: "already_linked", user: sock.user.id });
 }
 
 // Wait for ready
 for (let i = 0; i < 10; i++) {
 if (sock.ws?.readyState === 1) break;
 await delay(500);
 }
 
 await delay(500);
 
 // Request code
 console.log('[CODE] Generating...');
 const code = await Promise.race([
 sock.requestPairingCode(number),
 new Promise((_, reject) => 
 setTimeout(() => reject(new Error("Code timeout")), 8000)
 )
 ]);
 
 console.log(`✅ [SUCCESS] ${code}`);
 
 res.json({ 
 status: "success",
 code: code,
 message: "Enter in WhatsApp in 60 seconds"
 });
 
 } catch (err) {
 console.error(`[ERROR] ${err.message}`);
 res.status(503).json({ error: err.message });
 }
});

app.get('/status', (req, res) => {
 res.json({
 linked: sock?.user ? true : false,
 user: sock?.user?.id || null
 });
});

app.get('/reset', (req, res) => {
 clearSession();
 sock = null;
 connectionPromise = null;
 console.log("[RESET]");
 res.json({ ok: true, message: "Cleared - wait 5 minutes" });
});

app.listen(port, "0.0.0.0", () => {
 console.log(`[SERVER] Port ${port}`);
});
