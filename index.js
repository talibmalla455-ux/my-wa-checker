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
let phoneConnected = false;
function clearSession() {
 try {
 if (fs.existsSync(SESSION_PATH)) {
 fs.rmSync(SESSION_PATH, { recursive: true, force: true });
 console.log("[✓] Cleared");
 }
 } catch (e) {}
}
async function initWhatsApp() {
 console.log("[INIT] Starting...");
 
 const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
 const { version } = await fetchLatestBaileysVersion();
 
 sock = makeWASocket({
 version,
 auth: state,
 logger: pino({ level: 'error' }),
 browser: ["Ubuntu", "Chrome", "20.0.04"],
 connectTimeoutMs: 20000,
 keepAliveIntervalMs: 20000,
 syncFullHistory: false,
 });
 
 sock.ev.on('creds.update', saveCreds);
 
 sock.ev.on('connection.update', async (update) => {
 const { connection, lastDisconnect, isNewLogin } = update;
 
 if (connection === 'open') {
 console.log('✅ [CONNECTED]');
 phoneConnected = true;
 }
 
 if (connection === 'close') {
 const code = lastDisconnect?.error?.output?.statusCode;
 console.log(`[CLOSED] ${code}`);
 phoneConnected = false;
 
 if (code === 401 || code === 403) {
 clearSession();
 sock = null;
 } else if (code !== 408) {
 setTimeout(initWhatsApp, 3000);
 }
 }
 });
 
 return new Promise((resolve) => {
 const checkReady = setInterval(() => {
 if (sock?.ws?.readyState === 1) {
 clearInterval(checkReady);
 resolve(sock);
 }
 }, 500);
 
 setTimeout(() => {
 clearInterval(checkReady);
 resolve(sock);
 }, 20000);
 });
}
app.get('/start', async (req, res) => {
 res.setTimeout(30000);
 
 try {
 console.log('[START] Request');
 
 // Already linked?
 if (phoneConnected && sock?.user) {
 return res.json({ 
 status: "already_linked",
 user: sock.user.id
 });
 }
 
 // Initialize
 if (!sock) {
 console.log('[CONNECT]');
 sock = await initWhatsApp();
 }
 
 // Wait for ready
 let ready = false;
 for (let i = 0; i < 15; i++) {
 if (sock?.ws?.readyState === 1 && phoneConnected) {
 ready = true;
 break;
 }
 await delay(1000);
 }
 
 if (!ready) {
 return res.json({
 status: "connecting",
 message: "Keep phone connected to WhatsApp"
 });
 }
 
 return res.json({
 status: "ready",
 user: sock.user?.id || "connected"
 });
 
 } catch (err) {
 console.error('[ERROR]', err.message);
 res.status(503).json({ error: err.message });
 }
});
app.get('/pair-code', async (req, res) => {
 res.setTimeout(25000);
 
 try {
 const number = (req.query.number || '').replace(/\D/g, '');
 
 if (number.length < 10) {
 return res.status(400).json({ error: "Invalid number" });
 }
 
 console.log(`[PAIR] ${number}`);
 
 // Already linked?
 if (phoneConnected && sock?.user) {
 return res.json({ status: "already_linked" });
 }
 
 // Initialize
 if (!sock) {
 console.log('[INIT]');
 sock = await initWhatsApp();
 }
 
 // Wait for ready
 for (let i = 0; i < 15; i++) {
 if (sock?.ws?.readyState === 1) break;
 await delay(1000);
 }
 
 await delay(500);
 
 // Request code
 console.log('[CODE] Requesting...');
 const code = await Promise.race([
 sock.requestPairingCode(number),
 new Promise((_, reject) => 
 setTimeout(() => reject(new Error("Timeout")), 8000)
 )
 ]);
 
 console.log(`✅ ${code}`);
 
 // Start listening for connection
 console.log('[LISTEN] For device link...');
 
 return res.json({ 
 code: code,
 message: "Enter in WhatsApp",
 expires_in: 60
 });
 
 } catch (err) {
 console.error('[ERROR]', err.message);
 res.status(503).json({ error: err.message });
 }
});
app.get('/check', (req, res) => {
 res.json({
 connected: phoneConnected,
 user: sock?.user?.id || null,
 message: phoneConnected ? "Ready!" : "Not connected"
 });
});
app.get('/reset', (req, res) => {
 clearSession();
 sock = null;
 phoneConnected = false;
 console.log("[RESET]");
 res.json({ ok: true });
});
app.listen(port, "0.0.0.0", () => {
 console.log(`[SERVER] ${port}`);
 initWhatsApp().catch(() => console.log("[READY] Init on request"));
});
