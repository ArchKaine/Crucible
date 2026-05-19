#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// This forces the script to look at the directory where the script is saved
const SCRIPT_DIR = path.dirname(process.argv[1]);
const SOURCE_DIR = path.join(SCRIPT_DIR, 'ui', 'js');
const MODULE_MAP = {
    'filesystem.js': /(loadTree|updateBreadcrumbs|goBack|goForward|goUp|openFile|createTabUI|refreshTabVisuals|switchTab|closeTab|saveFile|renameItem|deleteItem|createNewFile|createNewFolder|runGlobalSearch)/,
    'git.js': /(refreshGitStatus|createGitItem|gitAction|createBranch|mergeBranch|initGitRepo|commitChanges)/,
    'ai_core.js': /(askAI|runShadowTest|validateWebCode|runAutomatedTests|startIndexing|applyDiffMerge)/,
    'settings.js': /(updateSystemStatus|shutdownCrucible|switchSidebar|toggleCustomThemeEditor|populateThemeDropdown|saveCustomThemeToDisk|applySettings|loadSettings|saveSettings|openSettings|closeSettings|switchSettingsTab)/,
    'editor.js': /(initResizers|toggleAutoFormat|triggerManualFormat|toggleSplitView|toggleTerminal|toggleWrap|togglePreview|setViewport|togglePreviewBackground|renderPreview)/
};

function shatter() {
    const files = fs.readdirSync(SOURCE_DIR);
    let masterBuffer = "";

    // 1. Gather all existing content
    files.forEach(file => {
        if (file.endsWith('.js') && file !== 'Demonolithilator.js') {
            masterBuffer += fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8') + "\n";
        }
    });

    console.log("[SYSTEM] Re-sorting logic blocks with deduplication...");

    Object.keys(MODULE_MAP).forEach(fileName => {
        const regex = MODULE_MAP[fileName];
        let moduleContent = "";
        const seenFunctions = new Set(); // DEDUPLICATION LOGIC

        // Regex: Matches (async) function name(...) { ... }
        const functionBlocks = masterBuffer.match(/(async\s+)?function\s+\w+[\s\S]*?^}/gm) || [];

        functionBlocks.forEach(block => {
            const match = block.match(/function\s+(\w+)/);
            if (match) {
                const funcName = match[1];

                // Only write if it matches the module AND we haven't seen it yet
                if (regex.test(funcName) && !seenFunctions.has(funcName)) {
                    moduleContent += block + "\n\n";
                    seenFunctions.add(funcName);
                    console.log(`[DEDUP] Sorting ${funcName} into ${fileName}`);
                }
            }
        });

        if (moduleContent.length > 0) {
            fs.writeFileSync(path.join(SOURCE_DIR, fileName), moduleContent);
            console.log(`[SUCCESS] ${fileName} finalized.`);
        }
    });
}

shatter();