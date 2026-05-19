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

