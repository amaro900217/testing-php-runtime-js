# PHP WASM Runtime in the Browser

Ejecuta código PHP directamente en el navegador usando WebAssembly (php-wasm), con soporte para código en línea y simulación de peticiones HTTP.

## Instalación

```html
<!-- Cargar la librería -->
<script src="php-runtime.js" type="module"></script>

<!-- Configurar PHP Runtime -->
<script type="module">
    await runPHP.init({
        DEBUG: true,
        NUM_WORKERS: 2
    });
</script>
```

## Uso

### Ejecutar código PHP en línea
```javascript
const result = await runPHP.inline('<?php echo "¡Hola desde PHP!"; ?>');
console.log(result);
```

### Realizar petición HTTP
```javascript
const result = await runPHP.request({
    method: "POST",
    query: "/index.php?user=test",
    payload: "name=test&value=123",
    headers: "Content-Type: application/x-www-form-urlencoded"
});
console.log(result);
```

## Configuración

Opción          | Descripción                    | Default
----------------|--------------------------------|------------------
DEBUG           | Activar logging detallado      | false
NUM_WORKERS     | Número de workers concurrentes | 2
DOCUMENT_ROOT   | Ruta raíz PHP                  | /www
ENTRY_POINT     | Script PHP por defecto         | ""
SERVER_ADDR     | IP del servidor virtual        | 127.0.0.1
SERVER_NAME     | Nombre del servidor            | browser-localhost
SERVER_PORT     | Puerto del servidor            | 8080
SERVER_SOFTWARE | Versión del servidor           | wasm-server-0.0.8

## Características

- Ejecución de PHP en navegador sin servidor
- Workers múltiples para concurrencia
- Caché de WASM y aplicación PHP en IndexedDB
- Simulación completa de entorno HTTP
- Timeout configurable (default: 5000ms)
- Sandbox seguro para el sistema host
