const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const WebSocket = require('ws');
const pty = require('node-pty');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

// Logic isolation
const forgeFS = require('./forge_fs');

const PORT = 3001;
const EMBED_MODEL = "text-embedding-nomic-embed-text-v2-moe";
const CHAT_MODEL = "local-model";
const VECTOR_INDEX_PATH = path.join(__dirname, 'vector_index.jsonl');

// Global Life Support
process.on('uncaughtException', (err) => console.error(`[CRITICAL] Error: ${err.message}`));

const systemContent = `
You are Crucible. Industrial style. Present tense. Third-person.
Lore: Arcanum uses Tunable Adaptive Matter (TAM). The Eighth Gauge uses Star Metal. Axiomite is restricted to the Black Razor.
Constraint: Adhere to physics. No humming or resonance.
`;

function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB) return 0;
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return dotProduct / (magA * magB);
}

async function getEmbedding(text) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ model: EMBED_MODEL, input: text });
        const req = http.request({
            hostname: '127.0.0.1', port: 1234, path: '/v1/embeddings', method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            let data = ''; res.on('data', d => data += d);
            res.on('end', () => {
                try { resolve(JSON.parse(data).data[0].embedding); }
                catch (e) { reject("Embedding endpoint failure."); }
            });
        });

        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error("Embedding Timeout"));
        });

        req.on('error', reject); req.write(payload); req.end();
    });
}

const server = http.createServer(async (req, res) => {
    const sendJSON = (data, status = 200) => {
        if (res.writableEnded) return;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    };

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // --- PRIMARY ROUTE ---
    if (pathname === '/' && req.method === 'GET') {
        return res.end(fs.readFileSync(path.join(__dirname, 'ui', 'dashboard.html'), 'utf8'));
    }

    // --- STATIC ASSET DELIVERY ---
    if (pathname === '/styles.css' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        return res.end(fs.readFileSync(path.join(__dirname, 'ui', 'style.css'), 'utf8'));
    }

    // --- GET API DATA ---
    try {
        if (pathname === '/api/files' && req.method === 'GET') {
            return sendJSON(forgeFS.listFiles(url.searchParams.get('dir') || process.cwd()));
        }

        if (pathname === '/api/read' && req.method === 'GET') {
            return res.end(forgeFS.readFile(url.searchParams.get('path')));
        }

        if (pathname === '/api/search' && req.method === 'GET') {
            const results = await forgeFS.searchFiles(url.searchParams.get('q'), url.searchParams.get('dir'));
            return sendJSON(results);
        }
        
        
        
        // --- GIT TELEMETRY ---
        if (pathname === '/api/git/status' && req.method === 'GET') {
            const dir = url.searchParams.get('dir') || process.cwd();
            try {
                const { stdout } = await execPromise(`git -C "${dir}" status -s`);
                const staged = [];
                const unstaged = [];
                
                const lines = stdout.split('\n').filter(line => line.trim() !== '');
                lines.forEach(line => {
                    const statusCode = line.substring(0, 2);
                    const file = line.substring(3).trim();
                    
                    let uiStatus = 'U'; 
                    if (statusCode.includes('M')) uiStatus = 'M';
                    if (statusCode.includes('A')) uiStatus = 'A';
                    if (statusCode.includes('D')) uiStatus = 'D';

                    const item = { file, status: uiStatus };

                    if (statusCode[0] !== ' ' && statusCode[0] !== '?') staged.push(item);
                    if (statusCode[1] !== ' ') unstaged.push(item);
                });
                return sendJSON({ staged, unstaged });
            } catch (err) {
                // Return empty arrays if not a git repo to prevent UI crash
                return sendJSON({ staged: [], unstaged: [] });
            }
        }
    } catch (err) { return sendJSON({ error: err.message }, 500); }

    // --- POST API DATA ---
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);

                if (pathname === '/api/index') {
                    const dir = process.cwd();
                    forgeFS.indexFiles(dir, getEmbedding, (progress) => {
                        const telemetry = JSON.stringify({ type: 'progress', data: progress });
                        wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) client.send(telemetry);
                        });
                    }, { selectedFiles: data.selectedFiles }).then(() => {
                        const final = JSON.stringify({ type: 'progress', data: { percent: 100, file: 'STATIONARY' }});
                        wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(final); });
                    });
                    return sendJSON({ status: 'indexing_started' });
                }

                if (pathname === '/api/write') { forgeFS.writeFile(data.path, data.content); return sendJSON({ status: 'success' }); }
                if (pathname === '/api/create') { forgeFS.createFile(data.path); return sendJSON({ status: 'created' }); }
                
                // --- GIT AUTHOR CONFIGURATION ---
                if (pathname === '/api/git/config') {
                    const targetDir = data.dir || process.cwd();
                    try {
                        if (data.name) {
                            await execPromise(`git -C "${targetDir}" config user.name "${data.name}"`);
                        }
                        if (data.email) {
                            await execPromise(`git -C "${targetDir}" config user.email "${data.email}"`);
                        }
                        return sendJSON({ success: true });
                    } catch (err) {
                        return sendJSON({ error: err.message }, 500);
                    }
                }
                
                // --- GIT REMOTE MANAGEMENT ---
                if (pathname === '/api/git/remote') {
                    const targetDir = data.dir || process.cwd();
                    try {
                        try {
                            // Verify if 'origin' currently exists
                            await execPromise(`git -C "${targetDir}" remote get-url origin`);
                            // Overwrite existing origin
                            await execPromise(`git -C "${targetDir}" remote set-url origin "${data.url}"`);
                        } catch (e) {
                            // Establish new origin if none exists
                            await execPromise(`git -C "${targetDir}" remote add origin "${data.url}"`);
                        }
                        return sendJSON({ success: true });
                    } catch (err) {
                        return sendJSON({ error: err.message }, 500);
                    }
                }
                
                // --- GIT MECHANICS ---
                if (pathname === '/api/git/action') {
                    const targetDir = data.dir || process.cwd();
                    let command = '';
                    try {
                        switch (data.action) {
                            case 'init': command = `git -C "${targetDir}" init`; break; // <-- ADD THIS LINE
                            case 'stage': command = `git -C "${targetDir}" add "${data.file}"`; break;
                            case 'unstage': command = `git -C "${targetDir}" reset HEAD "${data.file}"`; break;
                            case 'add-all': command = `git -C "${targetDir}" add .`; break;
<<<<<<< HEAD
                            // --- UPGRADED SMART PUSH ---
                            case 'push': command = `git -C "${targetDir}" push -u origin HEAD`; break;
=======
                            case 'push': command = `git -C "${targetDir}" push`; break;
>>>>>>> e708ea6641308aa82db6c6a2ad456c230e7cfd55
                            case 'pull': command = `git -C "${targetDir}" pull`; break;
                        }
                        if (command) {
                            const { stdout, stderr } = await execPromise(command);
                            return sendJSON({ success: true, output: stdout || stderr });
                        }
                    } catch (err) { return sendJSON({ error: err.message }, 500); }
                }
                
                // --- GIT AUTHENTICATION ---
                if (pathname === '/api/git/auth') {
                    const targetDir = data.dir || process.cwd();
                    try {
                        // Retrieve the current remote URL
                        const { stdout: remoteUrl } = await execPromise(`git -C "${targetDir}" remote get-url origin`);
                        let cleanUrl = remoteUrl.trim();
                        
                        // Verify the protocol is HTTPS
                        if (cleanUrl.startsWith('https://')) {
                            // Strip existing token if one is already present
                            cleanUrl = cleanUrl.replace(/https:\/\/[^@]+@/, 'https://');
                            
                            // Inject the new PAT
                            const authUrl = cleanUrl.replace('https://', `https://${data.token}@`);
                            await execPromise(`git -C "${targetDir}" remote set-url origin "${authUrl}"`);
                            
                            return sendJSON({ success: true });
                        } else {
                            return sendJSON({ error: "Remote is not HTTPS. SSH keys must be configured via terminal." }, 400);
                        }
                    } catch (err) { 
                        return sendJSON({ error: err.message }, 500); 
                    }
                }
                
                if (pathname === '/api/git/commit') {
                    const targetDir = data.dir || process.cwd();
                    try {
                        const cleanMessage = data.message.replace(/"/g, '\\"');
                        const { stdout } = await execPromise(`git -C "${targetDir}" commit -m "${cleanMessage}"`);
                        return sendJSON({ success: true, output: stdout });
                    } catch (err) { return sendJSON({ error: err.message }, 500); }
                }

                if (pathname === '/api/ai') {
                    let context = "";
                    const query = data.history[data.history.length - 1].content;

                    if (fs.existsSync(VECTOR_INDEX_PATH)) {
                        try {
                            const qVec = await getEmbedding(query);
                            const fileStream = fs.createReadStream(VECTOR_INDEX_PATH);
                            const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

                            let matches = [];
                            for await (const line of rl) {
                                if (!line.trim()) continue;
                                try {
                                    const entry = JSON.parse(line);
                                    const score = cosineSimilarity(qVec, entry.vector);
                                    matches.push({ path: entry.path, text: entry.text, score });
                                    if (matches.length > 50) {
                                        matches.sort((a, b) => b.score - a.score);
                                        matches = matches.slice(0, 10);
                                    }
                                } catch (e) { /* Skip corrupt line */ }
                            }
                            matches.sort((a, b) => b.score - a.score);
                            const finalMatches = matches.slice(0, 5);
                            context = "\nTECHNICAL DATA:\n" + finalMatches.map(m => `[FILE: ${m.path}]\n${m.text}`).join('\n\n');
                        } catch (e) { console.error("RAG logic error."); }
                    }

                    const messages = [{ role: "system", content: systemContent + context }, ...data.history];
                    const payload = JSON.stringify({ model: CHAT_MODEL, messages, temperature: 0.1 });

                    const aiReq = http.request({
                        hostname: '127.0.0.1', port: 1234, path: '/v1/chat/completions', method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    }, (aiRes) => {
                        let d = ''; aiRes.on('data', chunk => d += chunk);
                        aiRes.on('end', () => { try { sendJSON(JSON.parse(d)); } catch(e) { sendJSON({error: "AI parse error"}, 500); } });
                    });
                    aiReq.write(payload); aiReq.end();
                }

                if (pathname === '/api/delete') {
                    forgeFS.deletePath(data.path);
                    return sendJSON({ status: 'deleted' });
                }

                if (pathname === '/api/rename') {
                    forgeFS.renamePath(data.oldPath, data.newPath);
                    return sendJSON({ status: 'renamed' });
                }

                if (pathname === '/api/mkdir') {
                    forgeFS.mkdir(data.path);
                    return sendJSON({ status: 'directory_created' });
                }
                
                if (pathname === '/api/shadow-test') {
                    const shadowPath = path.join('/tmp', 'crucible_shadow');
                    if (!fs.existsSync(shadowPath)) fs.mkdirSync(shadowPath, { recursive: true });

                    const tempFile = path.join(shadowPath, path.basename(data.path));
                    forgeFS.writeFile(tempFile, data.content);

                    let status = "Verification Success";
                    let error = null;
                    try {
                        if (tempFile.endsWith('.js')) {
                            require('child_process').execSync(`node --check ${tempFile}`);
                        }
                    } catch (e) {
                        status = "Verification Failed";
                        error = e.message;
                    }

                    return sendJSON({ status, error });
                }
                
            } catch (e) { sendJSON({ error: "Server protocol error" }, 500); }
        });
    }
});

const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
    const ptyProcess = pty.spawn('bash', [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env
    });

    ptyProcess.onData((data) => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            if (msg.type === 'input') ptyProcess.write(msg.data);
            if (msg.type === 'resize') ptyProcess.resize(msg.cols, msg.rows);
        } catch (e) {
            ptyProcess.write(message);
        }
    });

    ws.on('close', () => ptyProcess.kill());
});

server.listen(PORT, () => console.log(`[Crucible] operational: http://localhost:${PORT}`));