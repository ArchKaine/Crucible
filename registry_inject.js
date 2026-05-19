#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = path.dirname(process.argv[1]);
const SOURCE_DIR = path.join(SCRIPT_DIR, 'ui', 'js');

const MODULE_REGISTRY_MAP = {
    'filesystem.js': 'Crucible.modules.fs',
    'git.js': 'Crucible.modules.git',
    'ai_core.js': 'Crucible.modules.ai',
    'settings.js': 'Crucible.modules.settings',
    'editor.js': 'Crucible.modules.editor'
};

function injectRegistry() {
    // 1. Initialize Global Registry Object in a separate file if it doesn't exist
    const registryEntry = `window.Crucible = { modules: { fs: {}, git: {}, ai: {}, settings: {}, editor: {} } };\n\n`;
    fs.writeFileSync(path.join(SOURCE_DIR, 'globals.js'), registryEntry);

    Object.keys(MODULE_REGISTRY_MAP).forEach(file => {
        const filePath = path.join(SOURCE_DIR, file);
        if (!fs.existsSync(filePath)) return;

        let content = fs.readFileSync(filePath, 'utf8');
        const namespace = MODULE_REGISTRY_MAP[file];

        // 2. Regex: Find standard or async function definitions
        // Groups: 1=async, 2=name
        const regex = /(async\s+)?function\s+(\w+)\s*\(/g;

        let updated = content.replace(regex, (match, isAsync, funcName) => {
            // Check if already namespaced to prevent double-wrapping
            if (content.includes(`${namespace}.${funcName}`)) return match;

            const asyncPrefix = isAsync ? 'async ': '';
            return `${namespace}.${funcName} = ${asyncPrefix}function(`;
        });

        fs.writeFileSync(filePath,
            updated);
        console.log(`[ARMORED] ${file} -> ${namespace}`);
    });
}

injectRegistry();