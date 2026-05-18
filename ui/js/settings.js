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
function toggleCustomThemeEditor() {
    const themeId = document.getElementById('set-theme').value;
    const customEditor = document.getElementById('customThemeEditor');

    if (customEditor) {
        customEditor.style.display = (themeId === 'custom' || (window.userThemes && window.userThemes[themeId])) ? 'flex': 'none';
    }

    if (window.userThemes && window.userThemes[themeId]) {
        const t = window.userThemes[themeId];
        document.getElementById('color-bg-base').value = t.ui.base;
        document.getElementById('color-bg-panel').value = t.ui.panel;
        document.getElementById('color-bg-surface').value = t.ui.surface;
        document.getElementById('color-bg-hover').value = t.ui.hover || '#111111';
        document.getElementById('color-border-dark').value = t.ui.borderDark || '#1a1a1a';
        document.getElementById('color-border-light').value = t.ui.borderLight || '#222222';
        document.getElementById('color-text-dim').value = t.ui.textDim || '#444444';
        document.getElementById('color-text-muted').value = t.ui.textMuted;
        document.getElementById('color-text-main').value = t.ui.textMain || '#888888';
        document.getElementById('color-text-bright').value = t.ui.textBright;
        document.getElementById('color-accent').value = t.ui.accent;
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

    Object.keys(window.userThemes || {}).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.text = `* ${window.userThemes[key].name}`;
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

    if (!window.userThemes) window.userThemes = {};

    window.userThemes[id] = {
        name: name,
        ace: "ace/theme/chaos",
        term: window.CrucibleThemes?.chaos?.term || {
            background: document.getElementById('color-bg-base').value,
            foreground: document.getElementById('color-text-main').value,
            cursor: document.getElementById('color-accent').value,
            selection: document.getElementById('color-bg-hover').value
        },
        ui: {
            base: document.getElementById('color-bg-base').value,
            panel: document.getElementById('color-bg-panel').value,
            surface: document.getElementById('color-bg-surface').value,
            hover: document.getElementById('color-bg-hover').value,
            borderDark: document.getElementById('color-border-dark').value,
            borderLight: document.getElementById('color-border-light').value,
            textDim: document.getElementById('color-text-dim').value,
            textMuted: document.getElementById('color-text-muted').value,
            textMain: document.getElementById('color-text-main').value,
            textBright: document.getElementById('color-text-bright').value,
            accent: document.getElementById('color-accent').value
        }
    };

    try {
        // 1. Write the vector layout data to the theme database pool
        await fetch('/api/themes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(window.userThemes)
        });

        populateThemeDropdown();
        document.getElementById('set-theme').value = id;

        // 2. Background synchronization loop to bind this ID directly to the active system state config
        const autoConfigSync = {
            theme: id,
            edFont: document.getElementById('set-ed-font').value,
            tmFont: document.getElementById('set-tm-font').value,
            pat: document.getElementById('set-pat').value,
            repo: document.getElementById('set-repo').value,
            gitName: document.getElementById('set-git-name').value,
            gitEmail: document.getElementById('set-git-email').value,
            wordwrap: document.getElementById('set-wordwrap')?.checked ?? true,
            autoformat: autoFormatOnSave,
            customColors: JSON.parse(JSON.stringify(window.userThemes[id].ui))
        };

        await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(autoConfigSync)
        });

        applySettings(autoConfigSync);
        term.write(`\r\n\x1b[32m[SYSTEM] Custom theme '${name}' saved and set as active preference.\x1b[0m\r\n`);
    } catch (e) {
        term.write('\r\n\x1b[31m[ERROR] Failed to write theme to disk.\x1b[0m\r\n');
    }
}
function applySettings(config) {
    const isCustomUnsaved = config.theme === 'custom';
    let t = (window.CrucibleThemes && window.CrucibleThemes[config.theme]) || (window.userThemes && window.userThemes[config.theme]) || (window.CrucibleThemes && window.CrucibleThemes.twilight);

    const root = document.documentElement;

    if (isCustomUnsaved && config.customColors) {
        root.style.setProperty('--ui-bg-base', config.customColors.base);
        root.style.setProperty('--ui-bg-panel', config.customColors.panel);
        root.style.setProperty('--ui-bg-surface', config.customColors.surface);
        root.style.setProperty('--ui-bg-hover', config.customColors.hover || '#111111');
        root.style.setProperty('--ui-border-dark', config.customColors.borderDark || '#1a1a1a');
        root.style.setProperty('--ui-border-light', config.customColors.borderLight || '#222222');
        root.style.setProperty('--ui-text-dim', config.customColors.textDim || '#444444');
        root.style.setProperty('--ui-text-muted', config.customColors.textMuted);
        root.style.setProperty('--ui-text-main', config.customColors.textMain || '#888888');
        root.style.setProperty('--ui-text-bright', config.customColors.textBright);
        root.style.setProperty('--ui-accent', config.customColors.accent);
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
            } else {
                formatBtn.classList.remove('active');
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
            safeSet('color-bg-hover', saved.customColors.hover || '#111111');
            safeSet('color-border-dark', saved.customColors.borderDark || '#1a1a1a');
            safeSet('color-border-light', saved.customColors.borderLight || '#222222');
            safeSet('color-text-dim', saved.customColors.textDim || '#444444');
            safeSet('color-text-muted', saved.customColors.textMuted);
            safeSet('color-text-main', saved.customColors.textMain || '#888888');
            safeSet('color-text-bright', saved.customColors.textBright);
            safeSet('color-accent', saved.customColors.accent);
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
            hover: document.getElementById('color-bg-hover').value,
            borderDark: document.getElementById('color-border-dark').value,
            borderLight: document.getElementById('color-border-light').value,
            textDim: document.getElementById('color-text-dim').value,
            textMuted: document.getElementById('color-text-muted').value,
            textMain: document.getElementById('color-text-main').value,
            textBright: document.getElementById('color-text-bright').value,
            accent: document.getElementById('color-accent').value
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