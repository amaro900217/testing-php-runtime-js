// php-worker.js
import { PhpWeb } from "./node_modules/php-wasm/PhpWeb.mjs";
import { unzip, gunzipSync } from "./node_modules/fflate/esm/browser.js";

class PhpWorker {
  constructor() {
    this.db = null;
    this.config = {};
    this.phpWeb = null;
    this.wasmBuffer = null;
    this.initialized = false;
    this.log = this.log.bind(this);
    self.onmessage = this.onMessage;
    this.onMessage = this.onMessage.bind(this);
  }

  log(...args) {
    self.postMessage({ type: "log", args });
  }

  async installWasmBin() {
    if (this.wasmBuffer) return this.wasmBuffer;
    if (!this.db) {
      this.db = await new Promise((resolve, reject) => {
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
    const db = this.db;
    const exists = await new Promise((resolve) => {
      const tx = db.transaction("FILE_DATA", "readonly");
      const store = tx.objectStore("FILE_DATA");
      const req = store.get("phpWasm");
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
    if (exists) {
      this.log("📥 [Worker] WASM loaded from IndexedDB.");
      this.wasmBuffer = exists;
      return exists;
    }
    this.log("⬇️ [Worker] Downloading WASM...");
    const compressed = await fetch("/assets/wasm/php-web.js.wasm.gz").then(
      async (res) => {
        if (!res.ok)
          throw new Error(`❌ Failed to download WASM: ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      },
    );
    const wasmBuffer = gunzipSync(compressed);
    this.wasmBuffer = wasmBuffer;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("FILE_DATA", "readwrite");
      const store = tx.objectStore("FILE_DATA");
      store.put(wasmBuffer, "phpWasm");
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
    this.log("💾 [Worker] WASM saved to IndexedDB.");
    return wasmBuffer;
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
      this.log(
        "✅ [Worker] PHP project already installed, skipping ZIP installation",
      );
      await new Promise((resolve, reject) => {
        phpBin.FS.syncfs(true, (err) => (err ? reject(err) : resolve()));
      });
      phpWeb = null;
      return;
    }
    this.log("⬇️ [Worker] Downloading php.zip...");
    const zipData = await fetch("/assets/www/php.zip").then(async (res) => {
      if (!res.ok)
        throw new Error(`❌ Failed to download php.zip: ${res.statusText}`);
      return new Uint8Array(await res.arrayBuffer());
    });
    this.log("📦 [Worker] Unzipping PHP files...");
    const unzippedFiles = await new Promise((resolve, reject) => {
      unzip(zipData, (err, files) => (err ? reject(err) : resolve(files)));
    });
    this.log("📝 [Worker] Writing PHP files to virtual filesystem...");
    for (const relativePath in unzippedFiles) {
      const content = unzippedFiles[relativePath];
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
          content instanceof Uint8Array ? content : new Uint8Array(content);
        phpBin.FS.writeFile(fullPath, data);
      }
    }
    phpBin.FS.writeFile("/www/INSTALLED.txt", "installed");
    await new Promise((resolve, reject) => {
      phpBin.FS.syncfs(false, (err) => (err ? reject(err) : resolve()));
    });
    this.log("✅ [Worker] PHP project installed and synced");
    phpWeb = null;
  }

  async handleInstallation() {
    try {
      this.log("🚀 [Worker] Starting installation...");
      const wasmBuffer = await this.installWasmBin();
      await this.installPhpFiles(wasmBuffer);
      this.log("🎉 [Worker] Installation complete.");
      self.postMessage({ type: "install_complete" });
    } catch (err) {
      self.postMessage({ type: "error", error: err.message });
    }
  }

  buildPhpServerEnv({ method, query, payload, headersStr, config = {} }) {
    this.log("🔧 Building PHP server environment", {
      method,
      query,
      payload,
      headersStr,
    });
    const phpParts = [];
    const headers = this.parseHeaders(headersStr);
    const [requestUri, queryString = ""] = (query ?? "").split("?");
    const contentType =
      headers["Content-Type"] || "application/x-www-form-urlencoded";
    phpParts.push(
      this.buildServerVariables(
        method,
        requestUri,
        queryString,
        contentType,
        payload,
      ),
    );
    phpParts.push(this.buildHeaderVariables(headers));
    phpParts.push(this.buildConfigVariables(config));
    if (method === "GET" && query) {
      phpParts.push(this.buildGetVariables(query));
    }
    if (method === "POST" && payload) {
      phpParts.push(this.buildPostVariables(payload));
    }
    return phpParts.join("");
  }

  parseHeaders(headersStr) {
    const headers = {};
    if (!headersStr) return headers;
    let start = 0;
    const len = headersStr.length;
    for (let i = 0; i <= len; i++) {
      if (i === len || headersStr[i] === ";") {
        let part = headersStr.slice(start, i).trim();
        start = i + 1;
        if (!part) continue;
        const colonIndex = part.indexOf(":");
        if (colonIndex === -1) continue; // ignorar si no hay ":"
        const key = part.slice(0, colonIndex).trim();
        const value = part.slice(colonIndex + 1).trim();
        headers[key] = value;
      }
    }
    return headers;
  }

  buildServerVariables(method, requestUri, queryString, contentType, payload) {
    return `
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['REQUEST_TIME'] = '${Math.floor(Date.now() / 1000)}';
$_SERVER['CONTENT_TYPE'] = '${contentType}';
$_SERVER['CONTENT_LENGTH'] = '${(payload ?? "").length}';
$_SERVER['REQUEST_METHOD'] = '${method}';
$_SERVER['REQUEST_URI'] = '${requestUri}';
$_SERVER['QUERY_STRING'] = '${queryString}';
$_SERVER['SCRIPT_FILENAME'] = '${requestUri}';
`;
  }

  buildHeaderVariables(headers) {
    const phpParts = [];
    for (const key in headers) {
      const keyFormatted = "HTTP_" + key.toUpperCase().replace(/-/g, "_");
      phpParts.push(`$_SERVER['${keyFormatted}'] = '${headers[key]}';\n`);
    }
    return phpParts.join("");
  }

  buildConfigVariables(config) {
    const phpParts = [];
    for (const key in config) {
      const val = config[key];
      if (typeof val === "boolean") {
        phpParts.push(`$_SERVER['${key}'] = ${val ? "true" : "false"};`);
      } else if (typeof val === "number") {
        phpParts.push(`$_SERVER['${key}'] = ${val};`);
      } else {
        // Reemplazo de comillas simples
        const strVal = String(val).replace(/'/g, "'\'");
        phpParts.push(`$_SERVER['${key}'] = '${strVal}';`);
      }
    }
    return phpParts.join("");
  }

  escapePhp(str) {
    return typeof str === "string" ? str.replace(/'/g, "'\'") : str;
  }

  buildGetVariables(query) {
    const phpParts = [];
    const queryString = query.split("?")[1] || "";
    const params = new URLSearchParams(queryString);
    for (const [key, value] of params.entries()) {
      phpParts.push(`$_GET['${key}'] = '${this.escapePhp(value)}';\n`);
    }
    return phpParts.join("");
  }

  buildPostVariables(payload) {
    const phpParts = [];
    const params = new URLSearchParams(payload);
    for (const [key, value] of params.entries()) {
      phpParts.push(`$_POST['${key}'] = '${this.escapePhp(value)}';\n`);
    }
    return phpParts.join("");
  }

  captureOutput() {
    const chunks = [];
    const onOutput = (e) => {
      chunks.push(e.detail);
      this.log("📤 PHP output chunk", e.detail);
    };
    const onError = (e) => {
      chunks.push(e.detail);
      this.log("⚠️ PHP error chunk", e.detail);
    };
    this.phpWeb.addEventListener("output", onOutput);
    this.phpWeb.addEventListener("error", onError);
    return {
      stop: () => {
        this.phpWeb.removeEventListener("output", onOutput);
        this.phpWeb.removeEventListener("error", onError);
      },
      get: () => chunks.join(""),
    };
  }

  async loadWasm(wasmBin, config) {
    if (this.phpWeb) return;
    this.phpWeb = new PhpWeb({
      wasmBinary: wasmBin,
      persist: { mountPath: "/www" },
    });
    await this.phpWeb.ready;
    this.config = { ...config };
    this.initialized = true;
    this.log("✅ PhpWeb WASM loaded and ready");
    self.postMessage({ type: "workerReady" });
  }

  async runInline(id, code) {
    try {
      this.log("▶️ Running inline PHP code");
      await this.phpWeb.refresh();
      const cap = this.captureOutput();
      await this.phpWeb.run(code);
      cap.stop();
      this.log("✅ Inline PHP run completed");
      self.postMessage({ id, result: cap.get() });
    } catch (err) {
      this.log("❌ Error in runInline", err);
      self.postMessage({ id, result: `PHP ERROR: ${err.message}` });
    }
  }

  async runRequest(id, request) {
    try {
      const { method, query, payload, headers } = request;
      this.log("▶️ Running PHP request", { method, query, payload, headers });
      const serverEnv = this.buildPhpServerEnv({
        method,
        query,
        payload,
        headersStr: headers,
        config: this.config,
      });
      const phpCode =
        `<?php ${serverEnv}` + `include_once($_SERVER['SCRIPT_FILENAME']);`;
      this.log("💻 Full PHP code to run:", phpCode);
      await this.phpWeb.refresh();
      const cap = this.captureOutput();
      await this.phpWeb.run(phpCode);
      cap.stop();
      this.log("✅ PHP request completed");
      self.postMessage({ id, result: cap.get() });
    } catch (err) {
      this.log("❌ Error in runRequest", err);
      self.postMessage({ id, result: `PHP ERROR: ${err.message}` });
    }
  }

  async onMessage(e) {
    const { data: msg } = e;
    this.log("📨 [Worker] Received message", msg);
    if (msg.type === "install") {
      await this.handleInstallation();
      return;
    }
    if (msg.type === "loadWasm") {
      await this.loadWasm(msg.wasmBin, msg.cnfg);
      return;
    }
    if (!this.initialized) {
      this.log("⚠️ Worker not initialized yet");
      return;
    }
    const { id, request } = msg;
    if (msg.type === "runInline") {
      await this.runInline(id, request.code);
    } else {
      await this.runRequest(id, request);
    }
  }
}

new PhpWorker();
