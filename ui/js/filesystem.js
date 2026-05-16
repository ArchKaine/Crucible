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
