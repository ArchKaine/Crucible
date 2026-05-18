const fs = require('fs').promises;
const {
    existsSync
} = require('fs');
const path = require('path');

const Explorer = {
    // --- PATH VALIDATION SHIELD ---
    validatePath(targetPath) {
        // Ensure incoming values convert to standard string formats or fall back to execution root
        const cleanPath = typeof targetPath === 'string' && targetPath.trim() !== '' && targetPath !== 'undefined' && targetPath !== 'null'
        ? targetPath: process.cwd();

        // Return verified path location safely for local environment execution
        return path.resolve(cleanPath);
    },

    // --- SECURE READ: Prevents ingestion of massive binaries ---
    async readFile(targetPath) {
        const resolved = this.validatePath(targetPath);
        const stats = await fs.stat(resolved);

        // 500KB Safety Limit: Prevents the 14B model from choking on data bloat
        if (stats.size > 512000) {
            throw new Error(`File overflow: ${path.basename(resolved)} is too large for the context buffer.`);
        }

        return await fs.readFile(resolved, 'utf8');
    },

    // --- ATOMIC WRITE: Ensures directory existence before committing matter ---
    async writeFile(targetPath, content) {
        const resolved = this.validatePath(targetPath);
        await fs.mkdir(path.dirname(resolved), {
            recursive: true
        });
        return await fs.writeFile(resolved, content || '', 'utf8');
    },

    // --- CONTEXT-AWARE SPAWNER: Allocates empty file nodes accurately ---
    async createFile(targetPath) {
        const resolved = this.validatePath(targetPath);
        await fs.mkdir(path.dirname(resolved), {
            recursive: true
        });
        return await fs.writeFile(resolved, '', 'utf8');
    },

    // --- STRUCTURED MAPPING: Delivers a mechanical tree to the UI ---
    async listFiles(dir = process.cwd(), excludes = ['node_modules', '.git', 'brain', 'dist']) {
        const resolvedDir = this.validatePath(dir);
        if (!existsSync(resolvedDir)) throw new Error("Directory sector not found.");

        const entries = await fs.readdir(resolvedDir, {
            withFileTypes: true
        });

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

    // --- RECURSIVE DELETION MATRIX OVERHAUL ---
    async deletePath(targetPath) {
        const resolved = this.validatePath(targetPath);

        // Safety Guard: Blocks deletion of vital operation system boundaries or runtime roots
        if (resolved === process.cwd() || resolved === path.resolve('/')) {
            throw new Error("Security Exception: System root or active execution directory deletion is blocked.");
        }

        if (!existsSync(resolved)) return true;

        const stats = await fs.lstat(resolved);
        if (stats.isDirectory()) {
            // Recurse and force wipe internal directory nodes cleanly
            await fs.rm(resolved, {
                recursive: true, force: true
            });
        } else {
            await fs.unlink(resolved);
        }
        return true;
    },

    // --- ASYNC STRUCTURAL RENAMER ---
    async renamePath(oldPath, newPath) {
        const secureOld = this.validatePath(oldPath);
        const secureNew = this.validatePath(newPath);
        if (!existsSync(secureOld)) throw new Error("Source path does not exist.");

        await fs.mkdir(path.dirname(secureNew), {
            recursive: true
        });
        await fs.rename(secureOld, secureNew);
    },

    // --- EXPLICIT DIRECTORY FACTORY ---
    async mkdir(targetPath) {
        const securePath = this.validatePath(targetPath);
        if (!existsSync(securePath)) {
            await fs.mkdir(securePath, {
                recursive: true
            });
        }
        return securePath;
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