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
        console.error("Failed to load layout directory tree:",
            e);
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

    // Split efficiently while tracking platform architecture variations
    const parts = dir.split(/[\\/]/).filter(p => p);

    const rootSpan = document.createElement('span');
    rootSpan.innerText = isWindowsAbsolute ? 'WORKSPACE / ': 'ROOT / ';
    rootSpan.onclick = () => loadTree(isWindowsAbsolute ? parts[0] + separator: '/');
    bc.appendChild(rootSpan);

    let runningPath = isWindowsAbsolute ? parts[0]: '';

    parts.forEach((p, i) => {
        if (isWindowsAbsolute && i === 0) return; // Skip drive designator processing loop

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

        // Get the syntax mode string, explicitly capturing Python mapping
        const syntaxMode = typeof getSyntaxMode === 'function' ? getSyntaxMode(fileName): 'ace/mode/text';

        // Ensure Ace handles the session initialization cleanly
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

        // Critical hook: Apply syntax mode post-initialization to ensure Ace Extension awareness
        if (typeof ace !== 'undefined' && typeof editor !== 'undefined') {
            try {
                // Enforce proper syntax language switching based strictly on file extension
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

        // Reinforce syntax mode when swapping active buffers
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
        activeTab.setAttribute('data-path', path); // Ensures explicit path tracking for formatting routes
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