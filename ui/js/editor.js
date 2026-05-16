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
async function triggerManualFormat() {
    const beautify = ace.require("ace/ext/beautify");
    if (beautify) {
        beautify.beautify(editor.session);
        term.write('\r\n\x1b[32m[SYSTEM] Active document formatted.\x1b[0m\r\n');
    } else {
        term.write('\r\n\x1b[31m[ERROR] Formatter engine not loaded.\x1b[0m\r\n');
    }
}
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
function toggleWrap() {
    const wrapping = editor.getOption("wrap") === "off";
    [editor,
        outputEditor].forEach(ed => ed.setOption("wrap", wrapping ? "free": "off"));
    document.getElementById('wrapToggle').classList.toggle('active', wrapping);
    Object.values(openTabs).forEach(tab => tab.session.setUseWrapMode(wrapping));
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
