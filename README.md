# Crucible IDE

Crucible is a lightweight, AI-driven Integrated Development Environment (IDE) utilizing a hybrid architecture. It
combines a native desktop webview shell with a Node.js backend and local Large Language Model (LLM) inference to create
a unified, AI-assisted workspace.

---

## Development History & Design Philosophy

Crucible emerges from the necessity for an AI-assisted workspace that refuses to compromise system resources or data
sovereignty. Standard web applications lack the required native file system and shell access, while traditional desktop
wrappers (like Electron) introduce unacceptable memory bloat and performance degradation.

The architecture resolves this dichotomy through a C# Photino shell. Photino acts as a microscopic native wrapper,
leveraging the host operating system's existing web rendering engine rather than bundling an entire Chromium instance.
This ensures the application footprint remains exceptionally light while granting the Node.js backend unrestricted
access to local execution environments.

The continuous development of Crucible relies on four operational pillars:

### 1. Lightweight Execution

The system aggressively minimizes local dependencies. The backend relies solely on native Node.js operations and
essential C/C++ bindings (`node-pty`). The frontend deliberately offloads heavy text-rendering engines (Ace Editor) and
terminal emulators (xterm.js) to remote Content Delivery Networks (CDNs), keeping the local installation lean and fast.

### 2. High-Performance Iteration

By utilizing a twin-editor differential buffer, the system handles extensive AI code generation without freezing or
cluttering the primary workspace UI. The semantic vector indexing (RAG) performs rapid cosine similarity calculations
directly in memory, injecting context into the AI prompt instantly.

### 3. Absolute Data Sovereignty

The environment operates completely offline regarding telemetry, source code, and intellectual property. AI inference
routes strictly through local hardware endpoints (targeting `127.0.0.1:1234`). Proprietary logic and developer
interactions never transmit to external API providers.

### 4. Structural Security

Autonomous code generation inherently introduces risk. Crucible mitigates this through isolated execution via the Shadow
Forge protocol. The system duplicates incoming logic to a quarantined `/tmp` directory, running strict Node.js syntax
checks to verify structural integrity before authorizing a merge into the primary buffer.

---

## Core Systems

### Dual-Buffer Differential Merge

Crucible employs a twin-editor layout. The primary buffer holds the active file, while the secondary output buffer
captures AI-generated logic. Built-in surgical guards prevent catastrophic code loss by automatically rejecting merge
attempts if the incoming AI payload is significantly shorter than the existing file.

### Semantic RAG Indexing

The system scans the local working directory and generates a `vector_index.jsonl` database. When directives are sent to
the AI, the backend automatically extracts and injects the top five most relevant file excerpts directly into the prompt
context, allowing the local LLM to "see" the surrounding project files.

### Integrated Source Control

A built-in GUI wrapper manages local Git operations. It tracks staged, unstaged, and untracked files in real-time,
executing commits and push/pull operations via the Node.js backend. It natively supports GitHub Personal Access Token (
PAT) injection for remote authentication over HTTPS.

### Native Telemetry & Live Preview

* **Bash Terminal:** A fully interactive terminal piped directly to the host machine's shell via WebSockets and
  `node-pty`.
* **Sandboxed Preview:** An embedded `iframe` provides a viewport for testing HTML/JS/CSS frontends. An interceptor
  script captures DOM events and routes `console.log` and `console.error` outputs directly back to the IDE's main
  terminal.

---

## Technical Stack

**The Application Shell:** C# Photino
**The Backend Forge:** Node.js (`server.js`)
**Frontend UI:** HTML5, Vanilla JavaScript, CSS3

**Local Dependencies:**

* `node-pty`: Native C/C++ terminal bindings.
* `ws`: WebSocket server for real-time telemetry.

**Remote Dependencies (CDNs):**

* `ace.js` (Cloudflare CDN)
* `xterm.js` / `xterm-addon-fit.js` (jsDelivr CDN)

---

## Deployment Procedures

### Prerequisites

1. **Node.js** (v16+ recommended).
2. **Local AI Server** (e.g., LM Studio, Ollama) running an OpenAI-compatible server on `http://127.0.0.1:1234`.

* *Required Models:* A chat model (e.g., `qwen2.5-coder-14b`) and an embedding model (
  `text-embedding-nomic-embed-text-v2-moe`).


3. **C/C++ Build Tools** (Required for compiling `node-pty` native bindings on the host OS).

### Initialization

1. Clone the repository to the local machine.
2. Install the required Node modules:

```bash
npm install

```

3. Ignite the backend server:

```bash
node server.js

```

4. Launch the Photino shell:

```bash
dotnet run

```
