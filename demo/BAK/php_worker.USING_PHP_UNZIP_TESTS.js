// php_worker.js

// CHECK, ALMOST 1 SECOND FASTER DOWNLOAD->UNZIP->SYCN ALL PHP PROJECT

import { PhpWeb } from "php-wasm/PhpWeb.mjs";
import { unzipSync } from "fflate";

class PhpWorker {
  constructor() {
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
    if (this.config.DEBUG) {
      console.log("[Worker] Retrieving WASM binary...");
    }
    if (this.wasmBuffer) return this.wasmBuffer;
    if (!this.db) {
      this.db = await this._connectToIndexedDB("/wasm", "FILE_DATA");
    }
    const db = this.db;
    const blob = await this._getItemFromIndexedDB(db, "FILE_DATA", "phpWasm");
    if (blob) {
      const uint8Array = blob;
      const buffer = uint8Array.buffer.slice(
        uint8Array.byteOffset,
        uint8Array.byteOffset + uint8Array.byteLength,
      );
      this.wasmBuffer = buffer;
      return buffer;
    }
    const res = await fetch("/assets/wasm/php-web.js.zip");
    if (!res.ok) throw new Error(`❌ Failed to download WASM: ${res.status}`);
    const compressed = new Uint8Array(await res.arrayBuffer());
    const unzipped = unzipSync(compressed);
    const wasmFileName = Object.keys(unzipped).find((name) =>
      name.endsWith(".wasm"),
    );
    if (!wasmFileName) {
      throw new Error("❌ No WASM file found in the ZIP archive");
    }
    const wasmUint8Array = unzipped[wasmFileName];
    const wasmBuffer = wasmUint8Array.buffer.slice(
      wasmUint8Array.byteOffset,
      wasmUint8Array.byteOffset + wasmUint8Array.byteLength,
    );
    this.wasmBuffer = wasmBuffer;
    this._storeSingleItemToIndexedDB(db, "FILE_DATA", "phpWasm", wasmUint8Array)
      .then(() => {
        if (this.config.DEBUG) console.log("[Worker] WASM saved to IndexedDB.");
      })
      .catch((err) => {
        if (this.config.DEBUG)
          console.error("[Worker] Failed to save WASM:", err);
      });
    return wasmBuffer;
  }

  async _markPhpInstalled() {
    if (this.config.DEBUG) {
      console.log("[Worker] Marking local installation as true...");
    }
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
  datUrl = "/assets/www/php_api.zip"
) {
  // 1️⃣ Cargar PhpWeb con persistencia desde el inicio
  if (!this.phpWeb) {
    this.phpWeb = new PhpWeb({
      wasmBinary: wasmBuffer,
      persist: { mountPath: "/www" }, // IDBFS desde el inicio
    });
    await this.phpWeb.ready; // ✅ importante esperar
    if (config) this.config = { ...config };
  }

  const phpBin = await this.phpWeb.binary;

  // 2️⃣ Verificar si ya está instalado
  const alreadyInstalled = await this._isPhpInstalled();
  if (alreadyInstalled) return;

  // 3️⃣ Descargar ZIP
  const response = await fetch(datUrl);
  if (!response.ok) throw new Error(
    `❌ Failed to download php_api.zip file: ${response.statusText}`
  );
  const compressedData = new Uint8Array(await response.arrayBuffer());

  // 4️⃣ Crear directorios
  phpBin.FS.mkdirTree("/www");
  //phpBin.FS.mkdirTree("/tmp"); // por si ZipArchive lo necesita

  // 5️⃣ Escribir ZIP en FS persistente
  phpBin.FS.writeFile("/www/php_api.zip", compressedData);

  // 6️⃣ Sync FS antes de usar ZipArchive
  await new Promise((resolve, reject) => {
    phpBin.FS.syncfs(false, (err) => err ? reject(err) : resolve());
  });

  // 7️⃣ PHP inline para descomprimir con debug
  const unzipInline = `
<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

$zipPath = "/www/php_api.zip";
$targetDir = "/www";

echo "Archivo ZIP existe? " . (file_exists($zipPath) ? "✅ Sí" : "❌ No") . "\n";
echo "Tamaño del ZIP: " . (file_exists($zipPath) ? filesize($zipPath) : 0) . " bytes\n";

$handle = fopen($zipPath, "rb");
if ($handle !== false) {
    $firstBytes = bin2hex(fread($handle, 4));
    fclose($handle);
    echo "Primeros 4 bytes del ZIP: $firstBytes\n";
} else {
    echo "❌ No se pudo abrir el ZIP para leer bytes\n";
}

if (!is_dir($targetDir)) mkdir($targetDir, 0777, true);

$zip = new ZipArchive;

$startTime = microtime(true); // ⏱ inicio de la medición
$res = $zip->open($zipPath);

if ($res === TRUE) {
    $zip->extractTo($targetDir);
    $zip->close();
    $endTime = microtime(true); // ⏱ fin de la medición
    $elapsed = $endTime - $startTime;
    echo "✅ PHP: Descompresión completada\n";
    echo "⏱ Tiempo de descompresión: " . round($elapsed, 3) . " segundos\n";
} else {
    echo "❌ PHP: Error al abrir ZIP (Código: $res)\n";
}
?>

  `;

  // 8️⃣ Captura output y errores
  const cap = [];
  const onOut = (e) => cap.push(e.detail);
  const onErr = (e) => cap.push(e.detail);
  this.phpWeb.addEventListener("output", onOut);
  this.phpWeb.addEventListener("error", onErr);

  await this.phpWeb.run(unzipInline);

  this.phpWeb.removeEventListener("output", onOut);
  this.phpWeb.removeEventListener("error", onErr);

  console.log(cap.join(""));

  // 9️⃣ Marcar instalación como completada
  await this._markPhpInstalled();
  this.initialized = true; 

  if (this.config.DEBUG) {
    console.log("[Worker] ✅ PHP project extracted inside WASM FS");
  }
}

  async _handleInstallation(config = {}) {
    try {
      const wasmBuffer = await this._installWasmBin();
      await this._installPhpFiles(wasmBuffer, config);
      await this._markPhpInstalled();
      self.postMessage({ type: "installation_finished" });
    } catch (err) {
      if (this.config.DEBUG) {
        console.error("[Worker] ❌ Installation failed:", err);
      }
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
    };
    const onError = (e) => {
      chunks.push(e.detail);
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
    if (!wasmBin || wasmBin.byteLength === 0) {
      throw new Error("❌ Invalid WASM buffer: empty or null");
    }
    if (!(wasmBin instanceof ArrayBuffer)) {
      console.error(
        "[Worker] ❌ WASM buffer is not an ArrayBuffer:",
        typeof wasmBin,
        wasmBin.constructor.name,
      );
      throw new Error("❌ WASM buffer must be an ArrayBuffer");
    }
    this.phpWeb = new PhpWeb({
      wasmBinary: wasmBin,
      persist: { mountPath: "/www" },
    });
    await this.phpWeb.ready;
    if (config) {
      this.config = { ...config };
      this.initialized = true;
      if (this.config.DEBUG) {
        console.log("[Worker] PhpWeb WASM loaded and ready");
      }
      self.postMessage({ type: "workerReady" });
    }
  }

  async _runInline(id, code) {
    try {
      await this.phpWeb.refresh();
      const cap = this._captureOutput();
      await this.phpWeb.run(code);
      cap.stop();
      if (this.config.DEBUG) {
        console.log("[Worker] Inline PHP run completed");
      }
      self.postMessage({ id, result: cap.get() });
    } catch (err) {
      if (this.config.DEBUG) {
        console.log("[Worker] ❌ Error in runInline", err);
      }
      self.postMessage({ id, result: `PHP ERROR: ${err.message}` });
    }
  }

  async _runRequest(id, request) {
    try {
      const { method, query, payload, headers } = request;
      const serverEnv = this._buildPhpServerEnv({
        method,
        query,
        payload,
        headersStr: headers,
        config: this.config,
      });
      const phpCode =
        `<?php ${serverEnv}` + `include_once($_SERVER['SCRIPT_FILENAME']);`;
      if (this.config.DEBUG) {
        console.log("[Worker] PHP code to run:", phpCode);
      }
      await this.phpWeb.refresh();
      const cap = this._captureOutput();
      await this.phpWeb.run(phpCode);
      cap.stop();
      self.postMessage({ id, result: cap.get() });
    } catch (err) {
      if (this.config.DEBUG) {
        console.log("[Worker] ❌ Error in runRequest", err);
      }
      self.postMessage({ id, result: `PHP ERROR: ${err.message}` });
    }
  }

  async onMessage(e) {
    const { data: msg } = e;
    if (this.config.DEBUG) {
      console.log("[Worker] Received message", msg);
    }
    if (msg.type === "install") {
      await this._handleInstallation(msg.cnfg);
      return;
    }
    if (msg.type === "loadWasm") {
      try {
        await this._loadPhpWasm(msg.wasmBin, msg.cnfg);
      } catch (err) {
        self.postMessage({ type: "load_error", error: err.message });
      }
      return;
    }
    if (!this.initialized) {
      if (this.config.DEBUG) {
        console.log("[Worker] Worker not initialized yet");
      }
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
