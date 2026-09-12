const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const SESSION_PATH = fs.existsSync('/data') ? '/data/.wbot' : './.wbot';

if (!fs.existsSync(SESSION_PATH)) {
 fs.mkdirSync(SESSION_PATH, { recursive: true });
}

let client = null;
let isConnected = false;

async function initClient() {
 try {
 console.log("[INIT] Loading WhatsApp Web...");
 
 const { Client, LocalAuth } = require("whatsapp-web.js");
 
 client = new Client({
 authStrategy: new LocalAuth({ 
 clientId: "main",
 dataPath: SESSION_PATH 
 }),
 puppeteer: {
 headless: true,
 args: [
 '--no-sandbox',
 '--disable-setuid-sandbox',
 '--disable-dev-shm-usage',
 '--disable-gpu',
 '--single-process'
 ],
 timeout: 30000
 },
 restartOnCrash: true,
 takeoverOnConflict: true,
 qrMaxRetries: 5,
 });
 
 client.on('qr', (qr) => {
 console.log('[QR] Generated - scan with WhatsApp');
 });
 
 client.on('ready', () => {
 console.log('✅ [READY] WhatsApp connected!');
 isConnected = true;
 });
 
 client.on('authenticated', () => {
 console.log('✅ [AUTH] Authenticated');
 isConnected = true;
 });
 
 client.on('auth_failure', () => {
 console.log('[FAIL] Auth failed');
 isConnected = false;
 });
 
 client.on('disconnected', () => {
 console.log('[DISC] Disconnected');
 isConnected = false;
 });
 
 await client.initialize();
 console.log('[OK] Client initialized');
 
 } catch (err) {
 console.error('[ERROR]', err.message);
 throw err;
 }
}

// Initialize on startup
initClient().catch(err => {
 console.log("[WARN] Will init on first request:", err.message);
});

// Get pairing code
app.get('/get-code', async (req, res) => {
 res.setTimeout(40000);
 
 try {
 const number = (req.query.number || '').replace(/\D/g, '');
 
 if (!number || number.length < 10) {
 return res.status(400).json({ error: "Invalid number" });
 }
 
 console.log(`[CODE] Request for ${number}`);
 
 // Init if needed
 if (!client) {
 console.log('[INIT]');
 await initClient();
 }
 
 // Wait for ready max 30s
 for (let i = 0; i < 30; i++) {
 if (isConnected) break;
 await new Promise(r => setTimeout(r, 1000));
 }
 
 if (!isConnected) {
 return res.json({
 status: "connecting",
 message: "Scan QR code with WhatsApp (appears in logs)"
 });
 }
 
 console.log('[GET] Pairing code...');
 
 const code = await client.requestPairingCode(number);
 
 console.log(`✅ [CODE] ${code}`);
 
 return res.json({
 code: code,
 expires: "60 seconds",
 instruction: "Enter in WhatsApp → Settings → Linked Devices"
 });
 
 } catch (err) {
 console.error('[ERROR]', err.message);
 
 if (!res.headersSent) {
 res.status(503).json({ 
 error: err.message,
 tip: "Try /reset"
 });
 }
 }
});

// Status
app.get('/status', (req, res) => {
 res.json({
 connected: isConnected,
 message: isConnected ? "Ready!" : "Connecting..."
 });
});

// Reset
app.get('/reset', async (req, res) => {
 try {
 console.log('[RESET]');
 
 if (client) {
 try {
 await client.logout();
 } catch (e) {}
 await client.destroy();
 }
 
 if (fs.existsSync(SESSION_PATH)) {
 fs.rmSync(SESSION_PATH, { recursive: true, force: true });
 }
 
 client = null;
 isConnected = false;
 
 // Restart
 setTimeout(() => initClient().catch(console.error), 2000);
 
 res.json({ status: "reset", wait: "5 minutes" });
 
 } catch (err) {
 console.error('[ERROR]', err.message);
 res.status(500).json({ error: err.message });
 }
});

// Health
app.get('/health', (req, res) => {
 res.json({ ok: true });
});

app.listen(port, "0.0.0.0", () => {
 console.log(`[SERVER] Port ${port}`);
});
