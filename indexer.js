const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

// --- CONFIGURATION ---
const EMBED_MODEL = "text-embedding-nomic-embed-text-v2-moe";
const TARGET_DIR = path.resolve("./lore");
const OUTPUT_FILE = path.resolve("./vector_index.jsonl");
const STATE_FILE = path.resolve("./sync_state.json");

/**
 * Handshake with LM Studio Embedding Endpoint.
 */
async function generateEmbedding(text) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ model: EMBED_MODEL, input: text });
        const req = http.request({
            hostname: '127.0.0.1', port: 1234, path: '/v1/embeddings', method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.data && parsed.data[0]) resolve(parsed.data[0].embedding);
                    else reject("Handshake payload empty.");
                } catch (e) { reject("Parse failure at endpoint."); }
            });
        });
        req.on('error', (e) => reject(`Network Failure: ${e.message}`));
        req.write(payload);
        req.end();
    });
}

/**
 * Intelligent Chunking: Respects paragraph boundaries to preserve TAM/Lore context.
 */
function getChunks(text, limit = 800) {
    const paragraphs = text.split(/\n\n+/);
    let chunks = [];
    let current = "";

    for (let p of paragraphs) {
        if ((current.length + p.length) > limit) {
            if (current) chunks.push(current.trim());
            current = p;
        } else {
            current += "\n\n" + p;
        }
    }
    if (current) chunks.push(current.trim());
    return chunks;
}

/**
 * Recursive File Crawler.
 */
function gatherFiles(dir, allFiles = []) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory()) {
            if (!['node_modules', '.git', 'dist'].includes(file.name)) {
                gatherFiles(fullPath, allFiles);
            }
        } else if (/\.(md|txt|js|json|html)$/i.test(file.name)) {
            allFiles.push(fullPath);
        }
    }
    return allFiles;
}

/**
 * Main Sync Process.
 */
async function syncForge() {
    console.log(`[SYSTEM] Initiating Forge Sync: ${TARGET_DIR}`);
    
    // Load Sync State (Prevents redundant embedding cycles)
    let state = {};
    if (fs.existsSync(STATE_FILE)) {
        state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }

    const files = gatherFiles(TARGET_DIR);
    const stream = fs.createWriteStream(OUTPUT_FILE, { flags: 'a' });

    for (const filePath of files) {
        const stats = fs.statSync(filePath);
        const mtime = stats.mtimeMs;

        // Skip logic: Checks if file modified since last sync
        if (state[filePath] && state[filePath] === mtime) {
            process.stdout.write("s"); // Skip
            continue;
        }

        console.log(`\n[SYNC] Mapping Matter: ${path.basename(filePath)}`);
        const content = fs.readFileSync(filePath, 'utf8');
        const chunks = getChunks(content);

        for (const chunk of chunks) {
            try {
                const vector = await generateEmbedding(chunk);
                const entry = {
                    path: filePath,
                    text: chunk,
                    vector: vector,
                    mtime: mtime
                };
                stream.write(JSON.stringify(entry) + '\n');
                process.stdout.write(".");
            } catch (e) {
                console.error(`\n[ERROR] Matter rejection at ${path.basename(filePath)}: ${e}`);
            }
        }
        state[filePath] = mtime;
    }

    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    stream.end();
    console.log(`\n[SUCCESS] Vector Index Stream Finalized.`);
}

syncForge();