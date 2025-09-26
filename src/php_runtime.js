// php_runtime.js

import { PhpWeb } from "php-wasm/PhpWeb.mjs";

class PhpRuntime {
  constructor() {
    this.config = {};
    this.configDefaults = {
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
    this.wasmBuffer = null;
    this.dbs = {};
    this.queue = [];
    this.nextId = 0;
    this.workers = [];
    this.warmWorker = null;
    this.warmed = false;
  }

  async getDb(name) {
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

  async getWasmBufferFromCache() {
    if (this.wasmBuffer) return this.wasmBuffer;
    const db = await this.getDb("/wasm");
    const wasmBuffer = await new Promise((resolve) => {
      const tx = db.transaction("FILE_DATA", "readonly");
      const store = tx.objectStore("FILE_DATA");
      const req = store.get("phpWasm");
      req.onsuccess = () => {
        if (req.result) {
          // req.result is a Uint8Array stored in IndexedDB
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
    if (!wasmBuffer)
      throw new Error("No WASM buffer in IndexedDB after worker installation.");
    console.log("📥 [Main] WASM loaded from IndexedDB.");
    this.wasmBuffer = wasmBuffer;
    return wasmBuffer;
  }

  async init(config = {}) {
    this.config = { ...this.configDefaults, ...config };
    const db = await this.getDb("/setup");
    this.warmed = await new Promise((resolve) => {
      const tx = db.transaction("FILE_DATA", "readonly");
      const store = tx.objectStore("FILE_DATA");
      const req = store.get("installed");
      req.onsuccess = () => resolve(req.result === true);
      req.onerror = () => resolve(false);
    });

    if (this.warmed) {
      console.log("🔥 [Main] Using warmed worker.");
      const wasmBin = await this.getWasmBufferFromCache();
      this.spawnWorkers(this.config.NUM_WORKERS, wasmBin, this.config);
    } else {
      console.log("🚀 [Main] Starting installation worker...");
      const primaryWorker = new Worker(
        new URL("./php_worker.js", import.meta.url),
        { type: "module" },
      );
      await new Promise((resolve, reject) => {
        primaryWorker.onmessage = (e) => {
          if (e.data.type === "install_complete") {
            console.log("🎉 [Main] Installation complete, reusing worker.");
            // Setup the installation worker as a regular worker
            primaryWorker.available = true;
            primaryWorker.onmessage = (e) =>
              this.handleWorkerMessage(primaryWorker, e);
            this.workers.push(primaryWorker);
            resolve();
          } else if (e.data.type === "error") {
            reject(new Error(`Installation worker error: ${e.data.error}`));
          } else if (e.data.type === "log" && this.config.DEBUG) {
            console.log(...e.data.args);
          }
        };
        primaryWorker.postMessage({ type: "install", cnfg: this.config });
      });
      // Wait a bit for filesystem sync to complete, then spawn remaining workers
      const wasmBin = await this.getWasmBufferFromCache();

      // Give time for filesystem sync to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (this.config.NUM_WORKERS > 1) {
        this.spawnWorkers(this.config.NUM_WORKERS - 1, wasmBin, this.config);
      }
    }
  }

  warmupWorker(wasmBuffer, config) {
    console.log("🔥 [Main] Warming up a worker for next time...");
    this.warmWorker = new Worker(new URL("./php_worker.js", import.meta.url), {
      type: "module",
    });
    this.warmWorker.onmessage = async (e) => {
      if (e.data.type === "workerReady") {
        const db = await this.getDb("/setup");
        await new Promise((resolve, reject) => {
          const tx = db.transaction("FILE_DATA", "readwrite");
          const store = tx.objectStore("FILE_DATA");
          store.put(true, "installed");
          tx.oncomplete = () => resolve();
          tx.onerror = (evt) => reject(evt.target.error);
        });
        console.log("🔥 [Main] Worker is warm.");
      } else if (e.data.type === "log" && this.config.DEBUG) {
        console.log("[PHP Warmup Worker]", ...e.data.args);
      }
    };
    this.warmWorker.postMessage({
      type: "loadWasm",
      wasmBin: wasmBuffer,
      cnfg: config,
    });
  }

  spawnWorkers(num_workers, wasmBuffer, config) {
    for (let i = 0; i < num_workers; i++) {
      const worker = new Worker(new URL("./php_worker.js", import.meta.url), {
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
    for (const worker of this.workers) {
      if (!worker.available) continue;
      let taskIndex = this.queue.findIndex((q) => !q.assigned);
      if (taskIndex === -1) break;
      const task = this.queue[taskIndex];
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
      if (this.config.DEBUG) console.log("[PHP Worker]", ...args);
      return;
    }
    if (type === "workerReady") {
      worker.available = true;
      this.processQueue();
      return;
    }

    const itemIndex = this.queue.findIndex((q) => q.id === id);
    if (itemIndex !== -1) this.queue.splice(itemIndex, 1)[0].resolve(result);

    worker.available = true;
    this.processQueue();
  }

  runInline(code, timeout = this.config.TIMEOUT_WORKER) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(
        () => reject(new Error("Worker timeout")),
        timeout,
      );
      this.queue.push({
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
    timeout = this.config.TIMEOUT_WORKER,
  ) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(
        () => reject(new Error("Worker timeout")),
        timeout,
      );
      this.queue.push({
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
