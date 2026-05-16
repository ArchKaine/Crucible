let currentOpenPath = '', currentDirectory = '';
let openTabs = {};
let navHistory = [], navIndex = -1;
let aiCmdHistory = [];
let aiCmdIndex = -1;
let isPreviewActive = false;
let previewTimeout;
let previewBgState = 0;
let autoFormatOnSave = true;
let userThemes = {};

// ==========================================
// CLIENT IPC ROUTER (Photino vs Web Sandbox)
// ==========================================
window.ClientBridge = {
    isNative: typeof window !== 'undefined' && window.external && typeof window.external.sendMessage === 'function',

    init: function() {
        if (this.isNative) {
            // THE UNIFIED LISTENER
            window.external.receiveMessage(message => {
                // 1. Handle raw text notifications
                if (typeof message === 'string' && message.startsWith("NOTIFY:")) {
                    console.log(message.replace("NOTIFY:", "").trim());
                    if (typeof term !== 'undefined') {
                        term.write(`\r\n\x1b[32m[SYSTEM] ${message.replace("NOTIFY:", "").trim()}\x1b[0m\r\n`);
                    }
                    return; // Stop execution here for notifications
                }

                // 2. Handle structured JSON commands (e.g., Folder Picker)
                try {
                    const msg = JSON.parse(message);
                    if (msg.Command === "SET_WORKSPACE_PATH") {
                        const wsInput = document.getElementById('set-workspace');
                        if (wsInput) wsInput.value = msg.Data;
                    }
                    // Add future JSON commands (like HISTORY_LIST) here
                } catch (e) {
                    // Silently ignore if it's neither NOTIFY nor valid JSON
                }
            });
            console.log("[SYSTEM] Photino C# IPC Bridge established.");
        } else {
            console.log("[SYSTEM] Web Sandbox Mode active. C# Bridge disconnected.");
        }
    },

    saveFileNatively: async function(path, content) {
        if (this.isNative) {
            const payload = JSON.stringify({
                action: 'SAVE_FILE',
                path: path,
                content: content
            });
            window.external.sendMessage(payload);
        } else {
            const res = await fetch('/api/write', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: path, content: content
                })
            });
            if (!res.ok) throw new Error("Network write failed.");
        }
    }
};

// Initialize the bridge immediately
window.ClientBridge.init();

// Polyfill to prevent HTML ReferenceErrors
window.isShell = window.ClientBridge.isNative;
window.sendToShell = function(command, data) {
    if (window.ClientBridge.isNative) {
        window.external.sendMessage(JSON.stringify({
            Command: command, Data: data
        }));
    }
};

const getSyntaxMode = (fileName) => {
    const ext = fileName.split('.').pop().toLowerCase();
    const modeMap = {
        'js': 'javascript',
        'cs': 'csharp',
        'html': 'html',
        'css': 'css',
        'json': 'json',
        'md': 'markdown',
        'sh': 'sh'
    };
    return `ace/mode/${modeMap[ext] || 'text'}`;
};

ace.require("ace/ext/language_tools");
const editor = ace.edit("codeEditor");
const outputEditor = ace.edit("outputEditor");

// Initialization Fallback (Overrides immediately on loadSettings())
[editor, outputEditor].forEach(ed => {
    ed.setTheme("ace/theme/chaos");
    ed.setFontSize(14);
    ed.setOptions({
        fixedWidthGutter: true,
        enableBasicAutocompletion: true,
        enableSnippets: true,
        enableLiveAutocompletion: true,
        wrap: "free"
    });

    // ==========================================
    // ACE EDITOR LINTER OVERRIDES
    // ==========================================
    ed.session.on("changeMode", function() {
        const mode = ed.session.getMode().$id;

        // 1. Force the JS worker to accept modern ES2020+ syntax
        if (mode === "ace/mode/javascript") {
            setTimeout(() => {
                if (ed.session.$worker) {
                    ed.session.$worker.send("changeOptions", {
                        "esversion": 11,
                        "esnext": true,
                        "asi": true
                    });
                }
            },
                100);
        }

        // 2. Disable the broken background parser for HTML files
        if (mode === "ace/mode/html") {
            ed.session.setOption("useWorker", false);
        } else {
            ed.session.setOption("useWorker", true);
        }
    });
});

editor.session.setMode("ace/mode/csharp");

const term = new Terminal({
    theme: {
        background: '#000000', foreground: '#888888', cursor: '#569cd6', selection: '#222222'
    },
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 13,
    cursorBlink: true,
    allowProposedApi: true
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminalBox'));
fitAddon.fit();

const socket = new WebSocket(`ws://${window.location.host}`);

socket.onopen = () => {
    term.write('\x1b[34m[CRUCIBLE BASH LINK ACTIVE]\x1b[0m\r\n');
    sendResize();
};

socket.onmessage = async (ev) => {
    let rawData = ev.data;
    if (rawData instanceof Blob) rawData = await rawData.text();
    try {
        const msg = JSON.parse(rawData);
        if (msg.type === 'progress') {
            document.getElementById('progressFill').style.width = msg.data.percent + '%';
            document.getElementById('coreStatus').innerText = `${msg.data.percent === 100 ? 'SUCCESS': 'SYNCING'}: ${msg.data.file}`;
            document.getElementById('corePercent').innerText = msg.data.percent + '%';
        }
    } catch (e) {
        term.write(rawData);
    }
};

term.onData(data => {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'input', data: data
        }));
    }
});

function sendResize() {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'resize', cols: term.cols, rows: term.rows
        }));
    }
}

window.onresize = () => {
    fitAddon.fit();
    sendResize();
};

let splitViewActive = true;
let terminalActive = true;

function saveWorkspaceState() {
    setTimeout(() => {
        const state = {
            dir: currentDirectory, tabs: Object.keys(openTabs), active: currentOpenPath
        };
        localStorage.setItem('crucible-workspace', JSON.stringify(state));
    }, 50);
}

async function restoreWorkspaceState() {
    const saved = JSON.parse(localStorage.getItem('crucible-workspace'));
    if (!saved || !saved.dir) {
        await loadTree('');
        return;
    }
    await loadTree(saved.dir);
    if (saved.tabs) {
        for (const path of saved.tabs) {
            try {
                const res = await fetch(`/api/read?path=${encodeURIComponent(path)}`);
                if (res.ok) {
                    const content = await res.text();
                    const fileName = path.split(/[\\/]/).pop();
                    const session = ace.createEditSession(content, getSyntaxMode(fileName));
                    session.setUseWrapMode(editor.getOption("wrap") !== "off");

                    session.getUndoManager().markClean();
                    session.on('change', () => refreshTabVisuals());

                    openTabs[path] = {
                        session,
                        name: fileName
                    };
                    createTabUI(path, fileName);
                }
            } catch (e) {}
        }
    }
    if (saved.active && openTabs[saved.active]) switchTab(saved.active);
}

editor.on("change", () => {
    if (isPreviewActive) {
        clearTimeout(previewTimeout);
        previewTimeout = setTimeout(renderPreview, 500);
    }
});

window.addEventListener('message', (e) => {
    if (e.data.type === 'preview-log') term.write(`\r\n\x1b[36m[LOG]\x1b[0m ${e.data.data}\r\n`);
    if (e.data.type === 'preview-error') term.write(`\r\n\x1b[31m[ERR]\x1b[0m ${e.data.data}\r\n`);
});

window.onload = async () => {
    console.log("[BOOT 1/4] Initializing interface...");
    try {
        if (typeof initResizers === 'function') initResizers();
    } catch(e) {
        console.error("Resizer failure:", e);
    }

    console.log("[BOOT 2/4] Pulling configurations...");
    try {
        if (typeof loadSettings === 'function') await loadSettings();
    } catch(e) {
        console.error("Configuration failure:", e);
    }

    console.log("[BOOT 3/4] Restoring workspace...");
    try {
        if (typeof restoreWorkspaceState === 'function') {
            await restoreWorkspaceState();
        } else if (typeof loadTree === 'function') {
            await loadTree(typeof currentDirectory !== 'undefined' ? currentDirectory: '');
        }
    } catch(e) {
        console.error("Workspace restoration failure:", e);
    }

    console.log("[BOOT 4/4] Activating terminal...");
    try {
        if (typeof term !== 'undefined' && term) {
            term.focus();
            term.write('\x1b[32m[FORGE ONLINE]\x1b[0m\r\n');
        }
    } catch(e) {
        console.error("Terminal failure:", e);
    }
};

document.getElementById('aiInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        askAI();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (aiCmdHistory.length > 0) {
            aiCmdIndex = Math.min(aiCmdIndex + 1, aiCmdHistory.length - 1);
            this.value = aiCmdHistory[aiCmdHistory.length - 1 - aiCmdIndex];
        }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (aiCmdIndex > 0) {
            aiCmdIndex--;
            this.value = aiCmdHistory[aiCmdHistory.length - 1 - aiCmdIndex];
        } else if (aiCmdIndex === 0) {
            aiCmdIndex = -1;
            this.value = '';
        }
    }
});

[editor, outputEditor].forEach(ed => {
    ed.commands.addCommand({
        name: 'save',
        bindKey: {
            win: 'Ctrl-S', mac: 'Cmd-S'
        },
        exec: saveFile
    });
});