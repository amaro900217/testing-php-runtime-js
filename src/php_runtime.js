// php_runtime.js

import { PhpWeb } from "php-wasm/PhpWeb.mjs";

class PhpRuntime {
  constructor() {
    this.config = {};
    this.configDefaults = {
      DEBUG: false,
      NUM_WORKERS: 1,
      TIMEOUT_WORKER: 2000,
      DOCUMENT_ROOT: "/www",
      ENTRY_POINT: "",
      SERVER_ADDR: "127.0.0.1",
      SERVER_NAME: "browser-localhost",
      SERVER_SOFTWARE: "wasm-server-0.0.8",
      SERVER_PORT: "8080",
    };
    this.wasmBuffer = null;
    this.dbs = {};
    this.queue = [];
    this.pendingResponses = new Map();
    this.nextId = 0;
    this.workers = [];
    this.idleWorkers = [];
    this.warmWorker = null;
    this.isInstalled = false;
  }

  async _getDatabaseByName(name) {
    if (this.dbs[name]) return this.dbs[name];
    this.dbs[name] = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("FILE_DATA"))
          db.createObjectStore("FILE_DATA");
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
    return this.dbs[name];
  }

  async _getWasmBufferFromCache() {
    if (this.wasmBuffer) return this.wasmBuffer;
    const db = await this._getDatabaseByName("/wasm");
    const wasmBuffer = await new Promise((resolve) => {
      const tx = db.transaction("FILE_DATA", "readonly");
      const store = tx.objectStore("FILE_DATA");
      const req = store.get("phpWasm");
      req.onsuccess = () => {
        if (req.result) {
          const uint8Array = req.result;
          const buffer = uint8Array.buffer.slice(
            uint8Array.byteOffset,
            uint8Array.byteOffset + uint8Array.byteLength,
          );
          resolve(buffer);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
    if (!wasmBuffer) {
      throw new Error("No WASM buffer in IndexedDB after worker installation.");
    }
    if (this.config.DEBUG) {
      console.log("[Main] WASM loaded from IndexedDB.");
    }
    this.wasmBuffer = wasmBuffer;
    return wasmBuffer;
  }

  _spawnWorkers(num_workers, wasmBuffer, config) {
    for (let i = 0; i < num_workers; i++) {
      const worker = new Worker(new URL("./php_worker.js", import.meta.url), {
        type: "module",
      });
      worker.available = false;
      worker.onmessage = (e) => this._handleWorkerMessage(worker, e);
      this.workers.push(worker);
      worker.postMessage({
        type: "loadWasm",
        wasmBin: wasmBuffer,
        cnfg: config,
      });
    }
  }

  _processQueue() {
    for (const worker of this.workers) {
      if (!worker.available || this.queue.length === 0) {
        continue;
      }
      const task = this.queue.shift();
      worker.available = false;
      worker.postMessage({
        type: task.type,
        id: task.id,
        request: task.request,
      });
    }
  }

  _handleWorkerMessage(worker, e) {
    const { type, id, result, args } = e.data;
    if (type === "load_error") {
      if (this.config.DEBUG) {
        console.error(
          `A worker failed to load and has been removed: ${e.data.error}`,
        );
      }
      const index = this.workers.findIndex((w) => w === worker);
      if (index !== -1) {
        this.workers.splice(index, 1);
      }
      return;
    }
    if (type === "workerReady") {
      worker.available = true;
      this._processQueue();
      return;
    }
    const callback = this.pendingResponses.get(id);
    if (callback) {
      callback(result);
      this.pendingResponses.delete(id);
    }
    worker.available = true;
    this._processQueue();
  }

  async init(config = {}) {
    this.config = { ...this.configDefaults, ...config };
    const db = await this._getDatabaseByName("/setup");
    this.isInstalled = await new Promise((resolve) => {
      const tx = db.transaction("FILE_DATA", "readonly");
      const store = tx.objectStore("FILE_DATA");
      const req = store.get("installed");
      req.onsuccess = () => resolve(req.result === true);
      req.onerror = () => resolve(false);
    });
    if (!this.isInstalled) {
      if (this.config.DEBUG) {
        console.log("[Main] Starting installation worker...");
      }
      const primaryWorker = new Worker(
        new URL("./php_worker.js", import.meta.url),
        { type: "module" },
      );
      await new Promise((resolve, reject) => {
        primaryWorker.onmessage = (e) => {
          if (e.data.type === "installation_finished") {
            if (this.config.DEBUG) {
              console.log("[Main] Installation complete, reusing worker.");
            }
            primaryWorker.available = true;
            primaryWorker.onmessage = (e) =>
              this._handleWorkerMessage(primaryWorker, e);
            this.workers.push(primaryWorker);
            resolve();
          } else if (e.data.type === "error") {
            reject(new Error(`Installation worker error: ${e.data.error}`));
          }
        };
        primaryWorker.postMessage({ type: "install", cnfg: this.config });
      });
    }
    if (this.isInstalled) {
      if (this.config.DEBUG) {
        console.log("[Main] Using stored wasm binary.");
      }
    }
    if (this.config.DEBUG) {
      console.log(
        "[Main] Environment ready, loading WASM and spawning workers...",
      );
    }
    const wasmBin = await this._getWasmBufferFromCache();
    const existingWorkers = this.workers.length;
    const workersToSpawn = this.config.NUM_WORKERS - existingWorkers;
    this._spawnWorkers(workersToSpawn, wasmBin, this.config);
    return this;
  }

  runInline(code, timeout = this.config.TIMEOUT_WORKER) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(
        () => reject(new Error("Worker timeout")),
        timeout,
      );
      this.pendingResponses.set(id, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
      this.queue.push({
        type: "runInline",
        id,
        request: { code },
      });
      this._processQueue();
    });
  }

  runRequest(
    { method, query, payload, headers },
    timeout = this.config.TIMEOUT_WORKER,
  ) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(
        () => reject(new Error("Worker timeout")),
        timeout,
      );
      this.pendingResponses.set(id, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
      this.queue.push({
        type: "runRequest",
        id,
        request: { method, query, payload, headers },
      });
      this._processQueue();
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
    if (!initPromise) throw new Error("runPHP.init() was not called");
    await initPromise;
    return php.runInline(code);
  },
  request: async function (request) {
    if (!initPromise) throw new Error("runPHP.init() was not called");
    await initPromise;
    return php.runRequest(request);
  },
};

window.runPHP = runPHP;
