const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

module.exports = {
    // --- PATH VALIDATION SHIELD ---
    validatePath: (targetPath) => {
        const rootDir = process.cwd();
        const resolvedPath = path.resolve(targetPath);
        if (!resolvedPath.startsWith(rootDir)) {
            throw new Error("SECURITY VIOLATION: Directory traversal blocked.");
        }
        return resolvedPath;
    },

    // Generates the data for the recursive tree builder
    listFiles: (targetDir) => {
        const secureDir = module.exports.validatePath(targetDir);
        if (!fs.existsSync(secureDir)) throw new Error("Directory does not exist.");

        const list = fs.readdirSync(secureDir, { withFileTypes: true }).map(e => ({
            name: e.name,
            path: path.join(secureDir, e.name),
                                                                                  isDirectory: e.isDirectory()
        })).sort((a, b) => b.isDirectory - a.isDirectory || a.name.localeCompare(b.name));

        return { currentDir: secureDir, entries: list };
    },

    // Standard File Operations
    readFile: (targetPath) => {
        const securePath = module.exports.validatePath(targetPath);
        if (!fs.existsSync(securePath)) throw new Error("File not found.");
        return fs.readFileSync(securePath, 'utf8');
    },

    writeFile: (targetPath, content) => {
        const securePath = module.exports.validatePath(targetPath);
        fs.writeFileSync(securePath, content);
    },

    createFile: (targetPath) => {
        const securePath = module.exports.validatePath(targetPath);
        fs.writeFileSync(securePath, '');
    },

    // --- INDUSTRIAL MANAGEMENT HOOKS ---
    deletePath: (targetPath) => {
        const securePath = module.exports.validatePath(targetPath);
        if (!fs.existsSync(securePath)) return;
        fs.rmSync(securePath, { recursive: true, force: true });
    },

    renamePath: (oldPath, newPath) => {
        const secureOld = module.exports.validatePath(oldPath);
        const secureNew = module.exports.validatePath(newPath);
        if (!fs.existsSync(secureOld)) throw new Error("Source path does not exist.");
        fs.renameSync(secureOld, secureNew);
    },

    mkdir: (targetPath) => {
        const securePath = module.exports.validatePath(targetPath);
        if (!fs.existsSync(securePath)) {
            fs.mkdirSync(securePath, { recursive: true });
        }
    },

    // RECURSIVE INDEXING ENGINE
    indexFiles: async (dir, getEmbedding, onProgress, options = {}) => {
        const indexPath = path.join(process.cwd(), 'vector_index.jsonl');
        const indexedPaths = new Set();

        const extensions = options.extensions || ['js', 'py', 'md', 'txt', 'html', 'css', 'json', 'c', 'cpp', 'h', 'rs', 'go'];
        const excludes = options.excludes || ['node_modules', '.git', 'ui', '.venv', 'dist', 'build'];
        const extRegex = new RegExp(`\\.(${extensions.join('|')})$`, 'i');

        if (fs.existsSync(indexPath)) {
            const rawData = fs.readFileSync(indexPath, 'utf8');
            const lines = rawData.split('\n');
            lines.forEach(line => {
                if (line.trim()) {
                    try {
                        const entry = JSON.parse(line);
                        indexedPaths.add(entry.path);
                    } catch (e) { /* Skip corrupt line */ }
                }
            });
        }

        let filesToProcess = [];

        if (options.selectedFiles && options.selectedFiles.length > 0) {
            filesToProcess = options.selectedFiles.filter(f => extRegex.test(f));
        } else {
            function gatherFiles(currentDir) {
                try {
                    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(currentDir, entry.name);
                        if (entry.isDirectory()) {
                            if (!excludes.includes(entry.name)) {
                                gatherFiles(fullPath);
                            }
                        } else if (extRegex.test(entry.name)) {
                            filesToProcess.push(fullPath);
                        }
                    }
                } catch (e) { console.error(`Access denied: ${currentDir}`); }
            }
            gatherFiles(dir);
        }

        const total = filesToProcess.length;
        const stream = fs.createWriteStream(indexPath, { flags: 'a' });

        for (let i = 0; i < total; i++) {
            const filePath = filesToProcess[i];

            if (indexedPaths.has(filePath)) {
                onProgress({
                    current: i + 1,
                    total: total,
                    file: `SKIPPED: ${path.basename(filePath)}`,
                           percent: Math.round(((i + 1) / total) * 100)
                });
                continue;
            }

            try {
                const content = fs.readFileSync(filePath, 'utf8');
                if (content.trim().length > 0 && content.length < 200000) {
                    const vector = await getEmbedding(content);
                    const entry = {
                        path: filePath,
                        text: content.substring(0, 2500),
                        vector: vector
                    };
                    stream.write(JSON.stringify(entry) + '\n');
                }
            } catch (e) {
                console.error(`Sync error on ${filePath}: ${e.message}`);
            }

            onProgress({
                current: i + 1,
                total: total,
                file: path.basename(filePath),
                       percent: Math.round(((i + 1) / total) * 100)
            });
        }

        stream.end();
        return true;
    },

    // --- SECURE GREP SEARCH ---
    searchFiles: (query, dir) => {
        return new Promise((resolve) => {
            const secureDir = module.exports.validatePath(dir || process.cwd());

            // Strip dangerous shell characters
            const sanitizedQuery = query.replace(/(["'$`\\])/g, '\\$1');
            const cmd = `grep -riIn "${sanitizedQuery}" "${secureDir}" --exclude-dir={.git,node_modules,ui}`;

            exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
                const results = (stdout || "").split('\n').filter(l => l.trim() !== "").map(line => {
                    const [f, n, ...t] = line.split(':');
                    return { path: f, line: n, text: t.join(':').trim() };
                });
                resolve(results);
            });
        });
    }
};
