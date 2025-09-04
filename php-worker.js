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
    this.onMessage = this.onMessage.bind(this);
    self.onmessage = this.onMessage;
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
      await new Promise((resolve, reject) => {
        phpBin.FS.syncfs(true, (err) => (err ? reject(err) : resolve()));
      });
      phpBin.FS.stat("/www/php/INSTALLED.txt");
      alreadyInstalled = true;
    } catch {}

    if (alreadyInstalled) {
      this.log(
        "✅ [Worker] PHP project already installed, skipping ZIP installation",
      );
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
    const writePromises = Object.entries(unzippedFiles).map(
      ([relativePath, content]) => {
        return new Promise((resolve) => {
          const fullPath = `/www/${relativePath}`;
          const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
          try {
            phpBin.FS.mkdirTree(parentDir);
          } catch {} // ignorar si ya existe

          if (content.length === 0 && relativePath.endsWith("/")) {
            try {
              phpBin.FS.mkdir(fullPath);
            } catch {}
          } else {
            const data =
              content instanceof Uint8Array ? content : new Uint8Array(content);
            phpBin.FS.writeFile(fullPath, data);
          }
          resolve();
        });
      },
    );
    await Promise.all(writePromises);

    // 💾 Sincronizar FS virtual a IndexedDB
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

    // Separar path y query
    let [requestUri, queryString = ""] = (query ?? "").split("?");

    // Determinar si usamos front controller
    const entryPoint = config.ENTRY_POINT || null;
    let scriptFilename, scriptName, phpSelf, pathInfo;

    if (entryPoint) {
      // Framework / front controller
      scriptFilename = entryPoint; // ruta absoluta en VFS
      const docRoot = config.DOCUMENT_ROOT || "/www";
      scriptName = "/" + entryPoint.replace(new RegExp(`^${docRoot}/?`), "");
      phpSelf = scriptName;
      pathInfo = requestUri; // REQUEST_URI completo se pasa como PATH_INFO
    } else {
      // Script simple
      scriptFilename = requestUri; // ruta absoluta en VFS
      const docRoot = config.DOCUMENT_ROOT || "/www";
      scriptName = "/" + requestUri.replace(new RegExp(`^${docRoot}/?`), "");
      phpSelf = scriptName;
      pathInfo = null;
    }

    const contentType =
      headers["Content-Type"] || "application/x-www-form-urlencoded";

    // Variables base del servidor
    phpParts.push(`
  $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
  $_SERVER['REQUEST_TIME'] = '${Math.floor(Date.now() / 1000)}';
  $_SERVER['CONTENT_TYPE'] = '${contentType}';
  $_SERVER['CONTENT_LENGTH'] = '${(payload ?? "").length}';
  $_SERVER['REQUEST_METHOD'] = '${method}';
  $_SERVER['REQUEST_URI'] = '${requestUri}';
  $_SERVER['QUERY_STRING'] = '${queryString}';
  $_SERVER['SCRIPT_FILENAME'] = '${scriptFilename}';
  $_SERVER['SCRIPT_NAME'] = '${scriptName}';
  $_SERVER['PHP_SELF'] = '${phpSelf}';
  ${pathInfo ? `$_SERVER['PATH_INFO'] = '${pathInfo}';` : ""}
  `);

    // Headers
    phpParts.push(this.buildHeaderVariables(headers));

    // Config adicionales
    phpParts.push(this.buildConfigVariables(config));

    // GET / POST
    if (method === "GET") {
      phpParts.push(this.buildGetVariables(queryString));
    } else if (method === "POST") {
      phpParts.push(this.buildPostVariables(payload));
    } else {
      phpParts.push(
        `trigger_error("Unsupported HTTP method: ${method}", E_USER_ERROR);`,
      );
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
        if (colonIndex === -1) continue;
        const key = part.slice(0, colonIndex).trim();
        const value = part.slice(colonIndex + 1).trim();
        headers[key] = value;
      }
    }
    return headers;
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
        const strVal = String(val).replace(/'/g, "'\\''");
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
    const params = new URLSearchParams(query);
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

    /*  
    PhpWeb 0.0.8  –  PUBLIC API  (web / no-CGI)
    ----------------------------------------------------------
    LIFE-CYCLE
    ----------------------------------------------------------
    new PhpWeb(opts?)                 // constructor
    async run(code?, args?)           // exec string | file set in opts.arguments
    async exec(file, args?)           // run a concrete VFS file
    refresh()                         // reboot runtime (keeps VFS if persistent)

    ----------------------------------------------------------
    CONVENIENCE  (sync wrappers)
    ----------------------------------------------------------
    r(code) : string                  // one-liner run
    x(file, args?) : string            // one-liner exec

    ----------------------------------------------------------
    FILE-SYSTEM  (all sync – Emscripten FS façade)
    ----------------------------------------------------------
    analyzePath(path) : FSNode
    stat(path) : Stats
    readFile(path, opts?) : string | Uint8Array
    writeFile(path, data, opts?) : void
    mkdir(path) : void
    unlink(path) : void
    rename(old, new) : void
    readdir(path) : string[]
    php.fs.*                          // raw FS object (open, close, read, etc.)

    ----------------------------------------------------------
    RUNTIME
    ----------------------------------------------------------
    async loadExtension(url)          // dlopen a .so at runtime
    addSharedLib(name, url, ini?)     // register extra .so

    ----------------------------------------------------------
    STATIC
    ----------------------------------------------------------
    PhpWeb.phpVersion : string        // "8.3"
    PhpWeb.module : EmscriptenModule  // low-level handle
    ----------------------------------------------------------
    NOTE:  startTransaction / commitTransaction / abortTransaction
           do NOT exist in 0.0.8  (auto-transaction always ON).
    */
    this.phpWeb = new PhpWeb({
      wasmBinary: wasmBin,
      persist: { mountPath: "/www" },

      /* 
        1  ini: `memory_limit = 512M …`,             // Fragmento de php.ini que se añade antes de arrancar PHP
        2  prefix: '/mi-app',                        // Raíz del VFS interno (NO tiene relación con CGI)
        3  persistent: true,                         // Mantiene el VFS en IndexedDB entre recargas
        4  persist: true,                            // Alias redundante de `persistent` (demostrativo)
        5  autoTransaction: false,                   // Desactiva la sincronización automática; tú llamas (await php.startTransaction() .commitTransaction())
        6  extensions: ['intl','mbstring'],          // Extensiones que se cargan en cuanto se crea la instancia
        7  sharedLibs: […],                          // Ficheros `.so` (o URLs) que se cargan junto con PHP
        8  files: […],                               // Archivos adicionales que se descargan y copian al VFS antes de arrancar
        9  wasmBinary: await fetch(…),               // Buffer propio del binario `.wasm` (útil sin red o para bundling)
       10 locateFile: s => `…/${s}`,                // Callback que resuelve la URL final de cualquier asset (.wasm, .so, .data)
       11 env: { MI_VARIABLE: … },                  // Variables de entorno disponibles vía `getenv()` dentro de PHP
       12 preRun: [() => …],                        // Funciones JS que se ejecutan **antes** de inicializar PHP
       13 postRun: [() => …],                       // Funciones JS que se ejecutan **después** de que PHP termine
       14 print: txt => …,                          // Redirige la salida estándar de PHP (stdout)
       15 printErr: txt => …,                       // Redirige la salida de errores de PHP (stderr)
       16 onAbort: what => …,                       // Callback que se dispara si el runtime WASM aborta
       17 initialMemory: 4096,                      // Memoria inicial en páginas WASM (4096 × 64 KiB = 256 MiB)
       18 maximumMemory: 8192,                      // Memoria máxima que puede crecer el heap (8192 × 64 KiB = 512 MiB)
       19 ALLOW_MEMORY_GROWTH: true,                // Permite que el heap crezca dinámicamente
       20 noExitRuntime: true,                      // Mantiene el runtime vivo tras cada `run()` (evita reinicialización)
       21 noInitialRun: true,                       // No ejecuta ningún script automáticamente al arrancar el runtime
       22 arguments: ['-f', '/tmp/demo.php']        // Argumentos CLI que recibirá PHP en `argv`
      
       1  ini: `memory_limit = 512M …`,          // php.ini extra antes de arrancar PHP
       2  prefix: '/mi-app',                      // raíz del VFS interno
       3  persistent: true,                       // mantiene VFS en IndexedDB entre recargas
       4  persist: true, ??????                   // alias de persistent (ambos valen)
       5  extensions: ['intl','mbstring'],        // extensiones a precargar
       6  sharedLibs: […],                        // .so / urls a cargar al arrancar
       7  wasmBinary: await fetch(…),             // buffer propio del .wasm (sin fetch)
       8  locateFile: s => `/static/${s}`,        // resuelve URL de cualquier asset
       9  env: { MI_VARIABLE: 'valor' },          // vars de entorno para getenv()
      10  preRun: [() => …],                      // callbacks antes de iniciar runtime
      11  postRun: [() => …],                     // callbacks después de terminar
      12  print: txt => …,                        // stdout carácter a carácter
      13  printErr: txt => …,                     // stderr carácter a carácter
      14  onAbort: what => …,                     // se dispara si aborta el runtime
      15  arguments: ['-f','cli.php'],            // argv que recibirá PHP
      16  initialMemory: 4096,                    // páginas iniciales (256 MiB)
      17  maximumMemory: 8192,                    // páginas máximas (512 MiB)
      18  ALLOW_MEMORY_GROWTH: true,              // permite crecer el heap
      19  noExitRuntime: true,                    // no finalizar runtime tras run()
      20  noInitialRun: true,                     // no ejecutar main() al arrancar
      21  stdin: () => prompt('STDIN:'),          // lee de JS cuando PHP pida STDIN
      22  stdout: c => outEl.append(c),           // stdout por carácter (más fino que print)
      23  stderr: c => errEl.append(c),           // stderr por carácter
      24  quit: (status, toThrow) => …,           // sobrescribe función quit() de Emscripten
      25  noFSInit: true,                         // no montar FS por defecto (tú haces FS.mount)
      26  INITIAL_MEMORY: 256*1024*1024,          // bytes iniciales (alias de initialMemory*página)
      27  MAXIMUM_MEMORY: 512*1024*1024,          // bytes máximos (alias)
      28  STACK_SIZE: 8*1024*1024,                // tamaño de pila (por defecto 16 MiB)
      29  ALLOW_TABLE_GROWTH: true,               // permite crecer tabla de funciones
      30  ASSERTIONS: 1,                           // nivel de assertions Emscripten (0,1,2)
      31  STACK_OVERFLOW_CHECK: 1,                 // chequeo de desbordamiento de pila
      32  SAFE_HEAP: 1,                            // activa Safe-Heap (debug)
      33  GL_DEBUG: true,                          // log de llamadas WebGL
      34  GL_ASSERTIONS: true,                     // assertions en cada llamada GL
      35  fetchSettings: {credentials:'include'},  // opciones por defecto para fetch()
      36  instantiateWasm: (imports,okCb) => …,    // control total de instanciación WASM
      37  monitorRunDependencies: (left)=> …,      // progreso mientras faltan assets
      38  dynamicLibraries: ['a.so','b.so'],       // .so a cargar vía dlopen al arrancar
      39  wasmMemory: new WebAssembly.Memory({…}), // Memory propia (sin crear nueva)
      40  wasmTable: new WebAssembly.Table({…}),   // Table propia
      41  wasmModule: compiledModule,              // Módulo WASM ya compilado
      42  preinitializedWebGLContext: glCtx,       // contexto WebGL ya creado
      43  webglContextAttributes: {alpha:false}    // atributos para crear contexto GL interno
      */

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
