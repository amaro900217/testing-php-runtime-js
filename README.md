PHP WASM Runtime in the Browser
===============================

Este proyecto permite ejecutar código PHP directamente en el navegador usando WebAssembly (php-wasm).
Soporta tanto ejecución de código PHP en línea como simulación de peticiones HTTP, con soporte de
múltiples workers para ejecución concurrente.

Características
---------------

- Ejecuta PHP en el navegador sin necesidad de un servidor.
- Simula peticiones HTTP con $_SERVER, headers, query strings y payloads.
- Arquitectura de múltiples workers para ejecución concurrente.
- Cachea el binario WASM en IndexedDB para reducir tiempos de carga.
- API totalmente asincrónica mediante la función runPHP().
- Logging de depuración para desarrollo.

Instalación
-----------

Incluye la librería y los scripts de inicialización en tu HTML:

```javascript
<!-- Carga de la librería -->
<script src="php-runtime.js"></script>

<!-- Inicialización y runPHP -->
<script type="module">
window.runPHP = (function() {
  const initPromise = new Promise(async resolve => {
    while (!window.php) await new Promise(r => setTimeout(r, 10));
    await window.php.init(window.phpConfig);
    const elapsed = performance.now() - window.benchmarkStart;
    console.warn(`[BENCHMARK] PHP Runtime listo en ${Math.round(elapsed)} ms`);
    resolve();
  });
  return async function(codeOrRequest) {
    await initPromise;
    if (typeof codeOrRequest === 'string') {
      return await window.php.runInline(codeOrRequest);
    } else {
      return await window.php.runRequest(codeOrRequest);
    }
  };
})();
</script>
```

Uso
---

1. Ejecutar código PHP en línea:
```javascript
const result = await runPHP(`<?php echo "¡Hola desde WASM PHP!"; ?>`);
console.log(result);
```

2. Ejecutar PHP simulando una petición HTTP:
```javascript
const requestResult = await runPHP({
  method: "POST",
  query: "/index.php?user=test",
  payload: "param1=value1&param2=value2",
  headers: "Content-Type: application/x-www-form-urlencoded;X-Custom-Header: Test"
});
console.log(requestResult);
```

Estructura del Proyecto
-----------------------

- php-runtime.js       → Loader principal, gestor de workers y cola de tareas.
- php-worker.js        → Worker que carga PHP WASM y ejecuta el código PHP.
- assets/wasm/php-web.js.wasm.gz → Binario PHP WASM comprimido.
- assets/www/php.zip   → Archivos del proyecto PHP para montar en el filesystem virtual.
- index.html           → Ejemplo de integración en HTML.

Configuración
-------------

- DEBUG          → Activar logging detallado (por defecto: false).
- NUM_WORKERS    → Número de workers para ejecución concurrente (por defecto: 2).
- DOCUMENT_ROOT  → Ruta raíz de los archivos PHP (por defecto: /www).
- ENTRY_POINT    → Script PHP por defecto a ejecutar (opcional).
- SERVER_ADDR    → IP reportada a los scripts PHP (por defecto: 127.0.0.1).
- SERVER_NAME    → Nombre del servidor (por defecto: browser-localhost).
- SERVER_PORT    → Puerto del servidor (por defecto: 8080).

Notas
-----

- La ejecución de PHP está sandboxeada y es segura para el sistema host.
- Scripts PHP muy grandes pueden llegar a los límites de memoria del navegador.
- Los workers tienen un timeout por defecto de 5000ms. Ajustar según la necesidad.
- El cache en IndexedDB evita descargas repetidas del binario WASM, acelerando la carga.
