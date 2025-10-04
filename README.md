-- OLD README (to be fixed) --

# PHP WASM Runtime in the Browser

Run PHP code directly in the browser using WebAssembly (php-wasm). This library provides support for inline code execution and simulates a complete HTTP request cycle, all while being optimized for a non-blocking startup after the first initialization.

## Installation

Your PHP application files should be placed inside a zip archive located at `assets/www/php_api.zip`. This library will automatically unzip, persist in browser and run the files upon requests.

```html
<!-- Load the library -->
<script src="php-runtime.js" type="module"></script>

<!-- Configure the PHP Runtime -->
<script type="module">
  await runPHP.init({
    DEBUG: true,
    NUM_WORKERS: 2
    // ...
  });
</script>
```

## Usage

### Execute Inline PHP Code
```html
<script>
  const result = await runPHP.inline('<?php echo "Hello from PHP!"; ?>');
  console.log(result);
</script>
```

### Make an HTTP-Like Request
```html
<script>
  const result = await runPHP.request({
      method: "GET", // POST
      query: "/www/index.php?user=test", // "/www/api/endpoint"
      payload: "otheruser=theuser&value=123", // ""
      headers: "Content-Type:application/x-www-form-urlencoded;" // ""
  });
  console.log(result);
</script>
```

## Configuration

| Option          | Description                    | Default             |
|-----------------|--------------------------------|---------------------|
| DEBUG           | Enable detailed logging        | `false`             |
| NUM_WORKERS     | Number of concurrent workers   | `2`                 |
| TIMEOUT_WORKER  | Timeout for each worker        | `1000`              |
| DOCUMENT_ROOT   | PHP document root              | `/www`              |
| ENTRY_POINT     | Default PHP script             | `""`                |
| SERVER_ADDR     | Virtual server IP              | `127.0.0.1`         |
| SERVER_NAME     | Server name                    | `browser-localhost` |
| SERVER_PORT     | Server port                    | `8080`              |
| SERVER_SOFTWARE | Server version                 | `wasm-server-0.0.8` |

## Features

- **Server-less PHP Execution:** Run a PHP application in the browser without needing a backend.
- **Non-Blocking Initialization:** The heavy initial setup process runs in a background worker.
- **Concurrent Request Handling:** It can use multiple Web Workers to handle several PHP requests in parallel.
- **Persistent Caching:** Caches the core WASM binary and the entire PHP application filesystem in IndexedDB for faster subsequent page loads.
- **Full HTTP Environment Simulation:** Simulates `$_SERVER`, `$_GET`, `$_POST`, and other PHP superglobals.
- **Securely Sandboxed:** The PHP environment is completely isolated from the host system.

## Workflow

```
[Main Thread: Load Library and Setup Optional Config]
       │
       ▼
[Primary Worker: Install WASM + PHP Project]
       │
       ▼
[Check installation: Check installation and Initialize a Warm up Worker]
       │
       ▼
[Worker Pool: Load WASM, Ready for Requests] ◄─────────────────┐
       │                                                       │
       ├────────────► [runPHP.inline(code)]                    │
       │                      │                                │
       │                      ▼                                │
       │              [Assign Inline Code to Worker]           │
       │                      │                                │
       │                      ▼                                │
       │              [Worker Execution]                       │
       │                      │                                │
       │                      ├─ Run PHP Code in WASM          │
       │                      └─ Capture Output                │
       │                      │                                │
       │                      ▼                                │
       │              *[Return Result to Main Thread]* ───────►│
       ▼                                                       │
[runPHP.request({method, query, payload, headers})]            │
       │                                                       │
       ▼                                                       │
[Request Queue → Assign to Available Worker]                   │
       │                                                       │
       ▼                                                       │
[Worker Execution]                                             │
       │                                                       │
       ├─ Build PHP Environment (Server + GET/POST + Headers)  │
       ├─ Run PHP Code in WASM                                 │
       └─ Capture Output                                       │
       │                                                       │
       ▼                                                       │
*[Return Result to Main Thread]* ──────────────────────────────┘
```

## Special Thanks

This library is built on top of the amazing **php-wasm** project. A special thanks to the creator and maintainers of this essential building block.

- [php-wasm by seanmorris](https://php-wasm.seanmorr.is/)

# 🧩 PhpWeb 0.0.8 — Development Notes

## ✅ TO-DO

### General Tasks
- [ ] Use heavy frameworks for testing.
- [ ] Rewrite HTTP lifecycle parameters — check `php-cgi-wasm` (params, cookies, headers…).
- [ ] Persist **only** the PHP project folder (skip the rest if possible).
  > ⚠️ Might not work, since VFS must remain in memory.
- [ ] Keep an eye on **static vs dynamic env vars** — rewrite dynamic ones per request; keep statics fixed.
- [ ] Still consider **runtime warmups**.
- [ ] **Remove unnecessary logs.**
- [ ] Identify **performance bottlenecks** (workers init, pool creation, etc.).
- [ ] Cut off redundant workflow steps (to improve cold startup):
  - Simplify output capture.
  - Streamline worker initialization.

---

## 💡 Additional Considerations

### 🧠 Overview
**PhpWeb 0.0.8** exposes a simple, high-level **Web API (non-CGI)** interface to execute PHP code directly in WebAssembly environments.

---

## 🔄 Lifecycle API

| Method | Description |
|--------|--------------|
| `new PhpWeb(opts?)` | Constructor |
| `async run(code?, args?)` | Execute PHP string or file (from `opts.arguments`) |
| `async exec(file, args?)` | Run a specific file in VFS |
| `refresh()` | Reboot runtime (keeps VFS if persistent) |

---

## ⚙️ Convenience Wrappers (Sync)

| Method | Description |
|--------|--------------|
| `r(code): string` | One-liner `run()` wrapper |
| `x(file, args?): string` | One-liner `exec()` wrapper |

---

## 📁 File System (Sync — Emscripten FS Façade)

| Method | Description |
|--------|--------------|
| `analyzePath(path)` → `FSNode` | Analyze path |
| `stat(path)` → `Stats` | File stats |
| `readFile(path, opts?)` → `string | Uint8Array` | Read file |
| `writeFile(path, data, opts?)` | Write file |
| `mkdir(path)` | Create directory |
| `unlink(path)` | Delete file |
| `rename(old, new)` | Rename file |
| `readdir(path)` → `string[]` | Read directory |
| `php.fs.*` | Raw FS access (open, close, read, etc.) |

---

## ⚙️ Runtime

| Method | Description |
|--------|--------------|
| `async loadExtension(url)` | Dynamically load a `.so` shared library |
| `addSharedLib(name, url, ini?)` | Register an additional shared library |

---

## 🧱 Static Properties

| Property | Description |
|-----------|--------------|
| `PhpWeb.phpVersion: string` | e.g. `"8.3"` |
| `PhpWeb.module: EmscriptenModule` | Low-level runtime handle |

> **Note:**
> `startTransaction()`, `commitTransaction()`, and `abortTransaction()`
> **do not exist in v0.0.8** — automatic transaction mode is always ON.

---

## ⚙️ Constructor Options (`opts`)

```js
{
  ini: "memory_limit = 512M …",           // php.ini fragment before PHP startup
  prefix: "/mi-app",                      // VFS root (not related to CGI)
  persistent: true,                       // keep VFS in IndexedDB between reloads
  persist: true,                          // alias of 'persistent'
  autoTransaction: false,                 // disable auto-sync; manual commit needed
  extensions: ["intl", "mbstring"],       // preload PHP extensions
  sharedLibs: […],                        // .so or URLs to load
  files: […],                             // extra files to preload into VFS
  wasmBinary: await fetch("…"),           // pre-fetched .wasm binary
  locateFile: s => `/static/${s}`,        // resolve asset URLs
  env: { MI_VARIABLE: "valor" },          // environment vars (for getenv())
  preRun: [() => …],                      // before runtime init
  postRun: [() => …],                     // after runtime end
  print: txt => …,                        // stdout
  printErr: txt => …,                     // stderr
  onAbort: what => …,                     // callback on runtime abort
  arguments: ["-f", "cli.php"],           // PHP CLI args
  initialMemory: 4096,                    // 256 MiB (4096 × 64KiB)
  maximumMemory: 8192,                    // 512 MiB
  ALLOW_MEMORY_GROWTH: true,              // allow heap growth
  noExitRuntime: true,                    // keep runtime alive after run()
  noInitialRun: true,                     // skip automatic main() execution
  stdin: () => prompt("STDIN:"),          // JS handler for STDIN
  stdout: c => outEl.append(c),           // fine-grained stdout
  stderr: c => errEl.append(c),           // fine-grained stderr
  quit: (status, toThrow) => …,           // override Emscripten quit()
  noFSInit: true,                         // skip auto FS mount
  INITIAL_MEMORY: 256*1024*1024,          // byte alias
  MAXIMUM_MEMORY: 512*1024*1024,
  STACK_SIZE: 8*1024*1024,                // 8 MiB stack
  ALLOW_TABLE_GROWTH: true,
  ASSERTIONS: 1,
  STACK_OVERFLOW_CHECK: 1,
  SAFE_HEAP: 1,
  GL_DEBUG: true,
  GL_ASSERTIONS: true,
  fetchSettings: { credentials: "include" },
  instantiateWasm: (imports, okCb) => …,
  monitorRunDependencies: left => …,
  dynamicLibraries: ["a.so", "b.so"],
  wasmMemory: new WebAssembly.Memory({ … }),
  wasmTable: new WebAssembly.Table({ … }),
  wasmModule: compiledModule,
  preinitializedWebGLContext: glCtx,
  webglContextAttributes: { alpha: false }
}

## 🧾 Notes

This version (0.0.8) is Web-only, not CGI-compatible.
Auto-transaction mode ensures file sync without explicit commit calls.
For debugging or testing, enable:
  ASSERTIONS: 1,
  SAFE_HEAP: 1,
  STACK_OVERFLOW_CHECK: 1
