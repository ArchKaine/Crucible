// ==========================================
// CLIENT IPC ROUTER (Photino vs Web Sandbox)
// ==========================================

const ClientBridge = {
    isNative: typeof window !== 'undefined' && window.external && typeof window.external.sendMessage === 'function',

    init: function() {
        if (this.isNative) {
            window.external.receiveMessage(message => {
                if (message.startsWith("NOTIFY:")) {
                    console.log(message.replace("NOTIFY:", "").trim());
                    if (typeof term !== 'undefined') {
                        term.write(`\r\n\x1b[32m[SYSTEM] ${message.replace("NOTIFY:", "").trim()}\x1b[0m\r\n`);
                    }
                }
            });
            console.log("[SYSTEM] Photino C# IPC Bridge established.");
        } else {
            console.log("[SYSTEM] Web Sandbox Mode active. C# Bridge disconnected.");
        }
    },

    saveFileNatively: async function(path, content) {
        if (this.isNative) {
            // Direct injection to C# Photino backend
            window.external.sendMessage(`SAVE:${path}|${content}`);
            if (typeof term !== 'undefined') {
                term.write(`\r\n\x1b[90m[IPC] Pushed native save command to host OS.\x1b[0m\r\n`);
            }
        } else {
            // Fallback for Firefox/Chrome via Node.js server
            try {
                const res = await fetch('/api/write', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        path: path, content: content
                    })
                });

                if (res.ok) {
                    if (typeof term !== 'undefined') term.write(`\r\n\x1b[32m[SERVER] File saved via network fallback.\x1b[0m\r\n`);
                } else {
                    throw new Error("Network write failed.");
                }
            } catch (err) {
                if (typeof term !== 'undefined') term.write(`\r\n\x1b[31m[ERROR] ${err.message}\x1b[0m\r\n`);
            }
        }
    }
};

// Initialize the client bridge on script load
ClientBridge.init();