const fs = require('fs').promises;
const { existsSync } = require('fs');
const path = require('path');

const Explorer = {
    // --- SECURE READ: Prevents ingestion of massive binaries ---
    async readFile(targetPath) {
        const resolved = path.resolve(targetPath);
        const stats = await fs.stat(resolved);
        
        // 500KB Safety Limit: Prevents the 14B model from choking on data bloat
        if (stats.size > 512000) {
            throw new Error(`File overflow: ${path.basename(resolved)} is too large for the context buffer.`);
        }
        
        return await fs.readFile(resolved, 'utf8');
    },

    // --- ATOMIC WRITE: Ensures directory existence before committing matter ---
    async writeFile(targetPath, content) {
        const resolved = path.resolve(targetPath);
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        return await fs.writeFile(resolved, content, 'utf8');
    },

    // --- STRUCTURED MAPPING: Delivers a mechanical tree to the UI ---
    async listFiles(dir = process.cwd(), excludes = ['node_modules', '.git', 'brain', 'dist']) {
        const resolvedDir = path.resolve(dir);
        if (!existsSync(resolvedDir)) throw new Error("Directory sector not found.");

        const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
        
        const list = entries
            .filter(e => !excludes.includes(e.name))
            .map(e => ({
                name: e.name,
                path: path.join(resolvedDir, e.name),
                isDirectory: e.isDirectory(),
                ext: e.name.split('.').pop()
            }))
            // Sort: Directories first, then alphabetical
            .sort((a, b) => b.isDirectory - a.isDirectory || a.name.localeCompare(b.name));

        return {
            currentDir: resolvedDir,
            entries: list
        };
    },

    // --- SHADOW CLONE: Rapidly duplicates structures for the Shadow Forge ---
    async cloneToShadow(sourcePath, shadowDir) {
        const fileName = path.basename(sourcePath);
        const target = path.join(shadowDir, fileName);
        const content = await this.readFile(sourcePath);
        await this.writeFile(target, content);
        return target;
    }
};

module.exports = Explorer;