// php_worker.js

import { PhpWeb } from "php-wasm/PhpWeb.mjs";
import { unzipSync } from "fflate";

class PhpWorker {
  constructor() {
    // OJO REVISAR->>
    this.db = null;
    this.config = {};
    this.phpWeb = null;
    this.wasmBuffer = null;
    this.initialized = false;
    this.onMessage = this.onMessage.bind(this);
    self.onmessage = this.onMessage;
  }

  async _connectToIndexedDB(databaseName, storeName) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      request.onsuccess = (event) => {
        resolve(event.target.result);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  async _getItemFromIndexedDB(databaseConn, storeName, key) {
    if (!databaseConn) {
      throw new Error("Invalid or closed database connection.");
    }
    return new Promise((resolve, reject) => {
      const transaction = databaseConn.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("Database request blocked."));
    });
  }

  async _storeSingleItemToIndexedDB(db, storeName, key, datData) {
    if (!db) {
      throw new Error("Invalid or closed database connection.");
    }
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.put(datData, key);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      request.onerror = () => reject(request.error);
    });
  }

  async _storeItemsToIndexedDB(db, storeName, entries) {
    if (!db) {
      throw new Error("Invalid or closed database connection.");
    }
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      let successCount = 0;
      transaction.oncomplete = () => resolve(successCount);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      const requests = [];
      entries.forEach(({ key, value }) => {
        const request = store.put(value, key);
        request.onsuccess = () => {
          successCount++;
        };
        request.onerror = () => reject(request.error);
        requests.push(request);
      });
    });
  }

  async _installWasmBin() {
    if (this.wasmBuffer) return this.wasmBuffer;
    if (!this.db) {
      this.db = await this._connectToIndexedDB("/wasm", "FILE_DATA");
    }
    const db = this.db;
    const blob = await this._getItemFromIndexedDB(db, "FILE_DATA", "phpWasm");
    if (blob) {
      console.log("📥 [Worker] WASM loaded from IndexedDB.");
      // blob is actually a Uint8Array stored in IndexedDB
      const uint8Array = blob;
      const buffer = uint8Array.buffer.slice(
        uint8Array.byteOffset,
        uint8Array.byteOffset + uint8Array.byteLength,
      );
      console.log(`📦 WASM buffer from IndexedDB: ${buffer.byteLength} bytes`);
      this.wasmBuffer = buffer;
      return buffer;
    }
    console.log("⬇️ [Worker] Downloading WASM...");
    const res = await fetch("/assets/wasm/php-web.js.zip");
    if (!res.ok) throw new Error(`❌ Failed to download WASM: ${res.status}`);
    const compressed = new Uint8Array(await res.arrayBuffer());
    const unzipped = unzipSync(compressed);

    // Find the WASM file in the unzipped archive
    const wasmFileName = Object.keys(unzipped).find((name) =>
      name.endsWith(".wasm"),
    );
    if (!wasmFileName) {
      throw new Error("❌ No WASM file found in the ZIP archive");
    }

    const wasmUint8Array = unzipped[wasmFileName];
    console.log(
      `📦 Extracted WASM file: ${wasmFileName} (${wasmUint8Array.length} bytes)`,
    );

    // Convert Uint8Array to ArrayBuffer
    const wasmBuffer = wasmUint8Array.buffer.slice(
      wasmUint8Array.byteOffset,
      wasmUint8Array.byteOffset + wasmUint8Array.byteLength,
    );
    console.log(`🔧 Converted to ArrayBuffer: ${wasmBuffer.byteLength} bytes`);

    this.wasmBuffer = wasmBuffer;
    this._storeSingleItemToIndexedDB(db, "FILE_DATA", "phpWasm", wasmUint8Array)
      .then(() => console.log("💾 [Worker] WASM saved to IndexedDB."))
      .catch((err) => console.error("⚠️ [Worker] Failed to save WASM:", err));
    return wasmBuffer;
  }

  async _markPhpInstalled() {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("/setup", 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("FILE_DATA")) {
          db.createObjectStore("FILE_DATA");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("FILE_DATA", "readwrite");
      const store = tx.objectStore("FILE_DATA");
      store.put(true, "installed");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async _isPhpInstalled() {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("/setup", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const installed = await new Promise((resolve, reject) => {
      const tx = db.transaction("FILE_DATA", "readonly");
      const store = tx.objectStore("FILE_DATA");
      const req = store.get("installed");
      req.onsuccess = () => resolve(req.result === true);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return installed;
  }

  async _installPhpFiles(
    wasmBuffer,
    config = {},
    datUrl = "/assets/www/php.dat.zip",
  ) {
    if (!this.phpWeb) {
      await this._loadPhpWasm(wasmBuffer, config);
      await this.phpWeb.ready;
    }
    const phpBin = await this.phpWeb.binary;
    const alreadyInstalled = await this._isPhpInstalled();
    if (alreadyInstalled) {
      console.log(
        "✅ [Worker] PHP project already installed, skipping installation",
      );
      return;
    }
    console.log("⬇️ [Worker] Downloading project data from php.dat.zip...");
    const response = await fetch(datUrl);
    if (!response.ok)
      throw new Error(
        `❌ Failed to download php.dat.zip file: ${response.statusText}`,
      );
    console.log("🗜️ Decompressing php.dat.zip file...");
    const compressedData = new Uint8Array(await response.arrayBuffer());
    const unzipped = unzipSync(compressedData);

    let filesInstalled = 0;
    for (const fileName in unzipped) {
      console.log(`📄 Installing: ${fileName}`);
      const content = unzipped[fileName];
      const fullPath = `/www/${fileName}`;
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));

      try {
        phpBin.FS.mkdirTree(parentDir);
      } catch (e) {
        // Directory might already exist, that's ok
      }

      if (content.length === 0 && fileName.endsWith("/")) {
        try {
          phpBin.FS.mkdir(fullPath);
        } catch (e) {
          // Directory might already exist, that's ok
        }
      } else {
        try {
          phpBin.FS.writeFile(fullPath, content);
          filesInstalled++;
        } catch (writeError) {
          console.error(`❌ Failed to write file ${fileName}:`, writeError);
        }
      }
    }
    console.log(`📊 Installed ${filesInstalled} files to VFS`);
    console.log("💾 Syncing filesystem to IndexedDB...");
    await phpBin.FS.syncfs();
    console.log("✅ Filesystem synced to IndexedDB");
    console.log("✅ [Worker] PHP project installed to VFS");
  }

  async _handleInstallation(config = {}) {
    try {
      console.log("🚀 [Worker] Starting installation...");
      const wasmBuffer = await this._installWasmBin();
      await this._installPhpFiles(wasmBuffer, config);
      await this._markPhpInstalled();
      console.log("🎉 [Worker] Installation complete.");
      self.postMessage({ type: "install_complete" });
    } catch (err) {
      console.error("❌ Installation failed:", err);
      self.postMessage({ type: "error", error: err.message });
    }
  }

  _stringEscape(str) {
    return String(str)
      .replace(/\\/g, "\\\\") // barra invertida
      .replace(/'/g, "\\'") // comillas simples
      .replace(/\r?\n/g, "\\n"); // saltos de línea
  }

  _buildHeaderVariables(headers) {
    const headerParts = [];
    for (const key in headers) {
      const keyFormatted = "HTTP_" + key.toUpperCase().replace(/-/g, "_");
      const escapedValue = this._stringEscape(headers[key]);
      headerParts.push(`$_SERVER['${keyFormatted}'] = '${escapedValue}';\n`);
    }
    return headerParts.join("");
  }

  _buildConfigVariables(config) {
    const headerParts = [];
    for (const key in config) {
      const val = config[key];
      if (typeof val === "boolean") {
        headerParts.push(`$_SERVER['${key}'] = ${val ? "true" : "false"};`);
      } else if (typeof val === "number") {
        headerParts.push(`$_SERVER['${key}'] = ${val};`);
      } else {
        const strVal = this._stringEscape(val);
        headerParts.push(`$_SERVER['${key}'] = '${strVal}';`);
      }
    }
    return headerParts.join("");
  }

  _buildGetVariables(query) {
    const queryParts = [];
    const params = new URLSearchParams(query);
    for (const [key, value] of params.entries()) {
      const escapedKey = this._stringEscape(key);
      const escapedValue = this._stringEscape(value);
      queryParts.push(`$_GET['${escapedKey}'] = '${escapedValue}';`);
    }
    return queryParts.join("");
  }

  _buildPostVariables(payload) {
    const payloadParts = [];
    const params = new URLSearchParams(payload);
    for (const [key, value] of params.entries()) {
      const escapedKey = this._stringEscape(key);
      const escapedValue = this._stringEscape(value);
      payloadParts.push(`$_POST['${escapedKey}'] = '${escapedValue}';`);
    }
    return payloadParts.join("");
  }

  _parseHeaders(headersStr) {
    const headers = {};
    if (!headersStr) return headers;
    const parts = headersStr.split(/;|\r?\n/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const colonIndex = trimmed.indexOf(":");
      if (colonIndex === -1) continue;
      const key = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();
      headers[key] = value;
    }

    return headers;
  }

  _buildPhpServerEnv({ method, query, payload, headersStr, config = {} }) {
    const headerParts = [];
    const headers = this._parseHeaders(headersStr);
    let [requestUri, queryString = ""] = (query ?? "").split("?");
    const entryPoint = config.ENTRY_POINT || null;
    let scriptFilename, scriptName, phpSelf, pathInfo;
    if (entryPoint) {
      scriptFilename = entryPoint;
      const docRoot = config.DOCUMENT_ROOT || "/www";
      scriptName = "/" + entryPoint.replace(new RegExp(`^${docRoot}/?`), "");
      phpSelf = scriptName;
      pathInfo = requestUri;
    } else {
      scriptFilename = requestUri;
      const docRoot = config.DOCUMENT_ROOT || "/www";
      scriptName = "/" + requestUri.replace(new RegExp(`^${docRoot}/?`), "");
      phpSelf = scriptName;
      pathInfo = null;
    }
    const contentType =
      headers["Content-Type"] || "application/x-www-form-urlencoded";
    headerParts.push(`
      $_SERVER['REMOTE_ADDR']     = '127.0.0.1';
      $_SERVER['CONTENT_TYPE']    = '${this._stringEscape(contentType)}';
      $_SERVER['CONTENT_LENGTH']  = '${(payload ?? "").length}';
      $_SERVER['REQUEST_METHOD']  = '${this._stringEscape(method)}';
      $_SERVER['REQUEST_URI']     = '${this._stringEscape(requestUri)}';
      $_SERVER['QUERY_STRING']    = '${this._stringEscape(queryString)}';
      $_SERVER['SCRIPT_FILENAME'] = '${this._stringEscape(scriptFilename)}';
      $_SERVER['SCRIPT_NAME']     = '${this._stringEscape(scriptName)}';
      $_SERVER['PHP_SELF']        = '${this._stringEscape(phpSelf)}';
      ${pathInfo ? `$_SERVER['PATH_INFO'] = '${this._stringEscape(pathInfo)}';` : ""}
    `);
    headerParts.push(this._buildHeaderVariables(headers));
    headerParts.push(this._buildConfigVariables(config));
    if (method === "GET") {
      headerParts.push(this._buildGetVariables(queryString));
    } else if (method === "POST") {
      headerParts.push(this._buildPostVariables(payload));
    } else {
      headerParts.push(
        `trigger_error("Unsupported HTTP method: ${this._stringEscape(method)}", E_USER_ERROR);`,
      );
    }
    return headerParts.join("");
  }

  _captureOutput() {
    const chunks = [];
    const onOutput = (e) => {
      chunks.push(e.detail);
      console.log("📤 PHP output chunk", e.detail);
    };
    const onError = (e) => {
      chunks.push(e.detail);
      console.log("⚠️ PHP error chunk", e.detail);
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

  async _loadPhpWasm(wasmBin, config = {}) {
    if (this.phpWeb) return;

    // Validate WASM buffer
    if (!wasmBin || wasmBin.byteLength === 0) {
      throw new Error("❌ Invalid WASM buffer: empty or null");
    }

    // Ensure it's actually an ArrayBuffer
    if (!(wasmBin instanceof ArrayBuffer)) {
      console.error(
        "❌ WASM buffer is not an ArrayBuffer:",
        typeof wasmBin,
        wasmBin.constructor.name,
      );
      throw new Error("❌ WASM buffer must be an ArrayBuffer");
    }

    console.log(
      `🔧 Initializing PhpWeb with WASM buffer: ${wasmBin.byteLength} bytes`,
    );

    this.phpWeb = new PhpWeb({
      wasmBinary: wasmBin,
      persist: { mountPath: "/www" },
    });
    await this.phpWeb.ready;

    if (config) {
      this.config = { ...config };
      this.initialized = true;
      console.log("✅ PhpWeb WASM loaded and ready");
      self.postMessage({ type: "workerReady" });
    }
  }

  async _runInline(id, code) {
    try {
      console.log("▶️ Running inline PHP code");
      await this.phpWeb.refresh();
      const cap = this._captureOutput();
      await this.phpWeb.run(code);
      cap.stop();
      console.log("✅ Inline PHP run completed");
      self.postMessage({ id, result: cap.get() });
    } catch (err) {
      console.log("❌ Error in runInline", err);
      self.postMessage({ id, result: `PHP ERROR: ${err.message}` });
    }
  }

  async _runRequest(id, request) {
    try {
      const { method, query, payload, headers } = request;
      console.log("▶️ Running PHP request", {
        method,
        query,
        payload,
        headers,
      });
      const serverEnv = this._buildPhpServerEnv({
        method,
        query,
        payload,
        headersStr: headers,
        config: this.config,
      });
      const phpCode =
        `<?php ${serverEnv}` + `include_once($_SERVER['SCRIPT_FILENAME']);`;
      console.log("💻 Full PHP code to run:", phpCode);
      await this.phpWeb.refresh();
      const cap = this._captureOutput();
      await this.phpWeb.run(phpCode);
      cap.stop();
      console.log("✅ PHP request completed");
      self.postMessage({ id, result: cap.get() });
    } catch (err) {
      console.log("❌ Error in runRequest", err);
      self.postMessage({ id, result: `PHP ERROR: ${err.message}` });
    }
  }

  async onMessage(e) {
    const { data: msg } = e;
    console.log("📨 [Worker] Received message", msg);
    if (msg.type === "install") {
      await this._handleInstallation(msg.cnfg);
      return;
    }
    if (msg.type === "loadWasm") {
      await this._loadPhpWasm(msg.wasmBin, msg.cnfg);
      return;
    }
    if (!this.initialized) {
      console.log("⚠️ Worker not initialized yet");
      return;
    }
    const { id, request } = msg;
    if (msg.type === "runInline") {
      await this._runInline(id, request.code);
    } else {
      await this._runRequest(id, request);
    }
  }
}

new PhpWorker();
