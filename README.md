THIS IS THE OLD README ... (TODO: fix)

# PHP WASM Runtime in the Browser

Run PHP code directly in the browser using WebAssembly (php-wasm). This library provides support for inline code execution and simulates a complete HTTP request cycle, all while being optimized for a non-blocking startup after the first initialization.

## Installation

Your PHP application files should be placed inside a zip archive located at `assets/www/php.zip`. This library will automatically unzip, persist in browser and run the files upon requests.

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

## TO-DO

- Use heavy frameworks for testing...
- Rewrite the parameters of the http lifecycle.. check php-cgi-wasm, params, cookies, headers..
- Only persist a php project folder, skip the rest if possible (anyways we have to keep them in memory so this wont work maybe ??)
- Keep an eye on static env and dynamic env vars.. rewrite dynamic ones on every request, keep static ones static...
- Still consider warmups ??
- REMOVE NOT NECESSARY LOGS!!
- Find performance bottlenecks in workers init, pool, etc...
- Cut off some workflow steps ? (less workload, faster cold startup: capture otuput fn, simplify worker, etc..)...

___________________ MORE TO CONSIDER??:

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
      
-------------------
