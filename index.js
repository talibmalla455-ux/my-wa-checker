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
 console.log("[✓] Session cleared");
 }
 } catch (e) {
 console.error("[ERROR]", e.message);
 }
}
async function createConnection() {
 if (sock) return sock;
 if (isConnecting) {
 console.log("[WAIT] Already connecting...");
 return new Promise(resolve => {
 const check = setInterval(() => {
 if (sock) {
 clearInterval(check);
 resolve(sock);
 }
 }, 500);
 setTimeout(() => clearInterval(check), 30000);
 });
 }
 
 isConnecting = true;
 
 try {
 console.log("[INIT] Creating socket...");
 
 const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
 const { version } = await fetchLatestBaileysVersion();
 
 sock = makeWASocket({
 version,
 auth: state,
 logger: pino({ level: 'error' }),
 browser: ["Ubuntu", "Chrome", "20.0.04"],
 connectTimeoutMs: 30000,
 keepAliveIntervalMs: 25000,
 });
 
 sock.ev.on('creds.update', saveCreds);
 
 sock.ev.on('connection.update', (update) => {
 const { connection, lastDisconnect, isNewLogin } = update;
 
 if (connection === 'open') {
 console.log('✅ [OPEN]');
 isConnecting = false;
 }
 
 if (connection === 'close') {
 const code = lastDisconnect?.error?.output?.statusCode;
 console.log(`[CLOSE] ${code}`);
 isConnecting = false;
 sock = null;
 
 if (code !== 401 && code !== 403) {
 setTimeout(createConnection, 3000);
 }
 }
 });
 
 // Wait max 25 seconds for connection
 await new Promise((resolve, reject) => {
 const timeout = setTimeout(() => {
 reject(new Error("Connection timeout"));
 }, 25000);
 
 const checkInterval = setInterval(() => {
 if (sock?.ws?.readyState === 1) {
 clearTimeout(timeout);
 clearInterval(checkInterval);
 resolve();
 }
 }, 500);
 });
 
 return sock;
 
 } catch (err) {
 console.error("[ERROR]", err.message);
 isConnecting = false;
 sock = null;
 throw err;
 }
}
app.get('/get-code', async (req, res) => {
 res.setTimeout(40000);
 
 try {
 const number = (req.query.number || '').replace(/\D/g, '');
 
 if (number.length < 10) {
 return res.status(400).json({ error: "Invalid number" });
 }
 
 console.log(`[REQUEST] ${number}`);
 
 // Connect
 if (!sock) {
 console.log('[CONNECT]');
 try {
 sock = await createConnection();
 } catch (err) {
 console.error('[ERROR]', err.message);
 sock = null;
 return res.status(503).json({ 
 error: "Cannot connect",
 try: "/reset"
 });
 }
 }
 
 // Check socket
 if (!sock) {
 return res.status(503).json({ error: "Socket null" });
 }
 
 // Wait for ready
 let ready = false;
 for (let i = 0; i < 15; i++) {
 if (sock.ws?.readyState === 1) {
 ready = true;
 break;
 }
 await delay(1000);
 }
 
 if (!ready) {
 sock = null;
 return res.status(503).json({ error: "Timeout" });
 }
 
 await delay(500);
 
 // Code
 try {
 console.log('[CODE]');
 const code = await Promise.race([
 sock.requestPairingCode(number),
 new Promise((_, reject) => 
 setTimeout(() => reject(new Error("Timeout")), 8000)
 )
 ]);
 
 console.log(`✅ ${code}`);
 return res.json({ code });
 
 } catch (err) {
 console.error('[CODE ERROR]', err.message);
 throw err;
 }
 
 } catch (err) {
 console.error('[HANDLER ERROR]', err.message);
 res.status(503).json({ error: err.message });
 }
});
app.get('/status', (req, res) => {
 res.json({ 
 connected: sock?.user ? true : false 
 });
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
});
