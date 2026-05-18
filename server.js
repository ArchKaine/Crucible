const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const WebSocket = require('ws');
const pty = require('node-pty');
const {
    exec
} = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

// --- CONFIGURATION INGESTION & MANAGEMENT ---
const envPath = path.join(__dirname, '.env');
const USER_THEMES_PATH = path.join(__dirname, 'user_themes.json');

function loadEnv() {
    if (fs.existsSync(envPath)) {
        fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
        });
    }
}

function saveEnv(newSettings, callback) {
    let envMap = {};
    if (fs.existsSync(envPath)) {
        fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) envMap[match[1]] = match[2].replace(/^["']|["']$/g, '');
        });
    }

    for (const [key, value] of Object.entries(newSettings)) {
        envMap[key] = value;
        process.env[key] = value;
    }

    const envContent = Object.entries(envMap)
    .map(([k, v]) => `${k}="${v}"`)
    .join('\n');

    // Non-blocking file append stream handles storage execution safely
    fs.writeFile(envPath, envContent, 'utf8', (err) => {
        if (err) console.error(`[ERROR] Environment persistence allocation failure: ${err.message}`);
        if (callback) callback(err);
    });
}

loadEnv();

const PORT = process.env.CRUCIBLE_PORT || 3000;
const LMS_PORT = process.env.LMS_PORT || 1234;
const CHAT_MODEL = process.env.LMS_MODEL || "local-model";
const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-nomic-embed-text-v2-moe";

// Logic isolation
const forgeFS = require('./forge_fs');

const VECTOR_INDEX_PATH = path.join(__dirname, 'vector_index.jsonl');

let vectorCache = [];

function loadVectorCache() {
    try {
        if (fs.existsSync(VECTOR_INDEX_PATH)) {
            const rawData = fs.readFileSync(VECTOR_INDEX_PATH, 'utf8');
            vectorCache = rawData.split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));
            console.log(`[SYSTEM] In-memory vector cache loaded: ${vectorCache.length} coordinate blocks.`);
        } else {
            vectorCache = [];
        }
    } catch (e) {
        console.error("[ERROR] Failed to compile in-memory vector cache:", e.message);
    }
}

// Suppression of all interactive Git prompts to prevent background hangs
const GIT_ENV = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    core_askpass: ''
};

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
        const payload = JSON.stringify({
            model: EMBED_MODEL, input: text
        });
        const req = http.request({
            hostname: '127.0.0.1', port: LMS_PORT, path: '/v1/embeddings', method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data).data[0].embedding);
                } catch (e) {
                    reject("Embedding endpoint failure.");
                }
            });
        });
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error("Embedding Timeout"));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

const server = http.createServer(async (req, res) => {
    const sendJSON = (data, status = 200) => {
        if (res.writableEnded) return;
        res.writeHead(status, {
            'Content-Type': 'application/json'
        });
        res.end(JSON.stringify(data));
    };

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // --- GET ROUTER ---
    if (req.method === 'GET') {
        if (pathname === '/') {
            const uiPath = path.join(__dirname, 'ui', 'dashboard.html');
            if (fs.existsSync(uiPath)) {
                return res.end(fs.readFileSync(uiPath, 'utf8'));
            }
            return sendJSON({
                error: "Core UI missing."
            }, 404);
        }

        // Consolidated Static Asset Router
        if (pathname.startsWith('/ui/') || pathname.endsWith('.js') || pathname.endsWith('.css')) {
            const relativePath = pathname.startsWith('/ui/') ? pathname: path.join('/ui', pathname);
            let absolutePath = path.join(__dirname, relativePath);
            if (!fs.existsSync(absolutePath)) {
                absolutePath = path.join(__dirname, path.basename(pathname));
            }

            try {
                if (fs.existsSync(absolutePath) && fs.lstatSync(absolutePath).isFile()) {
                    const ext = path.extname(absolutePath);
                    const mimeTypes = {
                        '.js': 'application/javascript',
                        '.css': 'text/css',
                        '.png': 'image/png',
                        '.json': 'application/json'
                    };
                    res.writeHead(200, {
                        'Content-Type': mimeTypes[ext] || 'text/plain'
                    });
                    fs.createReadStream(absolutePath).pipe(res);
                    return;
                }
            } catch (err) {
                console.error(`[ROUTER ERROR] Failed to serve ${pathname}:`, err.message);
            }
            res.writeHead(404);
            return res.end();
        }

        if (pathname === '/api/settings') {
            const config = {
                theme: process.env.UI_THEME || 'chaos',
                edFont: process.env.UI_ED_FONT || 14,
                tmFont: process.env.UI_TM_FONT || 13,
                pat: process.env.GIT_PAT || '',
                repo: process.env.GIT_REPO || '',
                gitName: process.env.GIT_NAME || '',
                gitEmail: process.env.GIT_EMAIL || '',
                wordwrap: process.env.UI_WORDWRAP !== 'false',
                autoformat: process.env.UI_AUTOFORMAT !== 'false',
                customColors: {
                    base: process.env.UI_COLOR_BASE || '#000000',
                    panel: process.env.UI_COLOR_PANEL || '#050505',
                    surface: process.env.UI_COLOR_SURFACE || '#0a0a0a',
                    hover: process.env.UI_COLOR_HOVER || '#111111',
                    borderDark: process.env.UI_COLOR_BORDER_DARK || '#1a1a1a',
                    borderLight: process.env.UI_COLOR_BORDER_LIGHT || '#222222',
                    textDim: process.env.UI_COLOR_TEXT_DIM || '#444444',
                    textMuted: process.env.UI_COLOR_TEXT_MUTED || '#666666',
                    textMain: process.env.UI_COLOR_TEXT_MAIN || '#888888',
                    textBright: process.env.UI_COLOR_TEXT_BRIGHT || '#cccccc',
                    accent: process.env.UI_COLOR_ACCENT || '#569cd6'
                }
            };
            return sendJSON(config);
        }

        if (pathname === '/api/themes') {
            if (fs.existsSync(USER_THEMES_PATH)) {
                return res.end(fs.readFileSync(USER_THEMES_PATH, 'utf8'));
            }
            return sendJSON({});
        }

        if (pathname === '/api/files') {
            return sendJSON(forgeFS.listFiles(url.searchParams.get('dir') || process.cwd()));
        }

        if (pathname === '/api/read') {
            return res.end(forgeFS.readFile(url.searchParams.get('path')));
        }

        if (pathname === '/api/search') {
            try {
                const results = await forgeFS.searchFiles(url.searchParams.get('q'), url.searchParams.get('dir'));
                return sendJSON(results);
            } catch (e) {
                return sendJSON({
                    success: false,
                    error: e.message
                }, 200);
            }
        }

        if (pathname === '/api/git/status') {
            const dir = url.searchParams.get('dir') || process.cwd();
            try {
                const {
                    stdout
                } = await execPromise(`git -C "${dir}" status -s`, {
                        env: GIT_ENV
                    });
                const staged = [];
                const unstaged = [];
                const lines = stdout.split('\n').filter(line => line.trim() !== '');
                lines.forEach(line => {
                    const statusCode = line.substring(0, 2);
                    const file = line.substring(3).trim();
                    let uiStatus = statusCode.includes('M') ? 'M': statusCode.includes('A') ? 'A': statusCode.includes('D') ? 'D': 'U';
                    const item = {
                        file, status: uiStatus
                    };
                    if (statusCode[0] !== ' ' && statusCode[0] !== '?') staged.push(item);
                    if (statusCode[1] !== ' ') unstaged.push(item);
                });
                return sendJSON({
                    staged,
                    unstaged
                });
            } catch (err) {
                return sendJSON({
                    staged: [],
                    unstaged: []
                });
            }
        }

        // Structural catch boundary for unmapped GET calls to prevent frontend freeze
        if (!res.writableEnded) {
            res.writeHead(404, {
                'Content-Type': 'text/plain'
            });
            return res.end('Not Found');
        }
    }

    // --- POST ROUTER ---
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {

            try {
                const data = body ? JSON.parse(body): {};

                if (pathname === '/api/settings') {
                    const envUpdates = {
                        UI_THEME: data.theme,
                        UI_ED_FONT: data.edFont,
                        UI_TM_FONT: data.tmFont,
                        GIT_PAT: data.pat,
                        GIT_REPO: data.repo,
                        GIT_NAME: data.gitName,
                        GIT_EMAIL: data.gitEmail,
                        UI_WORDWRAP: data.wordwrap.toString(),
                        UI_AUTOFORMAT: data.autoformat.toString(),
                        UI_COLOR_BASE: data.customColors.base,
                        UI_COLOR_PANEL: data.customColors.panel,
                        UI_COLOR_SURFACE: data.customColors.surface,
                        UI_COLOR_HOVER: data.customColors.hover,
                        UI_COLOR_BORDER_DARK: data.customColors.borderDark,
                        UI_COLOR_BORDER_LIGHT: data.customColors.borderLight,
                        UI_COLOR_TEXT_DIM: data.customColors.textDim,
                        UI_COLOR_TEXT_MUTED: data.customColors.textMuted,
                        UI_COLOR_TEXT_MAIN: data.customColors.textMain,
                        UI_COLOR_TEXT_BRIGHT: data.customColors.textBright,
                        UI_COLOR_ACCENT: data.customColors.accent
                    };
                    saveEnv(envUpdates, (err) => {
                        if (err) {
                            return sendJSON({
                                error: "Failed to write host environments"
                            }, 500);
                        }
                        return sendJSON({
                            status: 'success'
                        });
                    });
                    return;
                }

                if (pathname === '/api/format') {
                    const targetFile = data.path;
                    const liveContent = data.content;

                    if (!targetFile || targetFile === 'undefined' || targetFile === 'null') {
                        return sendJSON({
                            success: false, error: "Invalid target file path reference mapping."
                        }, 200);
                    }

                    const ext = path.extname(targetFile);
                    if (ext !== '.py') {
                        return sendJSON({
                            success: false, error: "Formatter pipeline target profile is restricted to Python files."
                        }, 400);
                    }

                    try {
                        // Flush memory states straight to disk storage to sync file modifications
                        fs.writeFileSync(targetFile, liveContent, 'utf8');
                    } catch (writeErr) {
                        return sendJSON({
                            success: false, error: `Pre-format disk synchronization failed: ${writeErr.message}`
                        }, 200);
                    }

                    const {
                        exec
                    } = require('child_process');

                    // Execute through the Python interpreter module context to guarantee global execution path access
                    exec(`python3 -m ruff format "${targetFile}"`, {
                        env: process.env
                    }, (err, stdout, stderr) => {
                        if (err) {
                            // Environment fallback path if ruff is mapped directly to a global distribution binary
                            exec(`ruff format "${targetFile}"`, {
                                env: process.env
                            }, (fallbackErr, fStdout, fStderr) => {
                                if (fallbackErr) {
                                    const diagnosticErr = fStderr ? fStderr.toString().trim(): fallbackErr.message;
                                    return sendJSON({
                                        success: false,
                                        error: `Ruff execution blocked. Verify installation. Engine output: ${diagnosticErr}`
                                    }, 200);
                                }
                                readAndReturnFormatted();
                            });
                            return;
                        }
                        readAndReturnFormatted();
                    });

                    function readAndReturnFormatted() {
                        fs.readFile(targetFile, 'utf8', (readErr,
                            formattedContent) => {
                            if (readErr) {
                                return sendJSON({
                                    success: false, error: `Buffer retrieval exception: ${readErr.message}`
                                }, 200);
                            }
                            return sendJSON({
                                success: true,
                                content: formattedContent
                            });
                        });
                    }
                    return;
                }

                if (pathname === '/api/build') {
                    const targetFile = data.path;
                    const targetDir = path.dirname(targetFile);
                    const ext = path.extname(targetFile);

                    let command = '';
                    let args = [];

                    // Toolchain Router Configuration Matrix
                    switch (ext) {
                        case '.rs':
                            command = 'cargo';
                            args = ['build',
                                '--message-format=json']; // Delivers structured machine status tokens
                            break;
                        case '.cpp':
                            case '.c':
                                command = 'make'; // Assumes industrial standard build scripts exist in directory root
                                args = [];
                                break;
                            case '.py':
                                command = 'python3';
                                args = ['-m',
                                    'py_compile',
                                    targetFile];
                                break;
                            default:
                                return sendJSON({
                                    error: "Unsupported compiler target profile."
                                }, 400);
                            }

                            const {
                                spawn
                            } = require('child_process');
                            const buildProcess = spawn(command, args, {
                                cwd: targetDir, env: process.env
                            });

                            sendJSON({
                                status: 'build_started', file: path.basename(targetFile)
                            });

                            // Handle incoming stdout data streams from the compiler
                            buildProcess.stdout.on('data', (chunk) => {
                                const rawOutput = chunk.toString();
                                let percentParsed = null;

                                // Extract compilation metrics (e.g., parsing "Scanning dependencies of target...", "[ 50% ] Building...")
                                const cmakeMatch = rawOutput.match(/\[\s*(\d+)%\]/);
                                if (cmakeMatch) {
                                    percentParsed = parseInt(cmakeMatch[1]);
                                }

                                const packet = JSON.stringify({
                                    type: 'build_status',
                                    data: {
                                        stream: 'stdout',
                                        text: rawOutput,
                                        percent: percentParsed
                                    }
                                });
                                wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(packet));
                            });

                            // Handle incoming compiler diagnostics and failure telemetry
                            buildProcess.stderr.on('data',
                                (chunk) => {
                                    const rawError = chunk.toString();
                                    const packet = JSON.stringify({
                                        type: 'build_status',
                                        data: {
                                            stream: 'stderr',
                                            text: rawError,
                                            percent: null
                                        }
                                    });
                                    wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(packet));
                                });

                            buildProcess.on('close',
                                (code) => {
                                    const finalPacket = JSON.stringify({
                                        type: 'build_complete',
                                        data: {
                                            success: code === 0,
                                            exitCode: code
                                        }
                                    });
                                    wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(finalPacket));
                                });

                            return;
                    }

                    if (pathname === '/api/themes') {
                        fs.writeFile(USER_THEMES_PATH, JSON.stringify(data, null, 2), 'utf8', (err) => {
                            if (err) {
                                console.error(`[ERROR] Theme storage file allocation error: ${err.message}`);
                                return sendJSON({
                                    error: err.message
                                }, 500);
                            }
                            return sendJSON({
                                status: 'success'
                            });
                        });
                        return;
                    }

                    if (pathname === '/api/shutdown') {
                        sendJSON({
                            status: 'terminating'
                        });
                        const {
                            spawn
                    } = require('child_process');
                    const child = spawn('bash', ['launcher.sh', 'stop'], {
                        detached: true,
                        stdio: 'ignore',
                        cwd: process.cwd()
                });
                child.unref();
                return;
            }

            if (pathname === '/api/index') {
                const dir = process.cwd();
                forgeFS.indexFiles(dir, getEmbedding, (progress) => {
                    const telemetry = JSON.stringify({
                        type: 'progress', data: progress
                    });
                    wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(telemetry));
                }, {
                    selectedFiles: data.selectedFiles
                }).then(() => {
                    loadVectorCache(); // Hot-reload cache with newly generated indices
                    const final = JSON.stringify({
                        type: 'progress', data: {
                            percent: 100, file: 'STATIONARY'
                        }
                    });
                    wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(final));
                });
                return sendJSON({
                    status: 'indexing_started'
                });
            }

            if (pathname === '/api/write') {
                forgeFS.writeFile(data.path, data.content);
                return sendJSON({
                    status: 'success'
                });
            }

            if (pathname === '/api/create') {
                try {
                    forgeFS.createFile(data.path);
                    return sendJSON({
                        status: 'created'
                });
            } catch (err) {
                return sendJSON({
                    success: false, error: err.message
                }, 200);
            }
        }

            if (pathname === '/api/delete') {
                try {
                    forgeFS.deletePath(data.path);
                    return sendJSON({
                        status: 'deleted'
                    });
                } catch (err) {
                    return sendJSON({
                        success: false, error: err.message
                    }, 200);
                }
            }

            if (pathname === '/api/rename') {
                forgeFS.renamePath(data.oldPath, data.newPath);
                return sendJSON({
                    status: 'renamed'
                });
            }

            if (pathname === '/api/mkdir') {
                try {
                    forgeFS.mkdir(data.path);
                    return sendJSON({
                        status: 'directory_created'
                    });
                } catch (err) {
                    return sendJSON({
                        success: false, error: err.message
                    }, 200);
                }
            }

            if (pathname === '/api/git/config') {
                const targetDir = data.dir || process.cwd();
                try {
                    if (data.name) await execPromise(`git -C "${targetDir}" config user.name "${data.name}"`, {
                        env: GIT_ENV
                    });
                    if (data.email) await execPromise(`git -C "${targetDir}" config user.email "${data.email}"`, {
                        env: GIT_ENV
                    });
                    return sendJSON({
                        success: true
                    });
                } catch (err) {
                    return sendJSON({
                        success: false,
                        error: err.stderr ? err.stderr.toString().trim(): err.message
                    }, 200);
                }
            }

            if (pathname === '/api/git/remote') {
                const targetDir = data.dir || process.cwd();
                try {
                    try {
                        await execPromise(`git -C "${targetDir}" remote get-url origin`, {
                            env: GIT_ENV
                    });
                    await execPromise(`git -C "${targetDir}" remote set-url origin "${data.url}"`, {
                        env: GIT_ENV
                    });
                } catch (e) {
                    await execPromise(`git -C "${targetDir}" remote add origin "${data.url}"`, {
                        env: GIT_ENV
                    });
                }
                return sendJSON({
                    success: true
                });
            } catch (err) {
                return sendJSON({
                    success: false,
                    error: err.stderr ? err.stderr.toString().trim(): err.message
                }, 200);
            }
        }

        if (pathname === '/api/git/action') {
            const targetDir = data.dir || process.cwd();
            let command = '';
            switch (data.action) {
                case 'init': command = `git -C "${targetDir}" init`; break;
                case 'stage': command = `git -C "${targetDir}" add "${data.file}"`; break;
                case 'unstage': command = `git -C "${targetDir}" reset HEAD "${data.file}"`; break;
                case 'add-all': command = `git -C "${targetDir}" add .`; break;
                case 'commit':
                    const cleanMsg = data.message ? data.message.replace(/"/g, '\\"'): 'Update';
                    command = `git -C "${targetDir}" commit -m "${cleanMsg}"`;
                    break;
                case 'push': command = `git -C "${targetDir}" push -u origin HEAD`; break;
                case 'pull': command = `git -C "${targetDir}" pull`; break;
                default:
                    return sendJSON({
                        error: "Unknown action directive."
                    }, 400);
                }

                try {
                    const {
                        stdout,
                        stderr
                    } = await execPromise(command, {
                            env: GIT_ENV
                        });
                    return sendJSON({
                        success: true,
                        output: stdout || stderr
                    });
                } catch (gitError) {
                    // Intercept the rejection and return a clean 200 payload containing the true Git failure description
                    return sendJSON({
                        success: false,
                        error: gitError.stderr ? gitError.stderr.toString().trim(): gitError.message
                    }, 200);
                }
            }

            if (pathname === '/api/lint') {
                const targetFile = data.path;
                const ext = path.extname(targetFile);

                if (ext !== '.py') {
                    return sendJSON({
                        success: true, markers: []
                    });
                }

                const {
                    exec
                } = require('child_process');
                // Executes the native compiler checker to catch structural flaws before execution
                exec(`python3 -m py_compile "${targetFile}"`, {
                    env: process.env
                }, (err, stdout, stderr) => {
                    const markers = [];

                    if (err && stderr) {
                        const rawLines = stderr.split('\n');
                        let lineNum = 1;
                        let errorMessage = "Python syntax error encountered.";

                        // Extract exact line indices from the compiler traceback stream
                        const lineMatch = stderr.match(/line (\d+)/);
                        if (lineMatch) {
                            lineNum = parseInt(lineMatch[1]);
                        }

                        // Isolate the root exception description line
                        const exceptionLine = rawLines.find(l => l.match(/^\w+Error:/) || l.includes('SyntaxError'));
                        if (exceptionLine) {
                            errorMessage = exceptionLine.trim();
                        }

                        markers.push({
                            row: lineNum - 1, // Normalizes coordinate mapping to match Ace Editor base-0 index
                            column: 0,
                            text: errorMessage,
                            type: "error"
                        });
                    }

                    return sendJSON({
                        success: markers.length === 0,
                        markers: markers
                    });
                });
                return;
            }

            if (pathname === '/api/git/auth') {
                const targetDir = data.dir || process.cwd();
                try {
                    const {
                        stdout: remoteUrl
                    } = await execPromise(`git -C "${targetDir}" remote get-url origin`, {
                            env: GIT_ENV
                        });
                    let cleanUrl = remoteUrl.trim().replace(/https:\/\/[^@]+@/, 'https://');
                    if (cleanUrl.startsWith('https://')) {
                        const githubUser = cleanUrl.split('/')[3];
                        const authUrl = cleanUrl.replace('https://', `https://${githubUser}:${data.token}@`);
                        await execPromise(`git -C "${targetDir}" remote set-url origin "${authUrl}"`, {
                            env: GIT_ENV
                        });
                        return sendJSON({
                            success: true
                        });
                    }
                    return sendJSON({
                        error: "Remote is not HTTPS."
                    }, 400);
                } catch (err) {
                    return sendJSON({
                        success: false,
                        error: err.stderr ? err.stderr.toString().trim(): err.message
                    }, 200);
                }
            }

            if (pathname === '/api/ai') {
                const query = data.history[data.history.length - 1].content;
                let context = "";

                if (vectorCache.length > 0) {
                    try {
                        const qVec = await getEmbedding(query);
                        let matches = [];

                        for (const entry of vectorCache) {
                            const score = cosineSimilarity(qVec, entry.vector);
                            matches.push({
                                path: entry.path, text: entry.text, score
                            });
                            if (matches.length > 50) {
                                matches.sort((a, b) => b.score - a.score);
                                matches = matches.slice(0, 10);
                            }
                        }
                        matches.sort((a, b) => b.score - a.score);
                        context = "\nTECHNICAL DATA:\n" + matches.slice(0, 5).map(m => `[FILE: ${m.path}]\n${m.text}`).join('\n\n');
                    } catch (e) {
                        console.error("In-memory tracking evaluation failure:", e.message);
                    }
                }

                const messages = [{
                    role: "system",
                    content: systemContent + context
                },
                    ...data.history
                ];
                const aiReq = http.request({
                    hostname: '127.0.0.1', port: LMS_PORT, path: '/v1/chat/completions', method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }, (aiRes) => {
                    let d = '';
                    aiRes.on('data', chunk => d += chunk);
                    aiRes.on('end', () => sendJSON(JSON.parse(d)));
                });
                aiReq.write(JSON.stringify({
                    model: CHAT_MODEL, messages, temperature: 0.1
                }));
                aiReq.end();
                return;
            }

            if (pathname === '/api/shadow-test') {
                try {
                    const shadowPath = path.join('/tmp', 'crucible_shadow');
                    if (!fs.existsSync(shadowPath)) fs.mkdirSync(shadowPath, {
                        recursive: true
                    });
                    const tempFile = path.join(shadowPath, path.basename(data.path));
                    forgeFS.writeFile(tempFile, data.content);
                    const ext = path.extname(tempFile);
                    let status = "Verification Success";
                    let error = null;
                    try {
                        switch (ext) {
                            case '.js':
                                require('child_process').execSync(`node --check ${tempFile}`, {
                                    stdio: 'pipe'
                                });
                                break;
                            case '.rs':
                                require('child_process').execSync(`rustc --color=never --out-dir ${shadowPath} ${tempFile}`, {
                                    stdio: 'pipe'
                                });
                                break;
                            case '.py':
                                require('child_process').execSync(`python3 -m py_compile ${tempFile}`, {
                                    stdio: 'pipe'
                                });
                                break;
                            case '.cs':
                                require('child_process').execSync(`dotnet build /p:OutputPath=${shadowPath} ${tempFile}`, {
                                    stdio: 'pipe'
                                });
                                break;
                            case '.html':
                                case '.css':
                                    case '.json':
                                        status = "Verification Skipped (Static File)";
                                        break;
                                    default:
                                        status = "Unverified (Unknown Extension)";
                                    }
                            } catch (e) {
                                status = "Verification Failed";
                                error = e.stderr ? e.stderr.toString(): e.message;
                        }
                        return sendJSON({
                            status, error
                    });
                } catch (outerErr) {
                    return sendJSON({
                        status: "Verification Failed",
                        error: `System allocation exception: ${outerErr.message}`
                    }, 200);
                }
            }

            // Fallback catch boundary inside the async post block for unmapped POST routes
            if (!res.writableEnded) {
                return sendJSON({
                    error: "Endpoint not found"
                }, 404);
            }

        } catch (e) {
            sendJSON({
                error: e.stderr || e.message
            }, 500);
        }
    });
    return;
}
}); // END HTTP SERVER

// --- TOP-LEVEL WEBSOCKET & LISTEN BINDINGS ---
const wss = new WebSocket.Server({
server
});

wss.on('connection', (ws) => {
const ptyProcess = pty.spawn('bash',
[],
{
name: 'xterm-256color',
cols: 80,
rows: 24,
cwd: process.cwd(),
env: process.env
});

ptyProcess.onData((data) => {
if (ws.readyState === WebSocket.OPEN) ws.send(data);
});

ws.on('message',
(m) => {
try {
const msg = JSON.parse(m);
if (msg.type === 'input') ptyProcess.write(msg.data);
if (msg.type === 'resize') ptyProcess.resize(msg.cols, msg.rows);
} catch (e) {
ptyProcess.write(m);
}
});

ws.on('close',
() => ptyProcess.kill());
});

server.listen(PORT, () => {
loadVectorCache(); // Hydrate the memory space before server starts accepting traffic
console.log(`[Crucible] operational: http://localhost:${PORT}`);
});