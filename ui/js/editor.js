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
        if (!resizer) return;

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

window.executeActiveScript = async function() {
    const activePath = window.currentOpenPath;

    if (!activePath) {
        if (typeof term !== 'undefined') term.write('\r\n\x1b[33m[SYSTEM] Execution aborted: No active workspace file selected.\x1b[0m\r\n');
        return;
    }

    // Force a save to ensure the terminal executes the absolute latest buffer
    if (typeof saveFile === 'function') {
        await saveFile();
    }

    // Extract the directory path of the active file to align the execution context
    const dirPath = activePath.substring(0, Math.max(activePath.lastIndexOf('/'), activePath.lastIndexOf('\\')));
    const fileName = activePath.substring(Math.max(activePath.lastIndexOf('/'), activePath.lastIndexOf('\\')) + 1);

    const ext = activePath.split('.').pop().toLowerCase();
    let command = '';

    // Use the sub-shell execution flag directly
    switch (ext) {
        case 'py':
            command = `python3 "${activePath}"\r`;
            break;
        case 'js':
            command = `node "${activePath}"\r`;
            break;
        case 'sh':
            command = `bash "${activePath}"\r`;
            break;
        case 'rs':
            // REPLACE /usr/bin/cargo WITH THE OUTPUT FROM 'which cargo'
            const CARGO_PATH = '/usr/bin/cargo';
            command = `${CARGO_PATH} run --manifest-path "${dirPath}/Cargo.toml"\r`;
            break;
        case 'cpp':
            case 'c':
                command = `make -C "${dirPath}" run\r`;
                break;
            default:
                if (typeof term !== 'undefined') term.write(`\r\n\x1b[31m[SYSTEM] Execution failed: Unsupported target extension (.${ext}).\x1b[0m\r\n`);
                return;
            }

            // Auto-deploy the terminal panel if it is currently hidden
            if (typeof terminalActive !== 'undefined' && !terminalActive && typeof toggleTerminal === 'function') {
                toggleTerminal();
            }

            // Route the command string straight into the PTY WebSocket pipeline
            if (window.crucibleSocket && window.crucibleSocket.readyState === WebSocket.OPEN) {
                if (typeof term !== 'undefined') term.focus();
                window.crucibleSocket.send(JSON.stringify({
                    type: 'input',
                    data: command
                }));
            } else {
                if (typeof term !== 'undefined') term.write('\r\n\x1b[31m[ERROR] PTY Socket disconnected. Backend unresponsive.\x1b[0m\r\n');
            }
    };

    function toggleSplitView() {
        const body = document.body;
        if (typeof splitViewActive !== 'undefined') splitViewActive = !splitViewActive;
        const btn = document.getElementById('splitBtn');

        if (typeof splitViewActive !== 'undefined' && !splitViewActive) {
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
        },
            150);
    }

    function toggleTerminal() {
        const body = document.body;
        if (typeof terminalActive !== 'undefined') terminalActive = !terminalActive;
        const btn = document.getElementById('termBtn');
        const termContainer = document.querySelector('.terminal-container');

        if (typeof terminalActive !== 'undefined' && !terminalActive) {
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
        },
            150);
    }

    function toggleWrap() {
        if (typeof editor === 'undefined') return;
        const wrap = editor.getOption("wrap") === "off" ? "free": "off";
        editor.setOption("wrap", wrap);
        if (typeof outputEditor !== 'undefined') outputEditor.setOption("wrap", wrap);

        const btn = document.getElementById('wrapToggle');
        if (btn) {
            if (wrap !== "off") btn.classList.add('active');
            else btn.classList.remove('active');
        }
    }

    function togglePreview() {
        const frame = document.getElementById('previewFrame');
        const outEd = document.getElementById('outputEditor');
        const btn = document.getElementById('previewBtn');
        const vpControls = document.getElementById('viewportControls');

        if (typeof isPreviewActive !== 'undefined') isPreviewActive = !isPreviewActive;

        if (typeof isPreviewActive !== 'undefined' && isPreviewActive) {
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
        if (!frame || typeof editor === 'undefined') return;

        const doc = frame.contentDocument || frame.contentWindow.document;
        doc.open();
        doc.write(editor.getValue());
        doc.close();

        // The delay ensures the DOM is fully constructed before we hijack it
        setTimeout(() => {
            if (typeof window.injectPreviewInspectorRules === 'function') {
                window.injectPreviewInspectorRules(doc);
            }
        },
            50);
    }

    function triggerManualFormat() {
        if (typeof ace === 'undefined' || typeof editor === 'undefined') return;

        const statusTextElement = document.getElementById('statusText');

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

    function setViewport(width) {
        const frame = document.getElementById('previewFrame');
        if (frame) frame.style.width = width;
    }

    function togglePreviewBackground() {
        const frame = document.getElementById('previewFrame');
        if (!frame) return;
        if (typeof previewBgState !== 'undefined') {
            previewBgState = (previewBgState + 1) % 3;
            if (previewBgState === 0) frame.style.background = '#fff';
            else if (previewBgState === 1) frame.style.background = '#000';
            else frame.style.background = 'transparent';
        }
    }

    // A central state tracker for diff resources
    window.diffState = {
        isSyncing: false,
        leftEd: null,
        rightEd: null
    };

    window.launchDiffUI = function(fileName, timestamp, liveText, archiveText) {
        let diffContainer = document.getElementById('crucible-diff-overlay');
        if (diffContainer) diffContainer.remove(); // Force clean slate

        diffContainer = document.createElement('div');
        diffContainer.id = 'crucible-diff-overlay';
        diffContainer.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: var(--ui-bg-base); z-index: 9999;
        display: flex; flex-direction: column;
        `;
        document.body.appendChild(diffContainer);

        diffContainer.innerHTML = `
        <style>
        .diff-marker-add { background: rgba(46, 204, 113, 0.25) !important; position: absolute; z-index: 20; }
        .diff-marker-remove { background: rgba(231, 76, 60, 0.25) !important; position: absolute; z-index: 20; }
        </style>
        <div style="padding: 10px; background: var(--ui-bg-panel); border-bottom: 1px solid var(--ui-border-dark); display: flex; justify-content: space-between; align-items: center;">
        <span style="color: var(--ui-text-bright); font-weight: bold; letter-spacing: 1px;">DIFF: ${fileName}</span>
        <button onclick="window.closeDiffUI()" style="background: #e74c3c; color: white; border: none; padding: 5px 15px; cursor: pointer; font-weight: bold;">CLOSE</button>
        </div>
        <div style="display: flex; flex: 1; overflow: hidden; min-height: 0;">
        <div style="flex: 1; display: flex; flex-direction: column; border-right: 1px solid var(--ui-border-dark); min-width: 0;">
        <div style="padding: 5px; background: var(--ui-bg-surface); text-align: center; font-size: 10px;">ARCHIVE [${timestamp}]</div>
        <div id="diff-left-editor" style="flex: 1;"></div>
        </div>
        <div style="flex: 1; display: flex; flex-direction: column; min-width: 0;">
        <div style="padding: 5px; background: var(--ui-bg-surface); text-align: center; font-size: 10px; color: var(--ui-accent);">LIVE WORKSPACE</div>
        <div id="diff-right-editor" style="flex: 1;"></div>
        </div>
        </div>
        `;

        // Initialize Ace
        window.diffState.leftEd = ace.edit("diff-left-editor");
        window.diffState.rightEd = ace.edit("diff-right-editor");

        [window.diffState.leftEd,
            window.diffState.rightEd].forEach(ed => {
                ed.setTheme(editor.getTheme());
                ed.session.setMode(editor.session.getMode().$id);
                ed.setReadOnly(true);
                ed.setOptions({
                    showFoldWidgets: false, printMargin: false
                });
            });

        window.diffState.leftEd.setValue(archiveText, -1);
        window.diffState.rightEd.setValue(liveText, -1);

        // GOVERNOR SYNC: Fixes the clamping/jitter issue
        const sync = (source, target) => {
            source.session.on('changeScrollTop', (pos) => {
                if (window.diffState.isSyncing) return;
                window.diffState.isSyncing = true;
                target.session.setScrollTop(pos);
                window.diffState.isSyncing = false;
            });
        };

        sync(window.diffState.leftEd,
            window.diffState.rightEd);
        sync(window.diffState.rightEd,
            window.diffState.leftEd);

        // Run Diff Highlight
        if (typeof Diff !== 'undefined') {
            const Range = ace.require('ace/range').Range;
            const diffs = Diff.diffLines(archiveText, liveText);
            let leftRow = 0,
            rightRow = 0;
            diffs.forEach(part => {
                if (part.added) {
                    window.diffState.rightEd.session.addMarker(new Range(rightRow, 0, rightRow + part.count - 1, 1), "diff-marker-add", "fullLine");
                    rightRow += part.count;
                } else if (part.removed) {
                    window.diffState.leftEd.session.addMarker(new Range(leftRow, 0, leftRow + part.count - 1, 1), "diff-marker-remove", "fullLine");
                    leftRow += part.count;
                } else {
                    leftRow += part.count; rightRow += part.count;
                }
            });
        }
    };

    window.closeDiffUI = function() {
        const el = document.getElementById('crucible-diff-overlay');
        if (el) {
            // Destroy ACE instances to free memory
            if (window.diffState.leftEd) window.diffState.leftEd.destroy();
            if (window.diffState.rightEd) window.diffState.rightEd.destroy();
            el.remove();
        }
    };