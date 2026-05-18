// Helper to detect and maintain correct cross-platform path layout separators
function getPathSeparator(path) {
    return path.includes('\\') ? '\\': '/';
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
        if (!res.ok) throw new Error(`HTTP Search Error: ${res.status}`);
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
                        if (typeof editor !== 'undefined') {
                            editor.gotoLine(match.line, 0, true);
                            editor.focus();
                        }
                    });
                };
                resultsBox.appendChild(item);
            });
        }
    } catch (e) {
        resultsBox.innerHTML = '<div class="search-item">Search failed.</div>';
        if (typeof term !== 'undefined') term.write(`\r\n\x1b[31m[ERROR] Global search failed: ${e.message}\x1b[0m\r\n`);
    }
}

async function loadTree(dir = '', parentElement = null, skipHistory = false) {
    try {
        const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}`);
        if (!res.ok) throw new Error(`FileSystem API returned status ${res.status}`);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        if (!parentElement) {
            currentDirectory = data.currentDir;

            const manualPathInput = document.getElementById('manualPath');
            if (manualPathInput) manualPathInput.value = currentDirectory;

            updateBreadcrumbs(currentDirectory);

            if (!skipHistory) {
                if (navIndex < navHistory.length - 1) {
                    navHistory = navHistory.slice(0, navIndex + 1);
                }
                if (navHistory[navHistory.length - 1] !== currentDirectory) {
                    navHistory.push(currentDirectory);
                    navIndex = navHistory.length - 1;
                }
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
                        const caret = itemDiv.querySelector('.caret');
                        if (caret) caret.classList.toggle('open');
                    } else {
                        const caret = itemDiv.querySelector('.caret');
                        if (caret) caret.classList.add('open');
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
                    openFile(e.path);
                };
            }
            li.appendChild(itemDiv);
            ul.appendChild(li);
        });

        parentElement.appendChild(ul);
    } catch (e) {
        console.error("Failed to load layout directory tree:", e);
        if (typeof term !== 'undefined') {
            term.write(`\r\n\x1b[31m[ERROR] Directory mapping broken for [${dir}]: ${e.message}\x1b[0m\r\n`);
        }
    }
}

function updateBreadcrumbs(dir) {
    const bc = document.getElementById('breadcrumb');
    if (!bc) return;
    bc.innerHTML = '';

    const separator = getPathSeparator(dir);
    const isWindowsAbsolute = dir.includes(':');

    const parts = dir.split(/[\\/]/).filter(p => p);

    const rootSpan = document.createElement('span');
    rootSpan.innerText = isWindowsAbsolute ? 'WORKSPACE / ': 'ROOT / ';
    rootSpan.onclick = () => loadTree(isWindowsAbsolute ? parts[0] + separator: '/');
    bc.appendChild(rootSpan);

    let runningPath = isWindowsAbsolute ? parts[0]: '';

    parts.forEach((p, i) => {
        if (isWindowsAbsolute && i === 0) return;

        if (isWindowsAbsolute) {
            runningPath += separator + p;
        } else {
            runningPath += '/' + p;
        }

        const s = document.createElement('span');
        s.innerText = p + (i < parts.length - 1 ? ' / ': '');

        const target = runningPath;
        s.onclick = () => loadTree(target);
        bc.appendChild(s);
    });
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
    if (!currentDirectory || currentDirectory === '/' || currentDirectory === '') return;

    const separator = getPathSeparator(currentDirectory);
    const parts = currentDirectory.split(/[\\/]/).filter(p => p);

    if (parts.length <= 1) {
        loadTree(currentDirectory.includes(':') ? parts[0] + separator: '/');
        return;
    }

    const parent = parts.slice(0, -1).join(separator);
    loadTree(currentDirectory.includes(':') ? parent: '/' + parent);
}

async function openFile(path) {
    try {
        const fileName = path.split(/[\\/]/).pop();
        if (openTabs[path]) {
            switchTab(path);
            return;
        }

        const res = await fetch(`/api/read?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error(`Server read error status: ${res.status}`);
        const content = await res.text();

        const syntaxMode = typeof getSyntaxMode === 'function' ? getSyntaxMode(fileName): 'ace/mode/text';
        const session = ace.createEditSession(content, syntaxMode);

        if (typeof editor !== 'undefined') {
            session.setUseWrapMode(editor.getOption("wrap") !== "off");
        }

        session.getUndoManager().markClean();
        session.on('change', () => refreshTabVisuals());

        openTabs[path] = {
            session,
            name: fileName
        };

        createTabUI(path, fileName);
        switchTab(path);

        if (typeof ace !== 'undefined' && typeof editor !== 'undefined') {
            try {
                const modelist = ace.require("ace/ext/modelist");
                if (modelist) {
                    const mappedMode = modelist.getModeForPath(path).mode;
                    editor.session.setMode(mappedMode);
                }
            } catch (err) {
                console.warn("[UI SYSTEM] Modelist extension not found, syntax mapping fallback active.");
            }
        }
    } catch (e) {
        if (typeof term !== 'undefined') {
            term.write(`\r\n\x1b[31m[ERROR] Unable to open document [${path}]: ${e.message}\x1b[0m\r\n`);
        }
    }
}

function createTabUI(path, name) {
    const tabBar = document.getElementById('tabBar');
    if (!tabBar) return;
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

    if (typeof editor !== 'undefined') {
        editor.setSession(openTabs[path].session);
        editor.focus();

        try {
            const modelist = ace.require("ace/ext/modelist");
            if (modelist) {
                const mappedMode = modelist.getModeForPath(path).mode;
                editor.session.setMode(mappedMode);
            }
        } catch(e) {}
    }

    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.getElementById(`tab-${btoa(path).replace(/=/g, '')}`);
    if (activeTab) {
        activeTab.classList.add('active');
        activeTab.setAttribute('data-path', path);
    }
    if (typeof saveWorkspaceState === 'function') saveWorkspaceState();
}

function closeTab(path) {
    const tabElement = document.getElementById(`tab-${btoa(path).replace(/=/g, '')}`);
    if (tabElement) tabElement.remove();
    delete openTabs[path];
    const remaining = Object.keys(openTabs);
    if (remaining.length > 0) {
        switchTab(remaining[remaining.length - 1]);
    } else {
        currentOpenPath = '';
        if (typeof editor !== 'undefined') editor.setValue('', -1);
    }
    if (typeof saveWorkspaceState === 'function') saveWorkspaceState();
}

async function saveFile() {
    if (autoFormatOnSave && typeof ace !== 'undefined') {
        try {
            const beautify = ace.require("ace/ext/beautify");
            if (typeof editor !== 'undefined') beautify.beautify(editor.session);
        } catch (e) {
            if (typeof term !== 'undefined') term.write(`\r\n\x1b[33m[WARNING] Syntax formatter bypassed.\x1b[0m\r\n`);
        }
    }

    if (!currentOpenPath) return;

    try {
        if (typeof editor === 'undefined') return;
        await window.ClientBridge.saveFileNatively(currentOpenPath, editor.getValue());

        const currentSession = openTabs[currentOpenPath].session;
        currentSession.getUndoManager().markClean();
        refreshTabVisuals();

        if (typeof term !== 'undefined') term.write(`\r\n\x1b[32m[SYSTEM] Saved: ${currentOpenPath}\x1b[0m\r\n`);
    } catch (e) {
        if (typeof term !== 'undefined') term.write(`\r\n\x1b[31m[ERROR] Save sequence blocked: ${e.message}\x1b[0m\r\n`);
        console.error("Save Error:", e);
    }
}

async function renameItem() {
    if (!currentOpenPath) return alert("Select an active file in the editor first.");
    const oldName = currentOpenPath.split(/[\\/]/).pop();
    const newName = prompt("Rename to:", oldName);
    if (!newName || newName === oldName) return;

    const separator = getPathSeparator(currentOpenPath);
    const parentDir = currentOpenPath.split(/[\\/]/).slice(0, -1).join(separator);
    const newPath = parentDir ? `${parentDir}${separator}${newName}`: newName;

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
        if (typeof term !== 'undefined') term.write(`\r\n\x1b[32m[SYSTEM] Renamed: ${oldName} -> ${newName}\x1b[0m\r\n`);
    } catch (e) {
        if (typeof term !== 'undefined') term.write(`\r\n\x1b[31m[ERROR] Rename transaction failed: ${e.message}\x1b[0m\r\n`);
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
        if (typeof term !== 'undefined') term.write(`\r\n\x1b[33m[SYSTEM] Purged: ${currentOpenPath}\x1b[0m\r\n`);
    } catch (e) {
        if (typeof term !== 'undefined') term.write(`\r\n\x1b[31m[ERROR] Delete sequence failed: ${e.message}\x1b[0m\r\n`);
    }
}

async function createNewFile() {
    const name = prompt("Enter new file name (with extension):");
    if (!name) return;

    const separator = getPathSeparator(currentDirectory);
    const path = currentDirectory ? `${currentDirectory}${separator}${name}`: name;

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
        if (!res.ok) throw new Error(`Server filesystem write violation: ${res.status}`);

        await loadTree(currentDirectory);
        await openFile(path);
        if (typeof term !== 'undefined') term.write(`\r\n\x1b[32m[SYSTEM] Created File: ${name}\x1b[0m\r\n`);
    } catch (e) {
        if (typeof term !== 'undefined') term.write(`\r\n\x1b[31m[ERROR] Node generation failed: ${e.message}\x1b[0m\r\n`);
    }
}

async function createNewFolder() {
    const name = prompt("Enter new directory name:");
    if (!name) return;

    const separator = getPathSeparator(currentDirectory);
    const path = currentDirectory ? `${currentDirectory}${separator}${name}`: name;

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
        if (!res.ok) throw new Error(`Server mkdir exception status: ${res.status}`);

        await loadTree(currentDirectory);
        if (typeof term !== 'undefined') term.write(`\r\n\x1b[32m[SYSTEM] Created Directory: ${name}\x1b[0m\r\n`);
    } catch (e) {
        if (typeof term !== 'undefined') term.write(`\r\n\x1b[31m[ERROR] Allocation error on workspace folder: ${e.message}\x1b[0m\r\n`);
    }
}

function initResizers() {
    const body = document.body;

    if (!body.style.getPropertyValue('--sidebar-width')) body.style.setProperty('--sidebar-width', '280px');
    if (!body.style.getPropertyValue('--editor-width')) body.style.setProperty('--editor-width', '1fr');
    if (!body.style.getPropertyValue('--output-width')) body.style.setProperty('--output-width', '1fr');
    if (!body.style.getPropertyValue('--terminal-height')) body.style.setProperty('--terminal-height', '350px');

    const savedLayout = localStorage.getItem('crucible-layout-vars');
    if (savedLayout) {
        try {
            const layout = JSON.parse(savedLayout);
            if (layout.sidebarWidth) body.style.setProperty('--sidebar-width', layout.sidebarWidth);
            if (layout.editorWidth) body.style.setProperty('--editor-width', layout.editorWidth);
            if (layout.outputWidth) body.style.setProperty('--output-width', layout.outputWidth);
            if (layout.terminalHeight) body.style.setProperty('--terminal-height', layout.terminalHeight);
        } catch (e) {
            console.error("Layout variable restoration sequence failed:", e);
        }
    }

    const startDragging = (id, type) => {
        const resizer = document.getElementById(id);
        if (!resizer) {
            console.warn(`[UI WARNING] Missing drag segment element hook in HTML: #${id}`);
            return;
        }

        resizer.onmousedown = (e) => {
            e.preventDefault();
            body.classList.add('dragging');
            resizer.classList.add('active');

            document.onmousemove = (moveE) => {
                if (type === 'sidebar') {
                    const targetW = Math.max(40, moveE.clientX);
                    body.style.setProperty('--sidebar-width', `${targetW}px`);
                } else if (type === 'editor') {
                    const sidebarW = parseInt(window.getComputedStyle(body).getPropertyValue('--sidebar-width')) || 280;
                    const targetEdW = Math.max(50, moveE.clientX - sidebarW);
                    body.style.setProperty('--editor-width', `${targetEdW}px`);
                } else if (type === 'terminal') {
                    const targetH = Math.max(0, window.innerHeight - moveE.clientY);
                    body.style.setProperty('--terminal-height', `${targetH}px`);
                }

                if (typeof editor !== 'undefined' && editor.resize) editor.resize();
                if (typeof outputEditor !== 'undefined' && outputEditor.resize) outputEditor.resize();
            };

            document.onmouseup = () => {
                body.classList.remove('dragging');
                resizer.classList.remove('active');
                document.onmousemove = null;
                document.onmouseup = null;

                localStorage.setItem('crucible-layout-vars', JSON.stringify({
                    sidebarWidth: body.style.getPropertyValue('--sidebar-width'),
                    editorWidth: body.style.getPropertyValue('--editor-width'),
                    outputWidth: body.style.getPropertyValue('--output-width'),
                    terminalHeight: body.style.getPropertyValue('--terminal-height')
                }));

                if (typeof sendResize === 'function') sendResize();
            };
        };
    };

    startDragging('resizer-sb', 'sidebar');
    startDragging('resizer-ed', 'editor');
    startDragging('resizer-tm', 'terminal');
}

function toggleSplitView() {
    const body = document.body;
    splitViewActive = !splitViewActive;
    const btn = document.getElementById('splitBtn');

    if (!splitViewActive) {
        if (btn) btn.classList.remove('active');
        const currentOutputW = window.getComputedStyle(body).getPropertyValue('--output-width');
        if (currentOutputW !== '0px' && currentOutputW !== '0') {
            body.setAttribute('data-saved-output-w', currentOutputW);
        }
        body.style.setProperty('--output-width', '0px');
        body.style.setProperty('--editor-width', '1fr');
    } else {
        if (btn) btn.classList.add('active');
        let restoredOutputW = body.getAttribute('data-saved-output-w') || '1fr';
        if (restoredOutputW === '0px' || restoredOutputW === '0') restoredOutputW = '1fr';
        body.style.setProperty('--output-width', restoredOutputW);
        body.style.setProperty('--editor-width', '1fr');
    }

    setTimeout(() => {
        if (typeof editor !== 'undefined' && editor.resize) editor.resize();
        if (typeof outputEditor !== 'undefined' && outputEditor.resize) outputEditor.resize();
    }, 150);
}

function toggleTerminal() {
    const body = document.body;
    terminalActive = !terminalActive;
    const btn = document.getElementById('termBtn');
    const termContainer = document.querySelector('.terminal-container');

    if (!terminalActive) {
        if (btn) btn.classList.remove('active');
        const currentTermH = window.getComputedStyle(body).getPropertyValue('--terminal-height');
        if (currentTermH !== '0px' && currentTermH !== '0') {
            body.setAttribute('data-saved-terminal-h', currentTermH);
        }
        body.style.setProperty('--terminal-height', '0px');
        if (termContainer) termContainer.style.display = 'none';
    } else {
        if (btn) btn.classList.add('active');
        let restoredTermH = body.getAttribute('data-saved-terminal-h') || '350px';
        if (restoredTermH === '0px' || restoredTermH === '0') restoredTermH = '350px';
        body.style.setProperty('--terminal-height', restoredTermH);
        if (termContainer) termContainer.style.display = 'flex';
    }

    setTimeout(() => {
        if (typeof editor !== 'undefined' && editor.resize) editor.resize();
        if (typeof outputEditor !== 'undefined' && outputEditor.resize) outputEditor.resize();
    }, 150);
}

function switchSidebar(view) {
    document.querySelectorAll('.sidebar-view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.sidebar-tabs button').forEach(b => b.classList.remove('active'));

    const targetView = document.getElementById(`view-${view}`);
    const targetTab = document.getElementById(`tab-${view}`);

    if (targetView) targetView.classList.add('active');
    if (targetTab) targetTab.classList.add('active');
}

function toggleWrap() {
    const wrap = editor.getOption("wrap") === "off" ? "free" : "off";
    editor.setOption("wrap", wrap);
    outputEditor.setOption("wrap", wrap);
    const btn = document.getElementById('wrapToggle');
    if (btn) {
        if (wrap !== "off") btn.classList.add('active');
        else btn.classList.remove('active');
    }
}

// ==========================================
// WYSIWYG PREVIEW INTERFACE SYSTEMS
// ==========================================

let liveSyncDebounceTimeout;
let isSyncingFromIframe = false;

function togglePreview() {
    const frame = document.getElementById('previewFrame');
    const outEd = document.getElementById('outputEditor');
    const btn = document.getElementById('previewBtn');
    const vpControls = document.getElementById('viewportControls');

    isPreviewActive = !isPreviewActive;

    if (isPreviewActive) {
        if (frame) frame.style.display = 'block';
        if (outEd) outEd.style.display = 'none';
        if (btn) btn.classList.add('active');
        if (vpControls) vpControls.style.display = 'flex';

        renderPreview();
        activateLivePreviewSync();
    } else {
        if (frame) frame.style.display = 'none';
        if (outEd) outEd.style.display = 'block';
        if (btn) btn.classList.remove('active');
        if (vpControls) vpControls.style.display = 'none';

        deactivateLivePreviewSync();
    }
}

function renderPreview() {
    const frame = document.getElementById('previewFrame');
    if (!frame || !isPreviewActive || typeof editor === 'undefined') return;
    const doc = frame.contentDocument || frame.contentWindow.document;
    doc.open();
    doc.write(editor.getValue());
    doc.close();

    injectPreviewInspectorRules(doc);
}

function activateLivePreviewSync() {
    if (typeof editor === 'undefined') return;
    editor.on("input", handleLiveEditorInputMutation);
}

// Bind automatic linting verification cycles directly onto document layout save events
window.addEventListener('blur', () => {
    if (window.currentSelectedPath && window.currentSelectedPath.endsWith('.py')) {
        runPythonLinter();
    }
});

function deactivateLivePreviewSync() {
    if (typeof editor === 'undefined') return;
    editor.off("input", handleLiveEditorInputMutation);
}

function handleLiveEditorInputMutation() {
    if (isSyncingFromIframe) return;
    clearTimeout(liveSyncDebounceTimeout);
    liveSyncDebounceTimeout = setTimeout(() => {
        if (isPreviewActive) renderPreview();
    }, 250);
}

function injectPreviewInspectorRules(targetDocument) {
    if (!targetDocument || !targetDocument.body) return;

    targetDocument.body.contentEditable = "true";

    const styleNode = targetDocument.createElement('style');
    styleNode.id = 'crucible-inspector-styles';
    styleNode.innerHTML = `
    *[data-crucible-inspecting="true"] {
    outline: 2px dashed #569cd6 !important;
    outline-offset: -2px;
    cursor: pointer !important;
    }
    `;
    targetDocument.head.appendChild(styleNode);

    targetDocument.body.addEventListener('input', () => {
        if (typeof editor === 'undefined') return;

        isSyncingFromIframe = true;
        const originalCode = editor.getValue();
        const hasHtmlWrapper = originalCode.toLowerCase().includes('<html') || originalCode.toLowerCase().includes('<body');

        let updatedContent = "";
        if (hasHtmlWrapper) {
            const clone = targetDocument.documentElement.cloneNode(true);
            const instStyle = clone.querySelector('#crucible-inspector-styles');
            if (instStyle) instStyle.remove();
            clone.querySelectorAll('[data-crucible-inspecting]').forEach(el => el.removeAttribute('data-crucible-inspecting'));
            updatedContent = clone.outerHTML;
        } else {
            const cloneBody = targetDocument.body.cloneNode(true);
            const instStyle = cloneBody.querySelector('#crucible-inspector-styles');
            if (instStyle) instStyle.remove();
            cloneBody.querySelectorAll('[data-crucible-inspecting]').forEach(el => el.removeAttribute('data-crucible-inspecting'));
            updatedContent = cloneBody.innerHTML;
        }

        const cursorPosition = editor.getCursorPosition();
        editor.setValue(updatedContent, -1);
        editor.moveCursorToPosition(cursorPosition);

        isSyncingFromIframe = false;
    });

    targetDocument.body.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const targetedNode = e.target;
        const searchString = targetedNode.outerHTML.split('>')[0];

        matchTargetNodeBackToCodeSource(searchString);
    }, true);

    targetDocument.body.addEventListener('mouseover', (e) => {
        e.target.setAttribute('data-crucible-inspecting', 'true');
    }, true);

    targetDocument.body.addEventListener('mouseout', (e) => {
        e.target.removeAttribute('data-crucible-inspecting');
    }, true);
}

function matchTargetNodeBackToCodeSource(elementTagSignature) {
    if (typeof editor === 'undefined') return;

    const documentContent = editor.getValue();
    const lines = documentContent.split('\n');
    let targetedLineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(elementTagSignature)) {
            targetedLineIndex = i;
            break;
        }
    }

    if (targetedLineIndex !== -1) {
        editor.gotoLine(targetedLineIndex + 1, 0, true);
        editor.focus();

        if (typeof term !== 'undefined') {
            term.write(`\r\n\x1b[35m[INSPECTOR] Editor focus synced to line: ${targetedLineIndex + 1}\x1b[0m\r\n`);
        }
    }
}

// ==========================================
// DOCUMENT SYNTAX FORMATTING ACTIONS
// ==========================================

function triggerManualFormat() {
    if (typeof ace === 'undefined' || typeof editor === 'undefined') return;

    const sessionMode = editor.session.getMode().$id;
    const activeTab = document.querySelector('.tab.active');
    const resolvedPath = activeTab ? activeTab.getAttribute('data-path') : window.currentSelectedPath;

    const isPython = (sessionMode === "ace/mode/python") || (resolvedPath && resolvedPath.endsWith('.py'));
    const statusTextElement = document.getElementById('statusText');

    if (isPython) {
        if (!resolvedPath) {
            console.warn("[CRUCIBLE] Formatting aborted: Active file target path mapping is unresolved.");
            return;
        }

        if (statusTextElement) statusTextElement.innerText = "FORMATTING NODE...";

        fetch('/api/format', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: resolvedPath,
                content: editor.getValue()
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success && data.content !== undefined) {
                const cursorPosition = editor.getCursorPosition();

                editor.setValue(data.content, -1);
                editor.moveCursorToPosition(cursorPosition);

                if (statusTextElement) statusTextElement.innerText = "FORMAT COMPLETE";
                if (typeof term !== 'undefined') {
                    term.write(`\r\n\x1b[32m[SYSTEM] Python formatting metrics recalculated via Ruff engine.\x1b[0m\r\n`);
                }
            } else {
                if (statusTextElement) statusTextElement.innerText = "FORMAT FAILED";
                if (typeof term !== 'undefined' && data.error) {
                    term.write(`\r\n\x1b[31m[ERROR] Formatter pipeline exception: ${data.error}\x1b[0m\r\n`);
                }
            }
        })
        .catch(err => {
            console.error("[CRUCIBLE ENGINE] Formatter transport failure:", err);
            if (statusTextElement) statusTextElement.innerText = "NET ERROR";
        });
    } else {
        if (window.crucibleProvider) {
            try {
                if (statusTextElement) statusTextElement.innerText = "FORMATTING BUFFER...";

                window.crucibleProvider.format();

                if (statusTextElement) statusTextElement.innerText = "FORMAT COMPLETE";
                if (typeof term !== 'undefined') {
                    term.write(`\r\n\x1b[32m[SYSTEM] Code layout standardized via client-side Ace Linters toolchain.\x1b[0m\r\n`);
                }
            } catch (e) {
                console.error("[CRUCIBLE ENGINE] Extension formatting execution failed:", e.message);
                if (statusTextElement) statusTextElement.innerText = "FORMAT FAILED";
                runFallbackBeautify();
            }
        } else {
            runFallbackBeautify();
        }
    }
}

function runFallbackBeautify() {
    try {
        const beautify = ace.require("ace/ext/beautify");
        beautify.beautify(editor.session);
        if (typeof term !== 'undefined') {
            term.write(`\r\n\x1b[32m[SYSTEM] Document formatting metrics recalculated.\x1b[0m\r\n`);
        }
    } catch (e) {
        console.error("[CRUCIBLE ENGINE] Client-side formatting execution failed:", e.message);
        if (typeof term !== 'undefined') {
            term.write(`\r\n\x1b[31m[ERROR] Formatting exception encountered: ${e.message}\x1b[0m\r\n`);
        }
    }
}

function toggleAutoFormat() {
    if (typeof autoFormatOnSave !== 'undefined') {
        autoFormatOnSave = !autoFormatOnSave;
        const btn = document.getElementById('formatToggle');
        if (btn) {
            if (autoFormatOnSave) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    }
}

// ==========================================
// UNIFIED TELEMETRY GRAPHICS CONTROLLER
// ==========================================

window.handleCrucibleTelemetry = function(packet) {
    const statusTextElement = document.getElementById('statusText');
    const progressFillElement = document.getElementById('progressFill');

    if (!packet) return;

    if (packet.type === 'progress') {
        const progress = packet.data;
        if (progressFillElement && progress.percent !== undefined) {
            progressFillElement.style.width = `${progress.percent}%`;
        }
        if (statusTextElement && progress.file) {
            statusTextElement.innerText = `INDEXING: ${progress.file} (${progress.percent}%)`;
        }
    }

    if (packet.type === 'build_status') {
        const payload = packet.data;

        if (typeof term !== 'undefined' && payload.text) {
            term.write(payload.text.replace(/\n/g, '\r\n'));
        }

        if (payload.percent !== null && payload.percent !== undefined) {
            if (progressFillElement) progressFillElement.style.width = `${payload.percent}%`;
            if (statusTextElement) statusTextElement.innerText = `COMPILING: ${payload.percent}%`;
        }
    }

    if (packet.type === 'build_complete') {
        const result = packet.data;
        if (progressFillElement) progressFillElement.style.width = result.success ? '100%' : '0%';

        if (statusTextElement) {
            statusTextElement.innerText = result.success
            ? 'BUILD SUCCESSFUL' : `BUILD FAILED (EXIT CODE ${result.exitCode})`;
        }

        if (progressFillElement) {
            progressFillElement.style.background = result.success ? 'var(--ui-accent)' : '#e74c3c';
            setTimeout(() => {
                progressFillElement.style.width = '0%';
                progressFillElement.style.background = 'var(--ui-bg-hover)';
            }, 4000);
        }
    }
};

// ==========================================
// INDEPENDENT SYSTEM TOOLCHAIN DECLARATIONS
// ==========================================

function runPythonLinter() {
    if (typeof editor === 'undefined' || !window.currentSelectedPath) return;

    fetch('/api/lint', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            path: window.currentSelectedPath
        })
    })
    .then(res => res.json())
    .then(data => {
        if (editor.session && editor.session.setAnnotations) {
            editor.session.setAnnotations(data.markers);
        }
    })
    .catch(err => console.error("[CRUCIBLE LINTER] Diagnostic parsing sequence aborted:", err));
}

function executeActiveScript() {
    const activeTab = document.querySelector('.tab.active');
    const activePath = (activeTab ? activeTab.getAttribute('data-path') : null) || window.currentOpenPath || window.currentSelectedPath;

    if (!activePath) {
        console.warn("[UI WARNING] Run command ignored: No target file highlighted.");
        const statusElement = document.getElementById('statusText');
        if (statusElement) statusElement.innerText = "NO ACTIVE TARGET";
        return;
    }

    if (typeof saveFile === 'function') saveFile();

    const ext = activePath.split('.').pop().toLowerCase();
    let runMacro = "";

    if (ext === 'py') {
        runMacro = `\x03\npython3 "${activePath}"\n`;
    } else if (ext === 'js') {
        runMacro = `\x03\nnode "${activePath}"\n`;
    } else {
        console.warn(`[UI WARNING] Execution blocked: Unsupported file type (.${ext}).`);
        const statusElement = document.getElementById('statusText');
        if (statusElement) statusElement.innerText = "UNSUPPORTED TARGET";
        return;
    }

    if (window.crucibleSocket && window.crucibleSocket.readyState === WebSocket.OPEN) {
        window.crucibleSocket.send(JSON.stringify({
            type: 'input',
            data: runMacro
        }));
        console.log(`[EXECUTION DISPATCH] Sent macro for: ${activePath}`);
    } else {
        console.error("[NET FAILURE] Macro transmission blocked: Pipeline offline.");
    }
}

function enableEditorIntel() {
    if (typeof ace !== 'undefined' && typeof editor !== 'undefined') {
        ace.config.loadModule("ace/ext/language_tools", function() {
            editor.setOptions({
                enableBasicAutocompletion: true,
                enableLiveAutocompletion: true,
                enableSnippets: true
            });
        });
    }
}

function initGutterBreakpoints() {
    if (typeof editor === 'undefined') return;

    editor.on("gutterclick", function(e) {
        const targetRow = e.getDocumentPosition().row;
        const breakpoints = e.editor.session.getBreakpoints();

        if (typeof breakpoints[targetRow] === 'undefined') {
            e.editor.session.setBreakpoint(targetRow, "breakpoint");
            console.log(`[DEBUGGER] Breakpoint assigned to absolute row coordinate: ${targetRow + 1}`);
        } else {
            e.editor.session.clearBreakpoint(targetRow);
            console.log(`[DEBUGGER] Breakpoint stripped from row coordinate: ${targetRow + 1}`);
        }
    });
}

function monitorDocumentState() {
    if (typeof editor === 'undefined') return;

    editor.on("input", function() {
        const activeTab = document.querySelector('.tab.active');
        if (!activeTab) return;

        const isClean = editor.session.getUndoManager().isClean();
        let indicator = activeTab.querySelector('.tab-dirty-indicator');

        if (!isClean) {
            if (!indicator) {
                indicator = document.createElement('span');
                indicator.className = 'tab-dirty-indicator';
                indicator.style.cssText = 'color: var(--ui-accent); margin-left: 6px;';
                indicator.innerText = '●';
                activeTab.appendChild(indicator);
            }
        } else {
            if (indicator) indicator.remove();
        }
    });
}

function initAceLinters() {
    if (typeof LanguageProvider !== 'undefined' && typeof editor !== 'undefined') {

        window.crucibleProvider = LanguageProvider.fromCdn("https://unpkg.com/ace-linters@latest/build/");
        window.crucibleProvider.registerEditor(editor);

        window.crucibleProvider.setGlobalOptions("python", {
            configuration: {
                lineLength: 120
            }
        });

        window.crucibleProvider.setGlobalOptions("typescript", {
            compilerOptions: {
                allowJs: true,
                target: 99,
                module: 99,
                checkJs: true
            }
        });

        console.log("[SYSTEM] Polyglot LSP Engine engaged (Python, JS/TS).");

        enableEditorIntel();
        initGutterBreakpoints();
        monitorDocumentState();

    } else {
        setTimeout(initAceLinters, 100);
    }
}
