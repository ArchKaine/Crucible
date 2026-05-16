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

function initResizers() {
    const body = document.body;
    const saved = JSON.parse(localStorage.getItem('crucible-layout') || '{"cols":"280px 1fr 1fr", "rows":"1fr 350px"}');
    body.style.gridTemplateColumns = saved.cols;
    body.style.gridTemplateRows = saved.rows;

    const startDragging = (id, type) => {
        const resizer = document.getElementById(id);
        resizer.onmousedown = (e) => {
            body.classList.add('dragging');
            resizer.classList.add('active');

            document.onmousemove = (moveE) => {
                const cols = body.style.gridTemplateColumns.split(' ');
                const rows = body.style.gridTemplateRows.split(' ');

                if (type === 'sidebar') {
                    cols[0] = Math.max(40, moveE.clientX) + 'px';
                } else if (type === 'editor') {
                    const sidebarW = parseInt(cols[0]);
                    cols[1] = Math.max(50, moveE.clientX - sidebarW) + 'px';
                } else if (type === 'terminal') {
                    rows[1] = Math.max(50, window.innerHeight - moveE.clientY) + 'px';
                }

                body.style.gridTemplateColumns = cols.join(' ');
                body.style.gridTemplateRows = rows.join(' ');
                [editor,
                    outputEditor].forEach(ed => ed.resize());
                fitAddon.fit();
            };

            document.onmouseup = () => {
                body.classList.remove('dragging');
                resizer.classList.remove('active');
                document.onmousemove = null;
                document.onmouseup = null;
                localStorage.setItem('crucible-layout', JSON.stringify({
                    cols: body.style.gridTemplateColumns,
                    rows: body.style.gridTemplateRows
                }));
            };
        };
    };

    startDragging('resizer-sb', 'sidebar');
    startDragging('resizer-ed', 'editor');
    startDragging('resizer-tm', 'terminal');
}

function toggleAutoFormat() {
    autoFormatOnSave = !autoFormatOnSave;
    const btn = document.getElementById('formatToggle');

    if (autoFormatOnSave) {
        btn.classList.add('active');
        btn.style.color = '#2ecc71';
        term.write(`\r\n\x1b[32m[SYSTEM] Auto-Format on Save ENABLED.\x1b[0m\r\n`);
    } else {
        btn.classList.remove('active');
        btn.style.color = 'var(--ui-text-muted)';
        term.write(`\r\n\x1b[90m[SYSTEM] Auto-Format on Save DISABLED.\x1b[0m\r\n`);
    }
}

async function shutdownCrucible() {
    if (!confirm("Initiate total system shutdown?")) return;
    term.write('\r\n\x1b[31m[SYSTEM] Commencing Forge shutdown sequence...\x1b[0m\r\n');
    try {
        await fetch('/api/shutdown', {
            method: 'POST'
        });
    } catch (e) {
        term.write('\r\n\x1b[31m[ERROR] Shutdown signal failed.\x1b[0m\r\n');
    }
}

async function runGlobalSearch() {
    const query = document.getElementById('globalSearchInput').value;
    const resultsBox = document.getElementById('searchResults');
    if (!query) {
        resultsBox.style.display = 'none';
        return;
    }
    resultsBox.innerHTML = '<div class="search-item">Scanning Forge...</div>';
    resultsBox.style.display = 'block';
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&dir=${encodeURIComponent(currentDirectory)}`);
        const data = await res.json();
        resultsBox.innerHTML = '';
        if (data.length === 0) {
            resultsBox.innerHTML = '<div class="search-item">No matches in current sector.</div>';
        } else {
            data.forEach(match => {
                const item = document.createElement('div');
                item.className = 'search-item';
                const fileName = match.path.split(/[\\/]/).pop();
                item.innerHTML = `<span class="search-meta">${fileName}:${match.line}</span> ${match.text}`;
                item.onclick = () => {
                    openFile(match.path).then(() => {
                        editor.gotoLine(match.line, 0, true);
                        editor.focus();
                    });
                };
                resultsBox.appendChild(item);
            });
        }
    } catch (e) {
        resultsBox.innerHTML = '<div class="search-item">Search failed.</div>';
    }
}

async function loadTree(dir = '', parentElement = null, skipHistory = false) {
    try {
        const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}`);
        if (!res.ok) throw new Error("File API unreachable.");
        const data = await res.json();

        if (!parentElement) {
            currentDirectory = data.currentDir;

            const manualPathInput = document.getElementById('manualPath');
            if (manualPathInput) manualPathInput.value = currentDirectory;

            if (typeof updateBreadcrumbs === 'function') updateBreadcrumbs(currentDirectory);

            if (!skipHistory) {
                if (navIndex < navHistory.length - 1) navHistory = navHistory.slice(0, navIndex + 1);
                navHistory.push(currentDirectory);
                navIndex++;
            }

            if (typeof saveWorkspaceState === 'function') saveWorkspaceState();

            parentElement = document.getElementById('fileList');
            if (!parentElement) {
                console.error("[CRITICAL] Element #fileList missing. Cannot render filesystem.");
                return;
            }
            parentElement.innerHTML = '';
        }

        const ul = document.createElement('ul');
        ul.classList.add('expanded');

        data.entries.forEach(e => {
            const li = document.createElement('li');
            const itemDiv = document.createElement('div');
            itemDiv.className = 'fs-item';

            if (e.isDirectory) {
                itemDiv.innerHTML = `<span class="caret">▶</span> <span class="item-icon">📁</span> ${e.name}`;
                itemDiv.onclick = (ev) => {
                    ev.stopPropagation();
                    const childUl = li.querySelector('ul');
                    if (childUl) {
                        childUl.classList.toggle('expanded');
                        itemDiv.querySelector('.caret').classList.toggle('open');
                    } else {
                        itemDiv.querySelector('.caret').classList.add('open');
                        loadTree(e.path, li, true);
                    }
                };
                itemDiv.ondblclick = (ev) => {
                    ev.stopPropagation();
                    loadTree(e.path);
                };
            } else {
                itemDiv.innerHTML = `<span style="width:12px; display:inline-block;"></span><input type="checkbox" class="context-cb" value="${e.path}" onclick="event.stopPropagation()"> <span class="item-icon">📄</span> ${e.name}`;
                itemDiv.onclick = (ev) => {
                    ev.stopPropagation();
                    if (typeof openFile === 'function') openFile(e.path);
                };
            }
            li.appendChild(itemDiv);
            ul.appendChild(li);
        });

        parentElement.appendChild(ul);
    } catch (e) {
        console.error("Failed to load tree:",
            e);
    }
}

function updateBreadcrumbs(dir) {
    const bc = document.getElementById('breadcrumb');
    bc.innerHTML = '';
    const parts = dir.split(/[\\/]/).filter(p => p);
    const rootSpan = document.createElement('span');
    rootSpan.innerText = 'ROOT / ';
    rootSpan.onclick = () => loadTree('/');
    bc.appendChild(rootSpan);
    let runningPath = '';
    parts.forEach((p, i) => {
        runningPath += '/' + p;
        const s = document.createElement('span');
        s.innerText = p + (i < parts.length - 1 ? ' / ': '');
        const target = runningPath;
        s.onclick = () => loadTree(target);
        bc.appendChild(s);
    });
}

function updateSystemStatus(percent, message, isError = false) {
    const fill = document.getElementById('progressFill');
    const status = document.getElementById('coreStatus');
    const corePct = document.getElementById('corePercent');

    fill.style.width = `${percent}%`;
    fill.style.backgroundColor = isError ? '#f44336': 'var(--ui-bg-hover)';
    status.innerText = message.toUpperCase();
    corePct.innerText = `${percent}%`;

    if (percent === 100) {
        setTimeout(() => {
            fill.style.width = '0%';
        }, 2000);
    }
}

async function runAutomatedTests() {
    updateSystemStatus(10, "Initializing Test Suite...");
    try {
        const res = await fetch('/api/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                dir: currentDirectory, context: currentOpenPath
            })
        });
        const result = await res.json();

        updateSystemStatus(100, result.passed ? "Tests Passed": "Tests Failed", !result.passed);
        term.write(`\r\n\x1b[${result.passed ? '32': '31'}m[TEST RESULT] ${result.summary}\x1b[0m\r\n`);
    } catch (e) {
        updateSystemStatus(0, "Test Error", true);
    }
}

function goBack() {
    if (navIndex > 0) {
        navIndex--;
        loadTree(navHistory[navIndex], null, true);
    }
}

function goForward() {
    if (navIndex < navHistory.length - 1) {
        navIndex++;
        loadTree(navHistory[navIndex], null, true);
    }
}

function goUp() {
    const parent = currentDirectory.split(/[\\/]/).slice(0, -1).join('/') || '/';
    loadTree(parent);
}

async function openFile(path) {
    const fileName = path.split(/[\\/]/).pop();
    if (openTabs[path]) {
        switchTab(path);
        return;
    }

    const res = await fetch(`/api/read?path=${encodeURIComponent(path)}`);
    const content = await res.text();

    const syntaxMode = getSyntaxMode(fileName);
    const session = ace.createEditSession(content, syntaxMode);
    session.setUseWrapMode(editor.getOption("wrap") !== "off");

    session.getUndoManager().markClean();
    session.on('change', () => refreshTabVisuals());

    openTabs[path] = {
        session,
        name: fileName
    };
    createTabUI(path, fileName);
    switchTab(path);
}

function createTabUI(path, name) {
    const tabBar = document.getElementById('tabBar');
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.id = `tab-${btoa(path).replace(/=/g, '')}`;
    tab.innerHTML = `<span class="tab-name" onclick="switchTab('${path}')">${name}</span><span class="tab-close" onclick="closeTab('${path}')">✕</span>`;
    tabBar.appendChild(tab);
}

function refreshTabVisuals() {
    Object.keys(openTabs).forEach(path => {
        const session = openTabs[path].session;
        const isClean = session.getUndoManager().isClean();
        const tabElement = document.getElementById(`tab-${btoa(path).replace(/=/g, '')}`);

        if (tabElement) {
            const nameSpan = tabElement.querySelector('.tab-name');
            if (nameSpan) {
                nameSpan.innerText = openTabs[path].name + (isClean ? '': ' *');
            }
        }
    });
}

function switchTab(path) {
    currentOpenPath = path;
    editor.setSession(openTabs[path].session);
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.getElementById(`tab-${btoa(path).replace(/=/g, '')}`);
    if (activeTab) activeTab.classList.add('active');
    editor.focus();
    saveWorkspaceState();
}

function closeTab(path) {
    const tabElement = document.getElementById(`tab-${btoa(path).replace(/=/g, '')}`);
    if (tabElement) tabElement.remove();
    delete openTabs[path];
    const remaining = Object.keys(openTabs);
    if (remaining.length > 0) switchTab(remaining[remaining.length - 1]);
    else {
        currentOpenPath = '';
        editor.setValue('', -1);
    }
    saveWorkspaceState();
}

async function saveFile() {
    // 1. Preserve Auto-Formatting
    if (autoFormatOnSave) {
        try {
            const beautify = ace.require("ace/ext/beautify");
            beautify.beautify(editor.session);
        } catch (e) {
            if (typeof term !== 'undefined') term.write(`\r\n\x1b[31m[ERROR] Formatter failed to parse syntax.\x1b[0m\r\n`);
        }
    }

    if (!currentOpenPath) return;

    try {
        // 2. Route payload through the universal IPC bridge instead of direct fetch
        await window.ClientBridge.saveFileNatively(currentOpenPath, editor.getValue());

        // 3. Preserve Editor State & UI Updates
        const currentSession = openTabs[currentOpenPath].session;
        currentSession.getUndoManager().markClean();
        if (typeof refreshTabVisuals === 'function') refreshTabVisuals();

        if (typeof term !== 'undefined') term.write(`\r\n\x1b[32m[SYSTEM] Saved: ${currentOpenPath}\x1b[0m\r\n`);
    } catch (e) {
        if (typeof term !== 'undefined') term.write(`\r\n\x1b[31m[ERROR] Save sequence failed: ${e.message}\x1b[0m\r\n`);
        console.error("Save Error:", e);
    }
}

function switchSidebar(viewName) {
    const views = document.querySelectorAll('.sidebar-view');
    const tabs = document.querySelectorAll('.sidebar-tabs button');

    views.forEach(v => v.classList.remove('active'));
    tabs.forEach(b => b.classList.remove('active'));

    const targetView = document.getElementById(`view-${viewName}`);
    const targetTab = document.getElementById(`tab-${viewName}`);

    if (targetView && targetTab) {
        targetView.classList.add('active');
        targetTab.classList.add('active');
    } else {
        document.getElementById('view-explorer')?.classList.add('active');
        document.getElementById('tab-explorer')?.classList.add('active');
        return;
    }

    if (viewName === 'git') {
        if (typeof refreshGitStatus === 'function') refreshGitStatus();
    }
}

async function triggerManualFormat() {
    const beautify = ace.require("ace/ext/beautify");
    if (beautify) {
        beautify.beautify(editor.session);
        term.write('\r\n\x1b[32m[SYSTEM] Active document formatted.\x1b[0m\r\n');
    } else {
        term.write('\r\n\x1b[31m[ERROR] Formatter engine not loaded.\x1b[0m\r\n');
    }
}

let splitViewActive = true;

function toggleSplitView() {
    const body = document.body;
    const btn = document.getElementById('splitBtn');
    splitViewActive = !splitViewActive;

    if (splitViewActive) {
        const savedLayout = JSON.parse(localStorage.getItem('crucible-layout') || '{"cols":"280px 1fr 1fr", "rows":"1fr 350px"}');
        body.style.gridTemplateColumns = savedLayout.cols;
        btn.classList.add('active');
        term.write('\r\n\x1b[90m[SYSTEM] Dual-buffer active.\x1b[0m\r\n');
    } else {
        const currentCols = body.style.gridTemplateColumns.split(' ');
        body.style.gridTemplateColumns = `${currentCols[0]} 1fr 0px`;
        btn.classList.remove('active');
        term.write('\r\n\x1b[90m[SYSTEM] Single editor mode active.\x1b[0m\r\n');
    }

    setTimeout(() => {
        editor.resize();
        outputEditor.resize();
        fitAddon.fit();
    }, 150);
}

let terminalActive = true;

function toggleTerminal() {
    const body = document.body;
    const btn = document.getElementById('termBtn');
    terminalActive = !terminalActive;

    if (terminalActive) {
        const savedLayout = JSON.parse(localStorage.getItem('crucible-layout') || '{"cols":"280px 1fr 1fr", "rows":"1fr 350px"}');
        body.style.gridTemplateRows = savedLayout.rows;
        btn.classList.add('active');
    } else {
        body.style.gridTemplateRows = "1fr 0px";
        btn.classList.remove('active');
    }

    setTimeout(() => {
        editor.resize();
        outputEditor.resize();
        fitAddon.fit();
    }, 150);
}

async function refreshGitStatus() {
    const list = document.getElementById('gitStatusList');
    list.innerHTML = '<div style="color: #555; font-size: 10px;">SCANNING...</div>';
    try {
        const res = await fetch(`/api/git/status?dir=${encodeURIComponent(currentDirectory)}`);
        const data = await res.json();
        list.innerHTML = '';
        if (data.staged.length > 0) {
            list.innerHTML += `<div class="git-header"><span>STAGED</span></div>`;
            data.staged.forEach(item => list.appendChild(createGitItem(item, true)));
        }
        if (data.unstaged.length > 0) {
            list.innerHTML += `<div class="git-header"><span>CHANGES</span> <button onclick="gitAction('add-all')">+</button></div>`;
            data.unstaged.forEach(item => list.appendChild(createGitItem(item, false)));
        }
        if (data.staged.length === 0 && data.unstaged.length === 0) list.innerHTML = '<div style="color: #444; padding: 10px;">CLEAN</div>';
    } catch (err) {
        list.innerHTML = `<div style="color: #e74c3c;">GIT OFFLINE</div>`;
    }
}

function createGitItem(item, isStaged) {
    const div = document.createElement('div');
    div.className = 'git-item';
    const action = isStaged ? 'unstage': 'stage';
    div.innerHTML = `<span onclick="openFile('${item.file}')" style="flex-grow:1;">${item.file.split('/').pop()}</span>
    <span class="git-status-badge status-${item.status}">${item.status}</span>
    <button onclick="gitAction('${action}', '${item.file}')">${isStaged ? '-': '+'}</button>`;
    return div;
}

async function gitAction(action, file = '') {
    try {
        const res = await fetch('/api/git/action', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action, file, dir: currentDirectory
            })
        });

        const data = await res.json();

        if (data.error) {
            const cleanError = data.error.trim().replace(/\n/g, '\r\n');
            term.write(`\r\n\x1b[31m[GIT ERROR]\r\n${cleanError}\x1b[0m\r\n`);
        } else if (data.output) {
            const cleanOutput = data.output.trim().replace(/\n/g, '\r\n');
            term.write(`\r\n\x1b[90m[GIT]\r\n${cleanOutput}\x1b[0m\r\n`);
        } else if (data.success) {
            term.write(`\r\n\x1b[32m[GIT] Action '${action}' completed.\x1b[0m\r\n`);
        }

    } catch (e) {
        term.write(`\r\n\x1b[31m[SYSTEM ERROR] Failed to reach Git API: ${e.message}\x1b[0m\r\n`);
    }

    refreshGitStatus();
}

async function createBranch() {
    const branchName = prompt("ENTER NEW FEATURE BRANCH NAME:");
    if (!branchName) return;

    try {
        await gitAction('checkout', {
            branch: branchName, create: true
        });
        term.write(`\r\n\x1b[32m[GIT] SWITCHED TO NEW SECTOR: ${branchName}\x1b[0m\r\n`);
    } catch (e) {
        term.write(`\r\n\x1b[31m[GIT ERR] BRANCH ALLOCATION FAILED.\x1b[0m\r\n`);
    }
}

async function mergeBranch() {
    const target = prompt("MERGE WHICH BRANCH INTO CURRENT?");
    if (!target) return;

    term.write(`\r\n\x1b[33m[SYSTEM] INITIATING CONFLICT DETECTION...\x1b[0m\r\n`);
    try {
        const res = await fetch('/api/git/action', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'merge', target, dir: currentDirectory
            })
        });
        const data = await res.json();

        if (data.conflicts) {
            term.write(`\r\n\x1b[31m[CONFLICT] AUTOMATIC RESOLUTION FAILED. MANUAL INTERVENTION REQUIRED.\x1b[0m\r\n`);
        } else {
            term.write(`\r\n\x1b[32m[SUCCESS] SECTOR MERGED SUCCESSFULLY.\x1b[0m\r\n`);
        }
        refreshGitStatus();
    } catch (e) {
        term.write(`\r\n\x1b[31m[ERROR] MERGE HANDSHAKE TIMED OUT.\x1b[0m\r\n`);
    }
}

async function askAI() {
    const input = document.getElementById('aiInput');
    const directive = input.value.trim();
    if (!directive) return;

    const contextFiles = Array.from(document.querySelectorAll('.context-cb:checked')).map(cb => cb.value);
    input.value = 'PROCESSING...';

    try {
        console.log("PROMPT SENT TO AI:", `Context: ${contextFiles}\nDirective: ${directive}\nBuffer:\n${editor.getValue()}`);
        const res = await fetch('/api/ai', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                history: [{
                    role: "user",
                    content: `INSTRUCTIONS: ${directive}\n\nFILE CONTEXT LIST: ${contextFiles.join(', ')}\n\nCURRENT BUFFER CONTENT:\n${editor.getValue()}`
                }]
            })
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Server ${res.status}: ${errBody}`);
        }

        const data = await res.json();

        if (data.choices && data.choices[0] && data.choices[0].message) {
            let rawContent = data.choices[0].message.content;

            const cleanedCode = rawContent
            .replace(/^``````$/i, '')
            .trim();

            outputEditor.setValue(cleanedCode, -1);
            term.write(`\r\n\x1b[32m[SUCCESS] AI logic loaded to output buffer.\x1b[0m\r\n`);
        } else {
            throw new Error("Malformed API response structure.");
        }

    } catch (e) {
        term.write(`\r\n\x1b[31m[ERROR] AI Handshake Failed: ${e.message}\x1b[0m\r\n`);
        console.error("Full AI Error:", e);
    } finally {
        input.value = '';
    }
}

async function runShadowTest() {
    if (!currentOpenPath) return;
    const content = outputEditor.getValue();
    const ext = currentOpenPath.split('.').pop().toLowerCase();
    const ind = document.getElementById('shadowStatus');
    const statusText = document.getElementById('coreStatus');

    statusText.innerText = `LINTING ${ext.toUpperCase()}...`;
    ind.style.backgroundColor = '#f1c40f';

    if (ext === 'html' || ext === 'js') {
        const isValid = validateWebCode(content, ext);
        if (!isValid.success) {
            statusText.innerText = isValid.error;
            ind.style.backgroundColor = '#f44336';
            return;
        }
    }

    try {
        const res = await fetch('/api/shadow-test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: currentOpenPath, content: content
            })
        });
        const result = await res.json();

        if (result.error) {
            statusText.innerText = "LINT ERROR";
            ind.style.backgroundColor = '#f44336';
        } else {
            statusText.innerText = "LINT PASSED";
            ind.style.backgroundColor = '#2ecc71';
        }
    } catch (e) {
        statusText.innerText = "LINT TIMEOUT";
        ind.style.backgroundColor = '#f44336';
    }
}

function validateWebCode(content, type) {
    if (type === 'html') {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, "text/html");
        const errors = doc.querySelectorAll("parsererror");
        return errors.length > 0 ?
        {
            success: false,
            error: "Malformed HTML Structure"
        }:
        {
            success: true
        };
    }

    if (type === 'js') {
        try {
            new Function(content);
            return {
                success: true
            };
        } catch (e) {
            return {
                success: false,
                error: `JS Syntax: ${e.message}`
            };
        }
    }
    return {
        success: true
    };
}

function applyDiffMerge() {
    if (outputEditor.getValue().length < editor.getValue().length * 0.7) {
        if (!confirm("AI output is significantly shorter. Potential gutting detected. Proceed?")) return;
    }
    editor.setValue(outputEditor.getValue(), -1);
    term.write(`\r\n\x1b[34m[SYSTEM] Merge applied.\x1b[0m\r\n`);
}

function toggleWrap() {
    const wrapping = editor.getOption("wrap") === "off";
    [editor,
        outputEditor].forEach(ed => ed.setOption("wrap", wrapping ? "free": "off"));
    document.getElementById('wrapToggle').classList.toggle('active', wrapping);
    Object.values(openTabs).forEach(tab => tab.session.setUseWrapMode(wrapping));
}

function toggleCustomThemeEditor() {
    const themeId = document.getElementById('set-theme').value;
    const customEditor = document.getElementById('customThemeEditor');

    if (customEditor) {
        customEditor.style.display = (themeId === 'custom' || userThemes[themeId]) ? 'flex': 'none';
    }

    if (userThemes[themeId]) {
        const t = userThemes[themeId];
        document.getElementById('color-bg-base').value = t.ui.base;
        document.getElementById('color-bg-panel').value = t.ui.panel;
        document.getElementById('color-bg-surface').value = t.ui.surface;
        document.getElementById('color-accent').value = t.ui.accent;
        document.getElementById('color-text-bright').value = t.ui.textBright;
        document.getElementById('color-text-muted').value = t.ui.textMuted;
        document.getElementById('customThemeName').value = t.name;
    } else if (themeId === 'custom') {
        document.getElementById('customThemeName').value = '';
    }
}

function populateThemeDropdown() {
    const select = document.getElementById('set-theme');
    const currentVal = select.value;
    select.innerHTML = '';

    Object.keys(window.CrucibleThemes || {}).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.text = window.CrucibleThemes[key].name;
        select.appendChild(opt);
    });

    Object.keys(userThemes).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.text = `* ${userThemes[key].name}`;
        select.appendChild(opt);
    });

    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.text = '+ Create New Custom...';
    select.appendChild(customOpt);

    if (select.querySelector(`option[value="${currentVal}"]`)) {
        select.value = currentVal;
    }
}

async function saveCustomThemeToDisk() {
    const name = document.getElementById('customThemeName').value.trim() || 'My Custom Theme';
    const id = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]/g, '');

    userThemes[id] = {
        name: name,
        ace: "ace/theme/chaos",
        term: window.CrucibleThemes?.chaos?.term || {
            background: '#000000',
            foreground: '#888888',
            cursor: '#569cd6',
            selection: '#222222'
        },
        ui: {
            base: document.getElementById('color-bg-base').value,
            panel: document.getElementById('color-bg-panel').value,
            surface: document.getElementById('color-bg-surface').value,
            hover: '#111111',
            borderDark: '#1a1a1a',
            borderLight: '#222222',
            textDim: '#444444',
            textMain: '#888888',
            accent: document.getElementById('color-accent').value,
            textBright: document.getElementById('color-text-bright').value,
            textMuted: document.getElementById('color-text-muted').value
        }
    };

    try {
        await fetch('/api/themes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userThemes)
        });

        populateThemeDropdown();
        document.getElementById('set-theme').value = id;
        term.write(`\r\n\x1b[32m[SYSTEM] Custom theme '${name}' saved to disk.\x1b[0m\r\n`);
    } catch (e) {
        term.write('\r\n\x1b[31m[ERROR] Failed to write theme to disk.\x1b[0m\r\n');
    }
}

function applySettings(config) {
    const isCustomUnsaved = config.theme === 'custom';
    let t = (window.CrucibleThemes && window.CrucibleThemes[config.theme]) || userThemes[config.theme] || (window.CrucibleThemes && window.CrucibleThemes.twilight);

    const root = document.documentElement;

    if (isCustomUnsaved && config.customColors) {
        root.style.setProperty('--ui-bg-base', config.customColors.base);
        root.style.setProperty('--ui-bg-panel', config.customColors.panel);
        root.style.setProperty('--ui-bg-surface', config.customColors.surface);
        root.style.setProperty('--ui-accent', config.customColors.accent);
        root.style.setProperty('--ui-text-bright', config.customColors.textBright);
        root.style.setProperty('--ui-text-muted', config.customColors.textMuted);
    } else if (t && t.ui) {
        root.style.setProperty('--ui-bg-base', t.ui.base);
        root.style.setProperty('--ui-bg-panel', t.ui.panel);
        root.style.setProperty('--ui-bg-surface', t.ui.surface);
        root.style.setProperty('--ui-bg-hover', t.ui.hover);
        root.style.setProperty('--ui-border-dark', t.ui.borderDark);
        root.style.setProperty('--ui-border-light', t.ui.borderLight);
        root.style.setProperty('--ui-text-dim', t.ui.textDim);
        root.style.setProperty('--ui-text-muted', t.ui.textMuted);
        root.style.setProperty('--ui-text-main', t.ui.textMain);
        root.style.setProperty('--ui-text-bright', t.ui.textBright);
        root.style.setProperty('--ui-accent', t.ui.accent);
    }

    if (t) {
        [editor,
            outputEditor].forEach(ed => {
                ed.setTheme(t.ace);
                ed.setFontSize(parseInt(config.edFont) || 14);
            });
        term.options.theme = Object.assign({}, t.term);
    }

    term.options.fontSize = parseInt(config.tmFont) || 13;

    if (config.wordwrap !== undefined) {
        const wrapping = config.wordwrap;
        [editor,
            outputEditor].forEach(ed => ed.setOption("wrap", wrapping ? "free": "off"));
        const wrapBtn = document.getElementById('wrapToggle');
        if (wrapBtn) wrapBtn.classList.toggle('active', wrapping);
        Object.values(openTabs).forEach(tab => tab.session.setUseWrapMode(wrapping));
    }

    if (config.autoformat !== undefined) {
        autoFormatOnSave = config.autoformat;
        const formatBtn = document.getElementById('formatToggle');
        if (formatBtn) {
            if (autoFormatOnSave) {
                formatBtn.classList.add('active');
                formatBtn.style.color = '#2ecc71';
            } else {
                formatBtn.classList.remove('active');
                formatBtn.style.color = 'var(--ui-text-muted)';
            }
        }
    }
    fitAddon.fit();
}

async function loadSettings() {
    try {
        // 1. Fetch Themes (Isolated so failure doesn't halt core settings)
        try {
            const themeRes = await fetch('/api/themes');
            if (themeRes.ok) {
                window.userThemes = await themeRes.json();
                if (typeof populateThemeDropdown === 'function') populateThemeDropdown();
            }
        } catch (e) {
            console.warn("[SETTINGS] Theme fetch failed. Using defaults.", e);
        }

        // 2. Fetch Core Config
        const res = await fetch('/api/settings');
        if (!res.ok) throw new Error("Settings API returned " + res.status);
        const saved = await res.json();

        // 3. Apply Colors & Styles
        if (typeof applySettings === 'function') applySettings(saved);

        // 4. Update DOM Elements (Safely)
        const safeSet = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };

        safeSet('set-theme', saved.theme || 'twilight');
        safeSet('set-ed-font', saved.edFont || 14);
        safeSet('set-tm-font', saved.tmFont || 13);
        safeSet('set-pat', saved.pat || '');
        safeSet('set-repo', saved.repo || '');
        safeSet('set-git-name', saved.gitName || '');
        safeSet('set-git-email', saved.gitEmail || '');

        // 5. Handle Global Variables
        const workspaceInput = document.getElementById('set-workspace');
        if (workspaceInput) {
            workspaceInput.value = saved.workspace || '';
            if (saved.workspace) window.currentDirectory = saved.workspace;
        }

        const wordwrapCb = document.getElementById('set-wordwrap');
        if (wordwrapCb) wordwrapCb.checked = !!saved.wordwrap;

        // 6. Handle Custom Color Vectors
        if (saved.customColors && saved.theme === 'custom') {
            safeSet('color-bg-base', saved.customColors.base);
            safeSet('color-bg-panel', saved.customColors.panel);
            safeSet('color-bg-surface', saved.customColors.surface);
            safeSet('color-accent', saved.customColors.accent);
            safeSet('color-text-bright', saved.customColors.textBright);
            safeSet('color-text-muted', saved.customColors.textMuted);
        }

        if (typeof toggleCustomThemeEditor === 'function') toggleCustomThemeEditor();

    } catch (e) {
        console.error("[SETTINGS] Fatal load error:", e);
    }
}

async function saveSettings() {
    const config = {
        theme: document.getElementById('set-theme').value,
        edFont: document.getElementById('set-ed-font').value,
        tmFont: document.getElementById('set-tm-font').value,
        pat: document.getElementById('set-pat').value,
        repo: document.getElementById('set-repo').value,
        gitName: document.getElementById('set-git-name').value,
        gitEmail: document.getElementById('set-git-email').value,
        wordwrap: document.getElementById('set-wordwrap')?.checked ?? true,
        autoformat: autoFormatOnSave,
        customColors: {
            base: document.getElementById('color-bg-base').value,
            panel: document.getElementById('color-bg-panel').value,
            surface: document.getElementById('color-bg-surface').value,
            accent: document.getElementById('color-accent').value,
            textBright: document.getElementById('color-text-bright').value,
            textMuted: document.getElementById('color-text-muted').value
        }
    };

    const newWorkspace = document.getElementById('set-workspace').value.trim();

    if (newWorkspace && newWorkspace !== currentDirectory) {
        currentDirectory = newWorkspace;
        term.write(`\r\n\x1b[33m[SYSTEM] Workspace shifted to: ${currentDirectory}\x1b[0m\r\n`);
        if (typeof loadTree === 'function') {
            loadTree(currentDirectory);
        }
    }

    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });

        applySettings(config);
        closeSettings();
        term.write('\r\n\x1b[32m[SYSTEM] Preferences Synchronized to Core.\x1b[0m\r\n');

        const target = currentDirectory;

        if (config.gitName || config.gitEmail) {
            await fetch('/api/git/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: config.gitName, email: config.gitEmail, dir: target
                })
            });
        }

        if (config.repo) {
            await fetch('/api/git/remote', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url: config.repo, dir: target
                })
            });
            term.write(`\r\n\x1b[90m[SYSTEM] Base remote established.\x1b[0m\r\n`);
        }

        if (config.pat) {
            await fetch('/api/git/auth', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    token: config.pat, dir: target
                })
            });
            term.write(`\r\n\x1b[32m[SYSTEM] Git PAT injected securely.\x1b[0m\r\n`);
        }
    } catch (e) {
        term.write(`\r\n\x1b[31m[ERROR] Synchronization failed: ${e.message}\x1b[0m\r\n`);
    }
}

function openSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.style.display = 'flex';
    } else {
        console.error("[UI ERROR] Cannot open settings: '#settingsModal' not found in the DOM.");
    }
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function switchSettingsTab(event, paneId) {
    // Hide all panes
    const panes = document.querySelectorAll('.tab-pane');
    panes.forEach(pane => pane.classList.remove('active'));

    // Deactivate all buttons
    const buttons = document.querySelectorAll('.settings-tab-btn');
    buttons.forEach(btn => btn.classList.remove('active'));

    // Activate the selected tab and pane
    document.getElementById(paneId).classList.add('active');
    event.currentTarget.classList.add('active');
}

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

async function renameItem() {
    if (!currentOpenPath) return alert("Select an active file in the editor first.");
    const oldName = currentOpenPath.split(/[\\/]/).pop();
    const newName = prompt("Rename to:", oldName);
    if (!newName || newName === oldName) return;

    const parentDir = currentOpenPath.split(/[\\/]/).slice(0, -1).join('/');
    const newPath = parentDir ? `${parentDir}/${newName}`: newName;

    try {
        const res = await fetch('/api/rename', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                oldPath: currentOpenPath, newPath: newPath
            })
        });
        const result = await res.json();
        if (result.error) throw new Error(result.error);

        const oldPath = currentOpenPath;
        delete openTabs[oldPath];
        document.getElementById(`tab-${btoa(oldPath).replace(/=/g, '')}`)?.remove();

        await loadTree(currentDirectory);
        await openFile(newPath);
        term.write(`\r\n\x1b[32m[SYSTEM] Renamed: ${oldName} -> ${newName}\x1b[0m\r\n`);
    } catch (e) {
        term.write(`\r\n\x1b[31m[ERROR] Rename failed: ${e.message}\x1b[0m\r\n`);
    }
}

async function deleteItem() {
    if (!currentOpenPath) return alert("Select an active file in the editor first.");
    if (!confirm(`Are you sure you want to PERMANENTLY PURGE ${currentOpenPath}?`)) return;

    try {
        const res = await fetch('/api/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: currentOpenPath
            })
        });
        const result = await res.json();
        if (result.error) throw new Error(result.error);

        closeTab(currentOpenPath);
        await loadTree(currentDirectory);
        term.write(`\r\n\x1b[33m[SYSTEM] Deleted: ${currentOpenPath}\x1b[0m\r\n`);
    } catch (e) {
        term.write(`\r\n\x1b[31m[ERROR] Delete failed: ${e.message}\x1b[0m\r\n`);
    }
}

async function createNewFile() {
    const name = prompt("Enter new file name (with extension):");
    if (!name) return;
    const path = currentDirectory ? `${currentDirectory}/${name}`: name;

    try {
        const res = await fetch('/api/write', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path, content: ''
            })
        });
        if (!res.ok) throw new Error("Server write failed");

        await loadTree(currentDirectory);
        await openFile(path);
        term.write(`\r\n\x1b[32m[SYSTEM] Created File: ${name}\x1b[0m\r\n`);
    } catch (e) {
        term.write(`\r\n\x1b[31m[ERROR] Create failed.\x1b[0m\r\n`);
    }
}

async function createNewFolder() {
    const name = prompt("Enter new directory name:");
    if (!name) return;
    const path = currentDirectory ? `${currentDirectory}/${name}`: name;

    try {
        const res = await fetch('/api/mkdir', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path
            })
        });
        if (!res.ok) throw new Error("Server mkdir failed");

        await loadTree(currentDirectory);
        term.write(`\r\n\x1b[32m[SYSTEM] Created Directory: ${name}\x1b[0m\r\n`);
    } catch (e) {
        term.write(`\r\n\x1b[31m[ERROR] Mkdir failed.\x1b[0m\r\n`);
    }
}

async function startIndexing() {
    const statusEl = document.getElementById('coreStatus');
    statusEl.innerText = "Targeting Vector Arrays...";
    const contextFiles = Array.from(document.querySelectorAll('.context-cb:checked')).map(cb => cb.value);

    try {
        const res = await fetch('/api/index', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                selectedFiles: contextFiles, dir: currentDirectory
            })
        });
        const data = await res.json();
        term.write(`\r\n\x1b[34m[SYSTEM] Indexing sequence initiated for ${data.count || 'all'} targets.\x1b[0m\r\n`);
    } catch (e) {
        term.write(`\r\n\x1b[31m[ERROR] Indexer handshake failed.\x1b[0m\r\n`);
    }
}

async function initGitRepo() {
    if (!confirm(`Initialize empty Git repository in ${currentDirectory}?`)) return;
    await gitAction('init');
}

async function commitChanges() {
    const msgInput = document.getElementById('commitMessage');
    const message = msgInput.value.trim();
    if (!message) return alert("Commit message is required.");

    try {
        const res = await fetch('/api/git/action', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'commit', message, dir: currentDirectory
            })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        msgInput.value = '';
        term.write(`\r\n\x1b[32m[GIT] Commit successful: ${message}\x1b[0m\r\n`);
        refreshGitStatus();
    } catch (e) {
        term.write(`\r\n\x1b[31m[GIT ERROR] Commit failed: ${e.message}\x1b[0m\r\n`);
    }
}

function togglePreview() {
    const preview = document.getElementById('previewFrame');
    const outputEd = document.getElementById('outputEditor');
    const btn = document.getElementById('previewBtn');
    const vpControls = document.getElementById('viewportControls');

    isPreviewActive = !isPreviewActive;

    outputEd.style.display = isPreviewActive ? 'none': 'block';
    preview.style.display = isPreviewActive ? 'block': 'none';
    vpControls.style.display = isPreviewActive ? 'flex': 'none';

    btn.innerText = isPreviewActive ? 'Close': 'Preview';
    btn.style.color = isPreviewActive ? '#e74c3c': '#3498db';

    if (isPreviewActive) renderPreview();
}

function setViewport(width) {
    const preview = document.getElementById('previewFrame');
    preview.style.width = width;
    preview.style.margin = width === '100%' ? '0': '0 auto';
}

function togglePreviewBackground() {
    const preview = document.getElementById('previewFrame');
    const states = ['#ffffff',
        '#0a0a0a',
        'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\'%3E%3Crect width=\'8\' height=\'8\' fill=\'%23222\'/%3E%3Crect x=\'8\' y=\'8\' width=\'8\' height=\'8\' fill=\'%23111\'/%3E%3C/svg%3E")'];
    previewBgState = (previewBgState + 1) % states.length;
    preview.style.background = states[previewBgState];
}

function renderPreview() {
    if (!isPreviewActive) return;
    const code = editor.getValue();
    const interceptor = `<script>
    (function() {
    const pipe = (type, args) => {
    window.parent.postMessage({ type: 'preview-' + type, data: args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') }, '*');
    };
    console.log = (...args) => pipe('log', args);
    console.error = (...args) => pipe('error', args);
    })();
    <\/script>`;
    document.getElementById('previewFrame').srcdoc = interceptor + code;
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