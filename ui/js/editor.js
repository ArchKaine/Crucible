function initResizers() {
    const body = document.body;

    // Fallback variable tracking check initialization
    if (!body.style.getPropertyValue('--sidebar-width')) body.style.setProperty('--sidebar-width', '280px');
    if (!body.style.getPropertyValue('--editor-width')) body.style.setProperty('--editor-width', '1fr');
    if (!body.style.getPropertyValue('--output-width')) body.style.setProperty('--output-width', '1fr');
    if (!body.style.getPropertyValue('--terminal-height')) body.style.setProperty('--terminal-height', '350px');

    // Restore custom layout allocation state maps from persistent local memory storage
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

                // Force workspace tracking frames to evaluate dimensional resizing updates
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

    // Activates edit capabilities directly inside the layout canvas view
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

    // Dynamic inverse synchronization channel mapping edits from canvas back to source
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

    // Direct extraction from the active session mode to bypass sidebar desynchronization
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

        // Ship the live viewport text buffer directly to bypass disk write race conditions
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

                // Commit the formatted string back to the viewport asset layer
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
        // Intercept execution and route through the Ace Linters pipeline if initialized
        if (window.crucibleProvider) {
            try {
                if (statusTextElement) statusTextElement.innerText = "FORMATTING BUFFER...";

                // Invokes the native in-browser provider execution routine
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

function setViewport(width) {
    const frame = document.getElementById('previewFrame');
    if (frame) frame.style.width = width;
}

function togglePreviewBackground() {
    const frame = document.getElementById('previewFrame');
    if (!frame) return;
    previewBgState = (previewBgState + 1) % 3;
    if (previewBgState === 0) frame.style.background = '#fff';
    else if (previewBgState === 1) frame.style.background = '#000';
    else frame.style.background = 'transparent';
}

// Global window event monitor to maintain grid alignment on window geometry mutations
window.addEventListener('resize', () => {
    if (typeof editor !== 'undefined' && editor.resize) editor.resize();
    if (typeof outputEditor !== 'undefined' && outputEditor.resize) outputEditor.resize();
});

// ==========================================
// UNIFIED TELEMETRY GRAPHICS CONTROLLER
// ==========================================

window.handleCrucibleTelemetry = function(packet) {
    const statusTextElement = document.getElementById('statusText');
    const progressFillElement = document.getElementById('progressFill');

    if (!packet) return;

    // Project vector storage synchronization stream handler
    if (packet.type === 'progress') {
        const progress = packet.data;
        if (progressFillElement && progress.percent !== undefined) {
            progressFillElement.style.width = `${progress.percent}%`;
        }
        if (statusTextElement && progress.file) {
            statusTextElement.innerText = `INDEXING: ${progress.file} (${progress.percent}%)`;
        }
    }

    // Polyglot asynchronous compiler stream handler
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

    // Build process termination handler
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

/**
* Executes a static code check against the active python document
* Maps compilation anomalies directly onto the editor gutter array
*/
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
            // Commits the diagnostic objects directly into the Ace structural framework
            editor.session.setAnnotations(data.markers);
        }
    })
    .catch(err => console.error("[CRUCIBLE LINTER] Diagnostic parsing sequence aborted:", err));
}

/**
* Commands the active shell loop to run the focused script asset.
* Routes execution dynamically based on file extension.
*/
function executeActiveScript() {
    // Bulletproof path resolution: Check the DOM first, then fallback to global tracking variables
    const activeTab = document.querySelector('.tab.active');
    const activePath = (activeTab ? activeTab.getAttribute('data-path') : null) || window.currentOpenPath || window.currentSelectedPath;

    if (!activePath) {
        console.warn("[UI WARNING] Run command ignored: No target file highlighted.");
        const statusElement = document.getElementById('statusText');
        if (statusElement) statusElement.innerText = "NO ACTIVE TARGET";
        return;
    }

    // Force a save to ensure the terminal runs the latest buffer
    if (typeof saveFile === 'function') saveFile();

    const ext = activePath.split('.').pop().toLowerCase();
    let runMacro = "";

    // Polyglot Execution Router
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
        // Sends the interrupt sequence (Ctrl+C) to clear dead loops, then fires the command
        window.crucibleSocket.send(JSON.stringify({
            type: 'input',
            data: runMacro
        }));
        console.log(`[EXECUTION DISPATCH] Sent macro for: ${activePath}`);
    } else {
        console.error("[NET FAILURE] Macro transmission blocked: Pipeline offline.");
    }
}

// Configures the core editor instance to support live autocompletion mechanics
function enableEditorIntel() {
    if (typeof ace !== 'undefined' && typeof editor !== 'undefined') {
        // Injects the native language tools module
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
                // Injects a small visual layout dot indicating modification states
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

// Bind automatic linting verification cycles directly onto document layout save events
window.addEventListener('blur', () => {
    if (window.currentSelectedPath && window.currentSelectedPath.endsWith('.py')) {
        runPythonLinter();
    }
});

// ==========================================
// CORE LANGUAGE SERVER PROTOCOL (LSP) ENGINE
// ==========================================
function initAceLinters() {
    if (typeof LanguageProvider !== 'undefined' && typeof editor !== 'undefined') {

        window.crucibleProvider = LanguageProvider.fromCdn("https://unpkg.com/ace-linters@latest/build/");
        window.crucibleProvider.registerEditor(editor);

        // Configure Python
        window.crucibleProvider.setGlobalOptions("python", {
            configuration: {
                lineLength: 120
            }
        });

        // Configure JavaScript / TypeScript
        window.crucibleProvider.setGlobalOptions("typescript", {
            compilerOptions: {
                allowJs: true,
                target: 99, // ESNext
                module: 99, // ESNext
                checkJs: true // Enables live linting for standard .js files
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
