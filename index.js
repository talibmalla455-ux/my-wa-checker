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
async function createSocket() {
 console.log("[CREATE] New socket...");
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
 });
 
 sock.ev.on('creds.update', saveCreds);
 
 // **LINK HO GYA NOTIFICATION**
 sock.ev.on('connection.update', (update) => {
 const { connection, lastDisconnect, isNewLogin } = update;
 
 if (connection === 'open') {
 console.log('✅ [LINKED] Device successfully linked!');
 console.log('User:', sock.user);
 
 // Clear old sessions if new login
 if (isNewLogin) {
 console.log('[NEW LOGIN] Fresh session started');
 }
 }
 
 if (connection === 'close') {
 const code = lastDisconnect?.error?.output?.statusCode;
 console.log(`[CLOSED] Status: ${code}`);
 
 if (code === 401 || code === 403) {
 console.log('[INVALID] Session logged out - clearing');
 clearSession();
 sock = null;
 } else {
 console.log('[RECONNECT] In 5s...');
 setTimeout(createSocket, 5000);
 }
 }
 });
}
app.get('/get-code', async (req, res) => {
 res.setTimeout(15000);
 
 try {
 const number = (req.query.number || '').replace(/\D/g, '');
 
 if (number.length < 10) {
 return res.status(400).json({ error: "Invalid number" });
 }
 
 console.log(`[REQUEST] Code for ${number}`);
 
 // Create fresh socket
 if (!sock) {
 console.log('[INIT] Creating socket...');
 await createSocket();
 }
 
 // Wait for ready
 let ready = false;
 for (let i = 0; i < 10; i++) {
 if (sock.ws?.readyState === 1) {
 ready = true;
 console.log('[READY] Socket connected');
 break;
 }
 await delay(1000);
 }
 
 if (!ready) {
 throw new Error("Socket not ready");
 }
 
 await delay(1000);
 
 // Check if already linked
 if (sock.user) {
 console.log('[ALREADY] Linked to:', sock.user.id);
 return res.json({ 
 status: "already_linked",
 user: sock.user.id
 });
 }
 
 console.log('[CODE] Requesting...');
 const code = await Promise.race([
 sock.requestPairingCode(number),
 new Promise((_, reject) => 
 setTimeout(() => reject(new Error("Code request timeout")), 8000)
 )
 ]);
 
 console.log(`[✅] Code ready: ${code}`);
 console.log('[INSTRUCTION] Enter this code in WhatsApp within 60 seconds');
 
 res.json({ 
 status: "success",
 code: code,
 instruction: "Go to WhatsApp → Settings → Linked Devices → Link Device → Enter code",
 expire_seconds: 60
 });
 
 } catch (err) {
 console.error(`[ERROR] ${err.message}`);
 res.status(503).json({ error: err.message });
 }
});
// Check linking status
app.get('/status', (req, res) => {
 if (sock?.user) {
 res.json({
 status: "linked",
 user: sock.user.id,
 name: sock.user.name
 });
 } else {
 res.json({
 status: "not_linked",
 message: "Call /get-code to start pairing"
 });
 }
});
// Clear everything
app.get('/reset', (req, res) => {
 clearSession();
 sock = null;
 console.log("[RESET] Everything cleared");
 res.json({ status: "ok", message: "Wait 5-10 minutes before pairing again" });
});
app.listen(port, "0.0.0.0", () => {
 console.log(`[SERVER] Listening on ${port}`);
});
