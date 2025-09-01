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
      method: "POST",
      query: "/index.php?user=test",
      payload: "otheruser=theuser&value=123",
      headers: "Content-Type:application/x-www-form-urlencoded;"
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

## Special Thanks

This library is built on top of the amazing **php-wasm** project. A special thanks to the creator and maintainers of this essential building block.

- [php-wasm by seanmorris](https://php-wasm.seanmorr.is/)
