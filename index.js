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
 console.error("[ERROR]", e.message);
 }
}
async function initSocket() {
 if (sock) {
 console.log("[SKIP] Socket exists");
 return sock;
 }
 
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
 
 sock.ev.on('connection.update', (update) => {
 const { connection, lastDisconnect, isNewLogin } = update;
 
 if (connection === 'open') {
 console.log('✅ [LINKED] Device connected!');
 if (isNewLogin) {
 console.log('[USER]', sock.user.id);
 }
 }
 
 if (connection === 'close') {
 const code = lastDisconnect?.error?.output?.statusCode;
 console.log(`[CLOSED] Code: ${code}`);
 
 if (code === 401 || code === 403) {
 console.log('[LOGOUT] Session invalid');
 clearSession();
 sock = null;
 } else {
 console.log('[RECONNECT] After 5s...');
 setTimeout(() => {
 sock = null;
 initSocket().catch(console.error);
 }, 5000);
 }
 }
 });
 
 return sock;
}
app.get('/get-code', async (req, res) => {
 res.setTimeout(20000);
 
 try {
 const number = (req.query.number || '').replace(/\D/g, '');
 
 if (number.length < 10) {
 return res.status(400).json({ error: "Invalid number" });
 }
 
 console.log(`[REQUEST] Code for ${number}`);
 
 // Initialize if needed
 if (!sock) {
 console.log('[CONNECT] Initializing socket...');
 sock = await Promise.race([
 initSocket(),
 new Promise((_, reject) => 
 setTimeout(() => reject(new Error("Init timeout")), 15000)
 )
 ]);
 }
 
 // Safety check
 if (!sock || typeof sock.requestPairingCode !== 'function') {
 sock = null;
 return res.status(503).json({ error: "Socket error - try /reset" });
 }
 
 // Already linked?
 if (sock.user) {
 return res.json({ status: "already_linked", user: sock.user.id });
 }
 
 // Wait for WS ready
 let ready = false;
 for (let i = 0; i < 10; i++) {
 if (sock.ws && sock.ws.readyState === 1) {
 ready = true;
 break;
 }
 await delay(500);
 }
 
 if (!ready) {
 sock = null;
 return res.status(503).json({ error: "Connection not ready" });
 }
 
 await delay(800);
 
 // Get code
 console.log('[CODE] Requesting...');
 const code = await Promise.race([
 sock.requestPairingCode(number),
 new Promise((_, reject) => 
 setTimeout(() => reject(new Error("Code timeout")), 8000)
 )
 ]);
 
 console.log(`✅ [SUCCESS] Code: ${code}`);
 
 return res.json({ 
 code: code,
 message: "Enter in WhatsApp Settings → Linked Devices in 60 seconds"
 });
 
 } catch (err) {
 console.error(`[ERROR] ${err.message}`);
 sock = null;
 
 res.status(503).json({ 
 error: err.message,
 tip: "Try /reset"
 });
 }
});
app.get('/status', (req, res) => {
 res.json({
 connected: sock?.user ? true : false,
 user: sock?.user?.id || "Not linked"
 });
});
app.get('/reset', (req, res) => {
 clearSession();
 sock = null;
 console.log("[RESET] Session cleared");
 res.json({ ok: true });
});
app.listen(port, "0.0.0.0", () => {
 console.log(`[SERVER] Running on port ${port}`);
});
