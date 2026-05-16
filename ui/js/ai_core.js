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
