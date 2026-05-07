const fs = require('fs');
const path = require('path');
const Explorer = require('./explorer');

async function runInitialIndexing() {
    console.log("System: Mapping project structure...");
    const files = await Explorer.listFiles('./');
    const manifest = [];

    for (const file of files) {
        const content = await Explorer.readFile(file);
        const stats = fs.statSync(file);
        
        manifest.push({
            path: path.relative(process.cwd(), file),
            size: stats.size,
            lastModified: stats.mtime,
            segments: content.split(/\n(?=function|class|const|async)/g).length
        });
    }

    await Explorer.writeFile('./brain/project_map.json', JSON.stringify(manifest, null, 2));
    console.log(`System: Index complete. ${manifest.length} files tracked.`);
}

runInitialIndexing();
