if (!global.crypto) {
 try { global.crypto = require('crypto'); } catch (e) {}
}

const { 
 default: makeWASocket, 
 useMultiFileAuthState, 
 delay
} = require("@whiskeysockets/baileys");
const express = require("express");
const cors = require("cors");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const SESSION_PATH = fs.existsSync('/data') ? '/data/auth' : './auth';

let sock = null;
let qrGenerated = null;

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

async function connectWA() {
 return new Promise(async (resolve, reject) => {
 try {
 console.log("[CONNECT] Initializing...");
 
 const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
 
 sock = makeWASocket({
 auth: state,
 logger: pino({ level: 'fatal' }),
 browser: ["Ubuntu", "Chrome", "20.0.04"],
 connectTimeoutMs: 30000,
 keepAliveIntervalMs: 25000,
 defaultQueryTimeoutMs: 30000,
 syncFullHistory: false,
 printQRInTerminal: false,
 });
 
 sock.ev.on('creds.update', saveCreds);
 
 let opened = false;
 
 sock.ev.on('connection.update', (update) => {
 const { connection, lastDisconnect, qr, isNewLogin } = update;
 
 if (qr) {
 console.log('[QR] Generated');
 qrGenerated = qr;
 }
 
 if (connection === 'open') {
 opened = true;
 console.log('✅ [OPEN]');
 resolve(sock);
 } else if (connection === 'close') {
 const code = lastDisconnect?.error?.output?.statusCode;
 console.log(`[CLOSE] ${code}`);
 
 if (!opened) {
 reject(new Error(`Close: ${code}`));
 }
 sock = null;
 }
 });
 
 setTimeout(() => {
 if (!opened && !qrGenerated) {
 reject(new Error("Timeout"));
 }
 }, 25000);
 
 } catch (err) {
 console.error("[ERROR]", err.message);
 reject(err);
 }
 });
}

// Main endpoint - bilkul simple
app.get('/connect', async (req, res) => {
 res.setTimeout(35000);
 
 try {
 const number = (req.query.number || '').replace(/\D/g, '');
 
 if (number.length < 10) {
 return res.status(400).json({ error: "Invalid number" });
 }
 
 console.log(`[REQUEST] ${number}`);
 
 if (!sock) {
 console.log('[INIT]');
 try {
 sock = await connectWA();
 } catch (err) {
 console.error('[CONNECT ERROR]', err.message);
 sock = null;
 return res.status(503).json({ error: err.message });
 }
 }
 
 // Wait for socket ready
 for (let i = 0; i < 20; i++) {
 if (sock?.ws?.readyState === 1) break;
 await delay(1000);
 }
 
 await delay(1000);
 
 console.log('[CODE] Getting...');
 const code = await Promise.race([
 sock.requestPairingCode(number),
 new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 8000))
 ]);
 
 console.log(`✅ ${code}`);
 
 res.json({ 
 success: true,
 code: code,
 message: "Enter code in WhatsApp → Settings → Linked Devices",
 expires: 60
 });
 
 } catch (err) {
 console.error('[ERROR]', err.message);
 sock = null;
 res.status(503).json({ error: err.message });
 }
});

app.get('/status', (req, res) => {
 res.json({ 
 connected: sock?.user ? true : false,
 user: sock?.user?.id || null
 });
});

app.get('/reset', (req, res) => {
 clearSession();
 sock = null;
 qrGenerated = null;
 console.log("[RESET]");
 res.json({ ok: true, wait: "5 min before next attempt" });
});

app.get('/health', (req, res) => {
 res.json({ status: "ok" });
});

app.listen(port, "0.0.0.0", () => {
 console.log(`[SERVER] ${port}`);
});
