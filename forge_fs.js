const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

module.exports = {
    // Generates the data for the recursive tree builder
    listFiles: (targetDir) => {
        const resolved = path.resolve(targetDir);
        if (!fs.existsSync(resolved)) throw new Error("Directory does not exist.");
        
        const list = fs.readdirSync(resolved, { withFileTypes: true }).map(e => ({
            name: e.name, 
            path: path.join(resolved, e.name), 
            isDirectory: e.isDirectory()
        })).sort((a, b) => b.isDirectory - a.isDirectory || a.name.localeCompare(b.name));
        
        return { currentDir: resolved, entries: list };
    },

    // Standard File Operations
    readFile: (targetPath) => {
        if (!targetPath || !fs.existsSync(targetPath)) throw new Error("File not found.");
        return fs.readFileSync(targetPath, 'utf8');
    },

    writeFile: (targetPath, content) => {
        if (!targetPath) throw new Error("Invalid path.");
        fs.writeFileSync(targetPath, content);
    },

    createFile: (targetPath) => {
        if (!targetPath) throw new Error("Invalid path.");
        fs.writeFileSync(targetPath, '');
    },

    // --- INDUSTRIAL MANAGEMENT HOOKS ---
    deletePath: (targetPath) => {
        if (!fs.existsSync(targetPath)) return;
        // Recursive rm handles both files and lore-folder structures
        fs.rmSync(targetPath, { recursive: true, force: true });
    },

    renamePath: (oldPath, newPath) => {
        if (!fs.existsSync(oldPath)) throw new Error("Source path does not exist.");
        fs.renameSync(oldPath, newPath);
    },

    mkdir: (targetPath) => {
        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
        }
    },

    // RECURSIVE INDEXING ENGINE (DYNAMIC, TARGETED & STREAMING)
    indexFiles: async (dir, getEmbedding, onProgress, options = {}) => {
        const indexPath = path.join(process.cwd(), 'vector_index.jsonl');
        const indexedPaths = new Set();

        // DEFAULT FILTERS
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

    // --- GREP-BASED GLOBAL SEARCH ---
    searchFiles: (query, dir) => {
        return new Promise((resolve) => {
            const resolvedDir = dir || process.cwd();
            
            // Detection: If the model includes flags or paths, treat as a raw pattern string.
            // Otherwise, wrap it to ensure spaces in simple queries don't break the shell.
            const isAdvanced = query.includes(' -e ') || query.includes('-i') || query.includes('./');
            let pattern = isAdvanced ? query : `"${query}"`;

            // If the model prepended the directory (e.g., "./lore -e ..."), strip it 
            // since we already define the target directory in the command.
            pattern = pattern.replace(/^\.?\/?lore\s+/, '');

            const cmd = `grep -riIn ${pattern} "${resolvedDir}" --exclude-dir={.git,node_modules,ui}`;
            
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