#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = path.dirname(process.argv[1]);
const SOURCE_DIR = path.join(SCRIPT_DIR, 'ui', 'js');

const MODULE_NAMESPACES = [
    'Crucible.modules.fs',
    'Crucible.modules.git',
    'Crucible.modules.ai',
    'Crucible.modules.settings',
    'Crucible.modules.editor'
];

function revert() {
    const files = fs.readdirSync(SOURCE_DIR);

    files.forEach(file => {
        if (!file.endsWith('.js') || file === 'revert_injection.js') return;

        const filePath = path.join(SOURCE_DIR, file);
        let content = fs.readFileSync(filePath, 'utf8');

        // Regex: Matches (namespace.name = function() or namespace.name = async function()
        // Replaces with: function name() or async function name()
        MODULE_NAMESPACES.forEach(ns => {
            const regex = new RegExp(`${ns}\\.(\\w+)\\s*=\\s*(async\\s+)?function\\s*\\(`, 'g');
            content = content.replace(regex, (match, funcName, isAsync) => {
                const asyncPrefix = isAsync ? isAsync: '';
                return `${asyncPrefix}function ${funcName}(`;
            });
        });

        fs.writeFileSync(filePath, content);
        console.log(`[REVERTED] ${file} signatures restored.`);
    });
}

revert();