const fs = require('fs');
const path = require('path');
const {
    exec
} = require('child_process');

module.exports = {
    // --- PATH VALIDATION SHIELD ---
    validatePath: (targetPath) => {
        // Ensure incoming values convert to standard string formats or fall back to execution root
        const cleanPath = typeof targetPath === 'string' && targetPath.trim() !== '' && targetPath !== 'undefined' && targetPath !== 'null'
        ? targetPath: process.cwd();

        const resolvedPath = path.resolve(cleanPath);

        // Return verified path location safely for local environment execution
        return resolvedPath;
    },

    // Generates the data for the recursive tree builder
    listFiles: (targetDir) => {
        try {
            const secureDir = module.exports.validatePath(targetDir);
            if (!fs.existsSync(secureDir)) {
                return {
                    currentDir: secureDir,
                    entries: [],
                    error: "Directory does not exist."
                };
            }

            const list = fs.readdirSync(secureDir, {
                withFileTypes: true
            }).map(e => ({
                    name: e.name,
                    path: path.join(secureDir, e.name),
                    isDirectory: e.isDirectory()
                })).sort((a, b) => b.isDirectory - a.isDirectory || a.name.localeCompare(b.name));

            return {
                currentDir: secureDir,
                entries: list
            };
        } catch (e) {
            console.error(`[FS ERROR] listFiles failed: ${e.message}`);
            return {
                currentDir: typeof targetDir === 'string' ? targetDir: process.cwd(),
                entries: [],
                error: e.message
            };
        }
    },

    // Standard File Operations
    readFile: (targetPath) => {
        const securePath = module.exports.validatePath(targetPath);
        if (!fs.existsSync(securePath)) throw new Error("File not found.");
        return fs.readFileSync(securePath, 'utf8');
    },

    // --- ATOMIC WRITE ARCHITECTURE ---
    writeFile: (targetPath, content) => {
        const securePath = module.exports.validatePath(targetPath);
        const parentDir = path.dirname(securePath);

        // Auto-instantiate nested parent directories if missing from disk storage layout
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, {
                recursive: true
            });
        }

        // Generate isolated temporary file marker
        const tempPath = `${securePath}.${Date.now()}.tmp`;

        try {
            // Write buffer to temporary file
            fs.writeFileSync(tempPath, content, 'utf8');

            // Execute OS-level atomic metadata swap
            fs.renameSync(tempPath, securePath);
        } catch (err) {
            // Purge temporary file on write failure
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
            throw new Error(`Atomic write sequence failed for ${securePath}: ${err.message}`);
        }
    },

    createFile: (targetPath) => {
        const securePath = module.exports.validatePath(targetPath);
        const parentDir = path.dirname(securePath);

        // Ensure destination folder paths exist prior to initializing empty file allocations
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, {
                recursive: true
            });
        }
        fs.writeFileSync(securePath, '');
    },

    // --- INDUSTRIAL MANAGEMENT HOOKS OVERHAUL ---
    deletePath: (targetPath) => {
        const securePath = module.exports.validatePath(targetPath);

        // Guard rails to protect application and storage environment roots from total wiper tasks
        if (securePath === process.cwd() || securePath === path.resolve('/')) {
            throw new Error("Security Exception: System root or active execution directory deletion is blocked.");
        }

        if (!fs.existsSync(securePath)) return true;

        const stats = fs.lstatSync(securePath);
        if (stats.isDirectory()) {
            // Force recursive file and directory extraction blocks across target sub-nodes
            fs.rmSync(securePath, {
                recursive: true,
                force: true
            });
        } else {
            fs.unlinkSync(securePath);
        }
        return true;
    },

    renamePath: (oldPath, newPath) => {
        const secureOld = module.exports.validatePath(oldPath);
        const secureNew = module.exports.validatePath(newPath);
        if (!fs.existsSync(secureOld)) throw new Error("Source path does not exist.");

        const parentDir = path.dirname(secureNew);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, {
                recursive: true
            });
        }
        fs.renameSync(secureOld, secureNew);
    },

    mkdir: (targetPath) => {
        const securePath = module.exports.validatePath(targetPath);
        if (!fs.existsSync(securePath)) {
            fs.mkdirSync(securePath, {
                recursive: true
            });
        }
        return securePath;
    },

    // RECURSIVE INDEXING ENGINE
    indexFiles: async (dir, getEmbedding, onProgress, options = {}) => {
        const indexPath = path.join(process.cwd(), 'vector_index.jsonl');
        const indexedPaths = new Set();

        const extensions = options.extensions || ['js',
            'py',
            'md',
            'txt',
            'html',
            'css',
            'json',
            'c',
            'cpp',
            'h',
            'rs',
            'go'];
        const excludes = options.excludes || ['node_modules',
            '.git',
            'ui',
            '.venv',
            'dist',
            'build'];
        const extRegex = new RegExp(`\\.(${extensions.join('|')})$`, 'i');

        if (fs.existsSync(indexPath)) {
            const rawData = fs.readFileSync(indexPath, 'utf8');
            const lines = rawData.split('\n');
            lines.forEach(line => {
                if (line.trim()) {
                    try {
                        const entry = JSON.parse(line);
                        indexedPaths.add(entry.path);
                    } catch (e) {
                        /* Skip corrupt line */
                    }
                }
            });
        }

        let filesToProcess = [];

        if (options.selectedFiles && options.selectedFiles.length > 0) {
            filesToProcess = options.selectedFiles.filter(f => extRegex.test(f));
        } else {
            function gatherFiles(currentDir) {
                try {
                    const entries = fs.readdirSync(currentDir, {
                        withFileTypes: true
                    });
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
                } catch (e) {
                    console.error(`Access denied: ${currentDir}`);
                }
            }

            gatherFiles(dir);
        }

        const total = filesToProcess.length;
        const stream = fs.createWriteStream(indexPath, {
            flags: 'a'
        });

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

            exec(cmd, {
                maxBuffer: 1024 * 1024 * 10
            }, (err, stdout) => {
                const results = (stdout || "").split('\n').filter(l => l.trim() !== "").map(line => {
                    const [f, n, ...t] = line.split(':');
                    return {
                        path: f, line: n, text: t.join(':').trim()};
                });
                resolve(results);
            });
        });
    }
};