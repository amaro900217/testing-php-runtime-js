// php-runtime.js
import { unzip, gunzipSync } from "./node_modules/fflate/esm/browser.js";
import { PhpWeb } from "./node_modules/php-wasm/PhpWeb.mjs";

class PhpRuntime {
  constructor() {
    this._config = {};
    this._configDefaults = {
      DEBUG: false,
      NUM_WORKERS: 2,
      TIMEOUT_WORKER: 1000,
      DOCUMENT_ROOT: "/www",
      ENTRY_POINT: "",
      SERVER_ADDR: "127.0.0.1",
      SERVER_NAME: "browser-localhost",
      SERVER_SOFTWARE: "wasm-server-0.0.8",
      SERVER_PORT: `8080`,
    };
    this._wasmBuffer = null;
    this._installPromise = null;
    this._wasmBufferPromise = null;
    this._db = null;
    this._queue = [];
    this._nextId = 0;
    this.workers = [];
  }

  log(...args) {
    if (this._config.DEBUG) {
      console.log("[PHP Runtime]", ...args);
    }
  }

  async installWasmBin() {
    if (this._wasmBuffer) return this._wasmBuffer;
    if (!this._wasmBufferPromise) {
      this._wasmBufferPromise = (async () => {
        // --- Reutilizar conexión IndexedDB en memoria ---
        if (!this._db) {
          this._db = await new Promise((resolve, reject) => {
            const request = indexedDB.open("/wasm", 1);
            request.onupgradeneeded = (e) => {
              const db = e.target.result;
              if (!db.objectStoreNames.contains("FILE_DATA"))
                db.createObjectStore("FILE_DATA");
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
          });
        }
        const db = this._db;

        // --- Buscar en IndexedDB ---
        const exists = await new Promise((resolve) => {
          const tx = db.transaction("FILE_DATA", "readonly");
          const store = tx.objectStore("FILE_DATA");
          const req = store.get("phpWasm");
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
        });

        if (exists) {
          this._wasmBuffer = exists;
          this.log("📥 WASM loaded from IndexedDB.");
          return exists;
        }

        // --- Descargar y descomprimir ---
        this.log("⬇️ Downloading WASM...");
        const response = await fetch("/assets/wasm/php-web.js.wasm.gz");
        if (!response.ok)
          throw new Error(`❌ Failed to download WASM: ${response.status}`);

        const compressed = new Uint8Array(await response.arrayBuffer());
        const wasmBuffer = gunzipSync(compressed);
        this._wasmBuffer = wasmBuffer;

        // --- Guardar en IndexedDB ---
        await new Promise((resolve, reject) => {
          const tx = db.transaction("FILE_DATA", "readwrite");
          const store = tx.objectStore("FILE_DATA");
          store.put(wasmBuffer, "phpWasm");
          tx.oncomplete = () => resolve();
          tx.onerror = (e) => reject(e.target.error);
        });

        this.log("💾 WASM saved to IndexedDB.");
        return wasmBuffer;
      })();
    }
    return this._wasmBufferPromise;
  }

  async installPhpFiles(wasmBuffer) {
    let phpWeb = new PhpWeb({
      wasmBinary: wasmBuffer,
      persist: { mountPath: "/www" },
    });
    await phpWeb.ready;
    const phpBin = await phpWeb.binary;
    let alreadyInstalled = false;
    try {
      phpBin.FS.stat("/www/INSTALLED.txt");
      alreadyInstalled = true;
    } catch {}
    if (alreadyInstalled) {
      this.log("✅ PHP project already installed, skipping ZIP installation");
      await new Promise((resolve, reject) => {
        phpBin.FS.syncfs(true, (err) => (err ? reject(err) : resolve()));
      });
      return;
    }
    this.log("⬇️ Downloading php.zip...");
    const response = await fetch("/assets/www/php.zip");
    if (!response.ok)
      throw new Error(`❌ Failed to download php.zip: ${response.statusText}`);
    const zipData = await response.arrayBuffer();
    await new Promise((resolve, reject) => {
      unzip(new Uint8Array(zipData), (err, files) => {
        if (err) return reject(err);
        try {
          for (const relativePath in files) {
            const content = files[relativePath];
            const fullPath = `/www/${relativePath}`;
            const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
            try {
              phpBin.FS.mkdirTree(parentDir);
            } catch {}
            if (content.length === 0 && relativePath.endsWith("/")) {
              try {
                phpBin.FS.mkdir(fullPath);
              } catch {}
            } else {
              const data =
                content instanceof Uint8Array
                  ? content
                  : new Uint8Array(content);
              phpBin.FS.writeFile(fullPath, data);
            }
          }
          phpBin.FS.syncfs(false, (err) => (err ? reject(err) : resolve()));
        } catch (err) {
          reject(err);
        }
      });
    });
    this.log("✅ PHP project installed and synced");
    phpWeb = null;
  }

  async spawnWorkers(num_workers, wasmBuffer, config) {
    for (let i = 0; i < num_workers; i++) {
      const worker = new Worker(new URL("./php-worker.js", import.meta.url), {
        type: "module",
      });
      worker.available = false;
      worker.onmessage = (e) => this.handleWorkerMessage(worker, e);
      this.workers.push(worker);
      worker.postMessage({
        type: "loadWasm",
        wasmBin: wasmBuffer,
        cnfg: config,
      });
    }
  }

  processQueue() {
    for (const worker of this.workers.filter((w) => w.available)) {
      const taskIndex = this._queue.findIndex((t) => !t.assigned);
      if (taskIndex === -1) break;
      const task = this._queue[taskIndex];
      task.assigned = true;
      worker.available = false;
      worker.postMessage({
        type: task.type,
        id: task.id,
        request: task.request,
      });
    }
  }

  handleWorkerMessage(worker, e) {
    const { type, id, result, args } = e.data;
    if (type === "log") {
      if (this._config.DEBUG) {
        console.log("[PHP Worker]", ...args);
      }
      return;
    }
    if (type === "workerReady") {
      worker.available = true;
      this.processQueue();
      return;
    }
    const itemIndex = this._queue.findIndex((q) => q.id === id);
    if (itemIndex !== -1) {
      this._queue.splice(itemIndex, 1)[0].resolve(result);
    }
    worker.available = true;
    this.processQueue();
  }

  async init(config = {}) {
    this._config = { ...this._configDefaults, ...config };
    const wasmBin = await this.installWasmBin();
    await this.installPhpFiles(wasmBin);
    await this.spawnWorkers(this._config.NUM_WORKERS, wasmBin, this._config);
  }

  runInline(code, timeout = this._config.TIMEOUT_WORKER) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      const timer = setTimeout(
        () => reject(new Error("Worker timeout")),
        timeout,
      );
      this._queue.push({
        type: "runInline",
        id,
        request: { code },
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        assigned: false,
      });
      this.processQueue();
    });
  }

  runRequest(
    { method, query, payload, headers },
    timeout = this._config.TIMEOUT_WORKER,
  ) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      const timer = setTimeout(
        () => reject(new Error("Worker timeout")),
        timeout,
      );
      this._queue.push({
        type: "runRequest",
        id,
        request: { method, query, payload, headers },
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        assigned: false,
      });
      this.processQueue();
    });
  }
}

const php = new PhpRuntime();
let initPromise = null;

const runPHP = {
  init: async function (config = {}) {
    initPromise = php.init(config);
    return initPromise;
  },
  inline: async function (code) {
    if (!initPromise) throw new Error("Debes llamar primero a runPHP.init()");
    await initPromise;
    return php.runInline(code);
  },
  request: async function (request) {
    if (!initPromise) throw new Error("Debes llamar primero a runPHP.init()");
    await initPromise;
    return php.runRequest(request);
  },
};

window.runPHP = runPHP;
