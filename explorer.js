const fs = require('fs').promises;
const path = require('path');

const Explorer = {
    async readFile(relativeFilePath) {
        const fullPath = path.resolve(relativeFilePath);
        return await fs.readFile(fullPath, 'utf8');
    },

    async writeFile(relativeFilePath, content) {
        const fullPath = path.resolve(relativeFilePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        return await fs.writeFile(fullPath, content, 'utf8');
    },

    async listFiles(dir = './', ignore = ['node_modules', '.git', 'brain']) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(entries.map((res) => {
            const resPath = path.resolve(dir, res.name);
            if (ignore.some(i => res.name.includes(i))) return [];
            return res.isDirectory() ? Explorer.listFiles(resPath, ignore) : resPath;
        }));
        return Array.prototype.concat(...files);
    }
};

module.exports = Explorer;
