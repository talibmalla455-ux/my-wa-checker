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
let connectedUser = null;
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
async function connectWhatsApp() {
 return new Promise(async (resolve, reject) => {
 try {
 console.log("[CONNECT] Initializing Baileys...");
 
 const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
 const { version } = await fetchLatestBaileysVersion();
 
 sock = makeWASocket({
 version,
 auth: state,
 logger: pino({ level: 'fatal' }), // Only fatal errors
 printQRInTerminal: false,
 browser: ["Ubuntu", "Chrome", "20.0.04"],
 connectTimeoutMs: 60000, // Increased to 60s
 defaultQueryTimeoutMs: 60000,
 keepAliveIntervalMs: 25000,
 retryRequestDelayMs: 100,
 maxRetries: 10,
 qrTimeout: 60000,
 shouldIgnoreJid: () => false,
 });
 
 sock.ev.on('creds.update', saveCreds);
 
 let connectionOpened = false;
 
 sock.ev.on('connection.update', (update) => {
 const { connection, lastDisconnect, isNewLogin, qr } = update;
 
 console.log(`[UPDATE] Connection: ${connection}`);
 
 if (connection === 'open') {
 connectionOpened = true;
 connectedUser = sock.user;
 console.log('✅ [OPEN] Connected!');
 resolve(sock);
 } else if (connection === 'connecting') {
 console.log('[CONNECTING] ...');
 } else if (connection === 'close') {
 const statusCode = lastDisconnect?.error?.output?.statusCode;
 console.log(`[CLOSE] Status: ${statusCode}`);
 
 if (!connectionOpened) {
 reject(new Error(`Connection closed: ${statusCode}`));
 }
 
 if (statusCode === 401 || statusCode === 403) {
 console.log('[LOGOUT] Clearing session');
 clearSession();
 sock = null;
 } else {
 sock = null;
 }
 }
 });
 
 // Overall timeout
 setTimeout(() => {
 if (!connectionOpened) {
 reject(new Error("Connection timeout 50s"));
 }
 }, 50000);
 
 } catch (err) {
 console.error("[ERROR]", err.message);
 reject(err);
 }
 });
}
app.get('/get-code', async (req, res) => {
 res.setTimeout(70000); // 70 seconds timeout
 
 try {
 const number = (req.query.number || '').replace(/\D/g, '');
 
 if (!number || number.length < 10) {
 return res.status(400).json({ error: "Invalid number" });
 }
 
 console.log(`[REQUEST] ${number}`);
 
 // Check if already linked
 if (connectedUser) {
 console.log('[LINKED] Already connected');
 return res.json({ status: "already_linked", user: connectedUser.id });
 }
 
 // Connect
 if (!sock) {
 console.log('[INIT] Creating connection...');
 try {
 sock = await connectWhatsApp();
 } catch (err) {
 console.error('[CONNECT ERROR]', err.message);
 sock = null;
 return res.status(503).json({ 
 error: err.message,
 action: "Try /reset and wait 5 minutes"
 });
 }
 }
 
 // Safety check
 if (!sock) {
 return res.status(503).json({ error: "Socket is null" });
 }
 
 // Wait for WS ready (max 15 seconds)
 console.log('[WAIT] For WebSocket...');
 let wsReady = false;
 for (let i = 0; i < 15; i++) {
 if (sock.ws && sock.ws.readyState === 1) {
 wsReady = true;
 console.log('[WS] Ready!');
 break;
 }
 await delay(1000);
 }
 
 if (!wsReady) {
 console.log('[WS] Not ready');
 sock = null;
 return res.status(503).json({ error: "WebSocket not ready - try /reset" });
 }
 
 await delay(1000);
 
 // Request code
 console.log('[CODE] Requesting pairing code...');
 const code = await Promise.race([
 sock.requestPairingCode(number),
 new Promise((_, reject) => 
 setTimeout(() => reject(new Error("Pairing timeout")), 10000)
 )
 ]);
 
 console.log(`✅ [SUCCESS] ${code}`);
 
 return res.json({ 
 code: code,
 expire: "60 seconds"
 });
 
 } catch (err) {
 console.error('[ERROR]', err.message);
 sock = null;
 connectedUser = null;
 
 if (!res.headersSent) {
 res.status(503).json({ error: err.message });
 }
 }
});
app.get('/status', (req, res) => {
 res.json({
 linked: connectedUser ? true : false,
 user: connectedUser?.id || null
 });
});
app.get('/reset', (req, res) => {
 clearSession();
 sock = null;
 connectedUser = null;
 console.log("[RESET] Done");
 res.json({ ok: true, wait: "5 minutes" });
});
app.listen(port, "0.0.0.0", () => {
 console.log(`[SERVER] ${port}`);
});
