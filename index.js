const { 
    default: makeWASocket, 
    DisconnectReason, 
    delay,
    BufferJSON,
    initAuthCreds,
    proto
} = require("@whiskeysockets/baileys");
const express = require("express");
const pino = require("pino");
const cors = require("cors");
const { Client } = require("pg");

const app = express();
app.use(cors());
const port = process.env.PORT || 3000;

// PostgreSQL Connection
const client = new Client({
    connectionString: process.env.DATABASE_URL, // Railway khud ye variable provide karta hai
    ssl: { rejectUnauthorized: false }
});

client.connect();

// Database mein Table banane ka function
async function setupDatabase() {
    await client.query(`
        CREATE TABLE IF NOT EXISTS auth_state (
            id TEXT PRIMARY KEY,
            data TEXT
        );
    `);
}

// Custom Database Auth State for Baileys
async function usePostgresAuthState() {
    const writeData = async (data, id) => {
        const json = JSON.stringify(data, BufferJSON.replacer);
        await client.query(
            "INSERT INTO auth_state (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2",
            [id, json]
        );
    };

    const readData = async (id) => {
        const res = await client.query("SELECT data FROM auth_state WHERE id = $1", [id]);
        if (res.rows.length > 0) {
            return JSON.parse(res.rows[0].data, BufferJSON.reviver);
        }
        return null;
    };

    let creds = await readData('creds');
    if (!creds) {
        creds = initAuthCreds();
        await writeData(creds, 'creds');
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    for (const type in data) {
                        for (const id in data[type]) {
                            const value = data[type][id];
                            const storeId = `${type}-${id}`;
                            if (value) {
                                await writeData(value, storeId);
                            } else {
                                await client.query("DELETE FROM auth_state WHERE id = $1", [storeId]);
                            }
                        }
                    }
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
}

let sock;

async function connectToWhatsApp() {
    await setupDatabase();
    const { state, saveCreds } = await usePostgresAuthState();
    
    sock = makeWASocket({
        printQRInTerminal: false,
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('WhatsApp Permanent Connection Open!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Pairing Code Endpoint
app.get('/get-code', async (req, res) => {
    const num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    try {
        if (!sock) await connectToWhatsApp();
        const code = await sock.requestPairingCode(num);
        res.json({ code: code });
    } catch (err) {
        res.status(500).json({ error: "Failed to generate code" });
    }
});

// Check Endpoint
app.get('/check', async (req, res) => {
    const num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    try {
        if (!sock || sock.ws.readyState !== 1) return res.json({ exists: false, error: "Not connected" });
        const [result] = await sock.onWhatsApp(num);
        res.json({ exists: !!(result && result.exists) });
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    connectToWhatsApp();
});
