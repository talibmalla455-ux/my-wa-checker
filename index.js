if (!global.crypto) {
 try { global.crypto = require('crypto'); } catch (e) {}
}

const { 
 default: makeWASocket, 
 useMultiFileAuthState, 
 delay,
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

const SESSION_PATH = fs.existsSync('/data') ? '/data/auth' : './auth';

let sock = null;
let connectionReady = false;

function clearSession() {
 try {
 if (fs.existsSync(SESSION_PATH)) {
 fs.rmSync(SESSION_PATH, { recursive: true, force: true });
 console.log("[✓] Cleared");
 }
 } catch (e) {}
}

async function startSocket() {
 console.log("[START] Socket...");
 
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
 
 sock.ev.on('connection.update', (update) => {
 const { connection, lastDisconnect, isNewLogin } = update;
 
 if (connection === 'open') {
 connectionReady = true;
 console.log('✅ [READY]');
 }
 
 if (connection === 'close') {
 const code = lastDisconnect?.error?.output?.statusCode;
 console.log(`[CLOSE] ${code}`);
 connectionReady = false;
 sock = null;
 
 if (code !== 401 && code !== 403 && code !== 405) {
 setTimeout(startSocket, 5000);
 }
 }
 });
 
 return sock;
}

// MAIN ENDPOINT
app.get('/pair', async (req, res) => {
 res.setTimeout(30000);
 
 try {
 const number = (req.query.number || '').replace(/\D/g, '');
 
 if (!number || number.length < 10) {
 return res.status(400).json({ error: "Invalid number. Example: 923497181963" });
 }
 
 console.log(`[PAIR] ${number}`);
 
 // Start socket if needed
 if (!sock) {
 console.log('[INIT]');
 sock = await startSocket();
 }
 
 // Wait for socket to be ready (max 15 seconds)
 for (let i = 0; i < 15; i++) {
 if (sock?.ws?.readyState === 1) {
 console.log('[WS] Ready');
 break;
 }
 await delay(1000);
 }
 
 await delay(500);
 
 // Get pairing code
 console.log('[GET] Pairing code...');
 const code = await Promise.race([
 sock.requestPairingCode(number),
 new Promise((_, reject) => 
 setTimeout(() => reject(new Error("Code generation timeout")), 10000)
 )
 ]);
 
 console.log(`✅ [CODE] ${code}`);
 
 return res.json({
 success: true,
 code: code,
 number: number,
 instruction: "Go to WhatsApp → Settings → Linked Devices → Scan with phone",
 valid_for: "60 seconds"
 });
 
 } catch (err) {
 console.error('[ERROR]', err.message);
 sock = null;
 connectionReady = false;
 
 res.status(503).json({ 
 error: err.message,
 recovery: "Call /reset and try again after 5 minutes"
 });
 }
});

// Status check
app.get('/status', (req, res) => {
 res.json({
 socket_ready: sock ? true : false,
 connection_open: connectionReady,
 linked_user: sock?.user?.id || null
 });
});

// Reset everything
app.get('/reset', (req, res) => {
 clearSession();
 sock = null;
 connectionReady = false;
 console.log("[RESET] Complete");
 res.json({ 
 status: "reset",
 message: "Wait 5 minutes before trying again"
 });
});

// Health check
app.get('/', (req, res) => {
 res.json({ 
 status: "ok",
 endpoints: [
 "/pair?number=923497181963",
 "/status",
 "/reset"
 ]
 });
});

app.listen(port, "0.0.0.0", () => {
 console.log(`[SERVER] Port ${port}`);
});
