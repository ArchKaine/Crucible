# Crucible IDE

**A lightweight, AI-driven Integrated Development Environment built for speed, data sovereignty, and rapid iteration.**

Crucible abandons the bloated Chromium dependencies of traditional desktop wrappers (like Electron) in favor of a hybrid architecture. It combines a microscopic **C# Photino** shell with a powerful **Node.js** backend and **Vanilla Web** frontend. The result is an uncompromising, fully local AI workspace with zero latency and zero data leakage.

---

## Core Systems

### 1. Dual-Buffer AI Engine & Differential Merge
Crucible features a twin-editor layout. The primary buffer holds the active workspace, while the secondary output buffer catches local LLM generations.
* **Surgical Guard:** Built-in safeguards automatically reject merge attempts if the incoming AI payload is significantly shorter than the existing file, preventing accidental code gutting.

### 2. Semantic RAG Indexing
The Forge maps your local workspace into a targeted vector array (`vector_index.jsonl`).
* Natively calculates cosine similarity to cross-reference your directives against local files.
* Automatically injects the top 5 most relevant file excerpts directly into the AI's context window.

### 3. Integrated Source Control
A built-in, native Git GUI that doesn't just read status, but actively manages your repository.
* Full support for Git Init, Stage, Commit, Push, Pull, and Branching.
* **Unified Auth Engine:** Securely injects GitHub Personal Access Tokens (PAT) and Remote Origin URLs via the Node.js backend.
* **Conflict Detection:** Intercepts and warns of merge conflicts before they corrupt your workspace.

### 4. Shadow Forge Verification
Never deploy broken AI logic. The `/api/shadow-test` endpoint copies the active file to a secure `/tmp/crucible_shadow` directory and runs strict syntax verification (`node --check`) to ensure structural integrity without executing volatile code in your main workspace.

### 5. Native Telemetry & Live Preview
* **Native Bash PTY:** A fully interactive terminal piped directly to the host machine's shell via WebSockets and `node-pty`.
* **Sandboxed Preview:** An integrated `iframe` viewport for testing frontends. DOM events are intercepted, routing `console.log` and `console.error` outputs directly back to the IDE terminal.

---

## Architecture & Tech Stack

* **The Application Shell:** C# Photino (Native Desktop WebView)
* **The Backend Forge:** Node.js (`server.js`)
* **The Frontend:** HTML5, Vanilla JavaScript, CSS3

**Local Node Dependencies:**
* `node-pty`: Native C/C++ terminal bindings.
* `ws`: WebSocket server for real-time telemetry and indexing streams.

**Remote Dependencies (CDNs):**
* `ace.js` (Cloudflare) for syntax highlighting and IDE action commands.
* `xterm.js` (jsDelivr) for browser-based terminal emulation.

---

## Deployment Procedures

### Prerequisites

1. **Node.js** (v16+ recommended).
2. **C/C++ Build Tools** (Required to compile `node-pty` native bindings on the host OS).
3. **Local AI Server** (e.g., LM Studio, Ollama) running an OpenAI-compatible endpoint on `http://127.0.0.1:1234`.
   * *Required Coder Model:* e.g., `qwen2.5-coder-14b`.
   * *Required Embedding Model:* e.g., `text-embedding-nomic-embed-text-v2-moe`.
4. **.NET SDK** (Required to run the Photino shell).

---

## ⚙️ Engine Ignition: Using `launcher.sh`

The Crucible IDE relies on a localized daemon manager (`launcher.sh`) to handle process execution, port binding, and background survival. 

### 1. Initial Setup
Clone the repository, install the dependencies, and ensure the launcher has the correct execution permissions assigned by the OS. 

Run the following commands in your terminal from the project root:
```bash
npm install
chmod +x launcher.sh
```

### 2. Environment Configuration
`launcher.sh` expects a valid `.env` file in the root directory to feed the Node.js backend. If you do not have one, create it. 

At minimum, your `.env` should define your network ports and AI endpoints:
```ini
CRUCIBLE_PORT="3000"
LMS_PORT="1234"
LMS_MODEL="your-local-model-name"
EMBED_MODEL="your-embedding-model-name"
```

### 3. Command Syntax
The launcher is controlled via standard arguments. Do not run `node server.js` directly unless you are actively debugging core router crashes.

* **Start the System:**
  Spins up the Node.js backend, detaches it from the terminal, and binds it to the port specified in your `.env`.
  ```bash
  ./launcher.sh start
  ```

* **Stop the System:**
  Locates the active Crucible process ID (PID) and gracefully terminates it, freeing the ports.
  ```bash
  ./launcher.sh stop
  ```

* **Restart / Reload Configuration:**
  **Crucial Workflow:** If you manually update the `.env` file or modify the `server.js` routing logic, you must restart the daemon to ingest the new variables.
  ```bash
  ./launcher.sh restart
  ```

* **Check Status:**
  Verifies if the Crucible process is currently active in the background and returns its PID.
  ```bash
  ./launcher.sh status
  ```

### ⚠️ Troubleshooting
If the UI ever hangs or becomes a "dead skin" (buttons unclickable, panes frozen), it is usually a sign that the backend router has crashed or the browser is caching an old script path. 
1. Run `./launcher.sh restart`.
2. Hard-refresh your browser (`Ctrl + F5`) to dump the local cache.

---

## Configuration & Persistence

Crucible is highly configurable via the onboard Settings Modal (`⚙️ CONFIG`). All settings, including layout states, are saved securely to your local machine's `localStorage` and synchronized with the backend.

* **Editor Themes:** Chaos (Default), Industrial, Twilight, Tomorrow Night.
* **IDE Controls:** Sticky Word Wrap, Auto-Format on Save (Ace Beautify).
* **Git Environment:** Define Author Name, Author Email, Remote URL, and PAT for seamless backend injection.
* **Spatial Memory:** Grid sizes for the sidebar, terminal, and dual-buffers persist between sessions.

---

## Security & Data Sovereignty

Crucible operates completely offline regarding telemetry, source code, and intellectual property. AI inference is hardcoded to route strictly through your local hardware. **Proprietary logic and developer interactions are never transmitted to external API providers.**```markdown
# Crucible IDE

**A lightweight, AI-driven Integrated Development Environment built for speed, data sovereignty, and rapid iteration.**

Crucible abandons the bloated Chromium dependencies of traditional desktop wrappers (like Electron) in favor of a hybrid architecture. It combines a microscopic **C# Photino** shell with a powerful **Node.js** backend and **Vanilla Web** frontend. The result is an uncompromising, fully local AI workspace with zero latency and zero data leakage.

---

## Core Systems

### 1. Dual-Buffer AI Engine & Differential Merge

Crucible features a twin-editor layout. The primary buffer holds the active workspace, while the secondary output buffer catches local LLM generations.

* **Surgical Guard:** Built-in safeguards automatically reject merge attempts if the incoming AI payload is significantly shorter than the existing file, preventing accidental code gutting.

### 2. Semantic RAG Indexing

The Forge maps your local workspace into a targeted vector array (`vector_index.jsonl`).

* Natively calculates cosine similarity to cross-reference your directives against local files.
* Automatically injects the top 5 most relevant file excerpts directly into the AI's context window.

### 3. Integrated Source Control

A built-in, native Git GUI that doesn't just read status, but actively manages your repository.

* Full support for Git Init, Stage, Commit, Push, Pull, and Branching.
* **Unified Auth Engine:** Securely injects GitHub Personal Access Tokens (PAT) and Remote Origin URLs via the Node.js backend.
* **Conflict Detection:** Intercepts and warns of merge conflicts before they corrupt your workspace.

### 4. Shadow Forge Verification

Never deploy broken AI logic. The `/api/shadow-test` endpoint copies the active file to a secure `/tmp/crucible_shadow` directory and runs strict syntax verification (`node --check`) to ensure structural integrity without executing volatile code in your main workspace.

### 5. Native Telemetry & Live Preview

* **Native Bash PTY:** A fully interactive terminal piped directly to the host machine's shell via WebSockets and `node-pty`.
* **Sandboxed Preview:** An integrated `iframe` viewport for testing frontends. DOM events are intercepted, routing `console.log` and `console.error` outputs directly back to the IDE terminal.

---

## Architecture & Tech Stack

**The Application Shell:** C# Photino (Native Desktop WebView)  
**The Backend Forge:** Node.js (`server.js`)  
**The Frontend:** HTML5, Vanilla JavaScript, CSS3  

**Local Node Dependencies:**

* `node-pty`: Native C/C++ terminal bindings.
* `ws`: WebSocket server for real-time telemetry and indexing streams.

**Remote Dependencies (CDNs):**

* `ace.js` (Cloudflare) for syntax highlighting and IDE action commands.
* `xterm.js` (jsDelivr) for browser-based terminal emulation.

---

## Deployment Procedures

### Prerequisites

1. **Node.js** (v16+ recommended).
2. **C/C++ Build Tools** (Required to compile `node-pty` native bindings on the host OS).
3. **Local AI Server** (e.g., LM Studio, Ollama) running an OpenAI-compatible endpoint on `http://127.0.0.1:1234`.
   * *Required Coder Model:* e.g., `qwen2.5-coder-14b`.
   * *Required Embedding Model:* e.g., `text-embedding-nomic-embed-text-v2-moe`.
4. **.NET SDK** (Required to run the Photino shell).

### ⚙️ Engine Ignition: Using `launcher.sh`

The Crucible IDE relies on a localized daemon manager (`launcher.sh`) to handle process execution, port binding, and background survival. 

#### 1. Initial Setup
Clone the repository, install the dependencies, and ensure the launcher has the correct execution permissions assigned by the OS. 

Run the following commands in your terminal from the project root:
```bash
npm install
chmod +x launcher.sh

```

#### 2. Environment Configuration

`launcher.sh` expects a valid `.env` file in the root directory to feed the Node.js backend. If you do not have one, create it.

At minimum, your `.env` should define your network ports and AI endpoints:

```ini
CRUCIBLE_PORT="3000"
LMS_PORT="1234"
LMS_MODEL="your-local-model-name"
EMBED_MODEL="your-embedding-model-name"

```

#### 3. Command Syntax

The launcher is controlled via standard arguments. Do not run `node server.js` directly unless you are actively debugging core router crashes.

* **Start the System:**
Spins up the Node.js backend, detaches it from the terminal, and binds it to the port specified in your `.env`.
```bash
./launcher.sh start

```


* **Stop the System:**
Locates the active Crucible process ID (PID) and gracefully terminates it, freeing the ports.
```bash
./launcher.sh stop

```


* **Restart / Reload Configuration:**
**Crucial Workflow:** If you manually update the `.env` file or modify the `server.js` routing logic, you must restart the daemon to ingest the new variables.
```bash
./launcher.sh restart

```


* **Check Status:**
Verifies if the Crucible process is currently active in the background and returns its PID.
```bash
./launcher.sh status

```



#### ⚠️ Troubleshooting

If the UI ever hangs or becomes a "dead skin" (buttons unclickable, panes frozen), it is usually a sign that the backend router has crashed or the browser is caching an old script path.

1. Run `./launcher.sh restart`.
2. Hard-refresh your browser (`Ctrl + F5`) to dump the local cache.

---

## Configuration & Persistence

Crucible is highly configurable via the onboard Settings Modal (`⚙️ CONFIG`). All settings, including layout states, are saved securely to your local machine's `localStorage` and synchronized with the backend.

* **Editor Themes:** Chaos (Default), Industrial, Twilight, Tomorrow Night.
* **IDE Controls:** Sticky Word Wrap, Auto-Format on Save (Ace Beautify).
* **Git Environment:** Define Author Name, Author Email, Remote URL, and PAT for seamless backend injection.
* **Spatial Memory:** Grid sizes for the sidebar, terminal, and dual-buffers persist between sessions.

---

## Security & Data Sovereignty

Crucible operates completely offline regarding telemetry, source code, and intellectual property. AI inference is hardcoded to route strictly through your local hardware. **Proprietary logic and developer interactions are never transmitted to external API providers.**

```

```
