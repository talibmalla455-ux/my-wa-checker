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
let lastAttemptTime = 0;
const THROTTLE_DELAY = 120000; // 2 minutes
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
async function connectWhatsApp() {
 return new Promise(async (resolve, reject) => {
 try {
 console.log("[CONNECTING] To WhatsApp...");
 
 const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
 const { version } = await fetchLatestBaileysVersion();
 
 sock = makeWASocket({
 version,
 auth: state,
 logger: pino({ level: 'error' }), // Error level only
 printQRInTerminal: false,
 browser: ["Ubuntu", "Chrome", "20.0.04"],
 connectTimeoutMs: 15000, // 15 seconds
 defaultQueryTimeoutMs: 60000,
 keepAliveIntervalMs: 10000,
 maxRetries: 2
 });
 
 sock.ev.on('creds.update', saveCreds);
 
 // Timeout after 20 seconds
 const timeout = setTimeout(() => {
 console.log("[TIMEOUT] Connection took >20s");
 reject(new Error("Connection timeout"));
 }, 20000);
 
 sock.ev.on('connection.update', async (update) => {
 const { connection, lastDisconnect } = update;
 
 if (connection === 'open') {
 clearTimeout(timeout);
 console.log('[✅] Connected to WhatsApp!');
 resolve(sock);
 } else if (connection === 'close') {
 const code = lastDisconnect?.error?.output?.statusCode;
 console.log(`[CLOSED] Code: ${code}`);
 
 clearTimeout(timeout);
 
 if (code === 401 || code === 403) {
 console.log("[INVALID] Session logged out");
 clearSession();
 reject(new Error("Session invalid - cleared. Try again in 2 mins"));
 } else if (code === 428) {
 console.log("[THROTTLED] WhatsApp is throttling requests");
 reject(new Error("WhatsApp throttled - wait 2+ minutes"));
 } else {
 console.log("[ERROR] Connection closed");
 reject(new Error("Connection failed"));
 }
 }
 });
 
 } catch (err) {
 console.error("[ERROR]", err.message);
 reject(err);
 }
 });
}
app.get('/get-code', async (req, res) => {
 try {
 const now = Date.now();
 
 // Check if too soon since last attempt
 if (now - lastAttemptTime < THROTTLE_DELAY) {
 const waitSecs = Math.ceil((THROTTLE_DELAY - (now - lastAttemptTime)) / 1000);
 return res.status(429).json({ 
 error: "Too many requests",
 wait_seconds: waitSecs,
 message: `Wait ${waitSecs}s before next attempt`
 });
 }
 
 lastAttemptTime = now;
 
 let number = req.query.number;
 if (!number) {
 return res.status(400).json({ error: "?number=923001234567" });
 }
 
 number = number.replace(/\D/g, '');
 if (number.length < 10) {
 return res.status(400).json({ error: "Invalid number" });
 }
 
 console.log(`[REQUEST] Code for: ${number}`);
 
 // Already linked?
 if (sock?.user) {
 return res.json({ 
 status: "already_linked",
 user: sock.user.id
 });
 }
 
 // Connect
 try {
 if (!sock) {
 console.log("[INIT] Creating connection...");
 await connectWhatsApp();
 }
 } catch (err) {
 console.error("[CONNECT ERROR]", err.message);
 return res.status(503).json({ 
 error: err.message,
 action: "Call /reset and wait 2+ minutes"
 });
 }
 
 // Wait for ready
 let ready = false;
 for (let i = 0; i < 10; i++) {
 if (sock.ws?.readyState === 1) {
 ready = true;
 break;
 }
 await delay(1000);
 }
 
 if (!ready) {
 return res.status(503).json({ 
 error: "Socket not ready",
 action: "Try again"
 });
 }
 
 await delay(1000);
 
 // Request code
 try {
 console.log("[CODE] Generating...");
 const code = await Promise.race([
 sock.requestPairingCode(number),
 new Promise((_, rej) => 
 setTimeout(() => rej(new Error("Pairing timeout")), 8000)
 )
 ]);
 
 console.log(`[✅] Generated: ${code}`);
 return res.json({ 
 status: "success",
 code: code
 });
 } catch (err) {
 console.error("[CODE ERROR]", err.message);
 return res.status(500).json({ 
 error: err.message
 });
 }
 
 } catch (err) {
 console.error("[REQUEST ERROR]", err.message);
 res.status(500).json({ error: err.message });
 }
});
app.get('/health', (req, res) => {
 res.json({
 online: true,
 whatsapp: sock?.user ? "linked" : "not_linked",
 lastAttempt: new Date(lastAttemptTime).toISOString()
 });
});
app.get('/reset', (req, res) => {
 clearSession();
 sock = null;
 lastAttemptTime = 0;
 console.log("[RESET] Session cleared");
 res.json({ 
 status: "reset",
 message: "Session cleared. Wait 2+ minutes before next attempt"
 });
});
app.listen(port, "0.0.0.0", () => {
 console.log(`[SERVER] Running on port ${port}`);
});
