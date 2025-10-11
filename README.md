# PHP Runtime for Browser

Execute backend PHP REST APIs natively in the browser via WebAssembly. This library is built on top of the amazing php-wasm project: [php-wasm by Sean Morris](https://github.com/seanmorris/php-wasm)


## Key Features

- 🔒 **Sandboxed Environment** - Secure isolation from host system
- 🚀 **Server-less PHP Execution** - Run PHP applications without a backend server
- ⚡ **Non-blocking Initialization** - Fast startup with background worker setup
- 🌐 **HTTP Request/Response lifecycle** - Complete `$_SERVER`, `$_GET`, `$_POST` environment
- 🔄 **Concurrent Processing with workers** - Multiple Web Workers for parallel request handling
- 💾 **Persistent Caching for large files** - WASM binary and PHP files cached in IndexedDB


## How It Works

1. **Initialization**: Downloads and caches PHP WASM binary and your application files
2. **Worker Pool**: Creates multiple Web Workers for concurrent request handling
3. **Request Processing**: Simulates HTTP environment and executes PHP code
4. **Response**: Returns output back to the main thread 


## PHP Application Setup

**Important**: You must package your PHP REST API as a ZIP file and place it at `assets/www/php_api.zip`. The library will automatically download, extract, and cache your PHP files.

### Directory Structure

```
├── assets
│   ├── wasm
│   │   └── php-web.js.zip  # PHP 8.2 WASM binary (included)
│   └── www
│       └── php_api.zip     # Your PHP application (required)
├── README.md
├── php_runtime.js
└── php_worker.js
```


## Quick Start

In your client HTML, include the library and initialize:

```html
<script src="php_runtime.js" type="module"></script>
<script type="module">
    // Initialize PHP runtime
    await runPHP.init({
        DEBUG: true,
        NUM_WORKERS: 2,
        TIMEOUT_WORKER: 30000
    });
    
    // Now you can execute PHP code!
</script>
```

### Execute PHP Code

#### Inline PHP Execution
```javascript
const result = await runPHP.inline('<?php echo "Hello from PHP!"; ?>');
console.log(result); // "Hello from PHP!"
```

#### HTTP-like Requests to Your API
```javascript
// GET request
const users = await runPHP.request({
    method: "GET",
    query: "/www/php_api/users.php?page=1"
});

// POST request
const response = await runPHP.request({
    method: "POST",
    query: "/www/php_api/users.php",
    payload: "name=John&email=john@example.com",
    headers: "Content-Type: application/x-www-form-urlencoded"
});
```

## Configuration Options

| Option                | Description                           | Default              |
| :-------------------- | :------------------------------------ | :------------------- |
| `DEBUG`               | Enable detailed logging               | `false`              |
| `NUM_WORKERS`         | Number of concurrent workers          | `1`                  |
| `TIMEOUT_WORKER`      | Worker timeout in milliseconds        | `60000`              |
| `DOCUMENT_ROOT`       | PHP document root path                | `"/www"`             |
| `ENTRY_POINT`         | Default PHP script path               | `""`                 |
| `SERVER_ADDR`         | Virtual server IP                     | `"127.0.0.1"`        |
| `SERVER_NAME`         | Server name                           | `"browser-localhost"`|
| `SERVER_PORT`         | Server port                           | `"8080"`             |
| `SERVER_SOFTWARE`     | Server software identifier            | `"wasm-server-0.0.8"`|


## Browser Support

- Chrome 57+
- Firefox 52+
- Safari 11+
- Edge 16+

Requires WebAssembly and Web Workers support.


## Performance Tips

1. **Pre-warm the runtime** with essential files before first request
2. **Use appropriate worker count** (2-4 workers for most applications)
3. **Minimize project size** (big projects like Laravel will run slow)


## Limitations

- No network access (fetch, curl, etc.)
- Limited file system operations
- Some PHP extensions may not be available
- Memory usage grows with application complexity


## Examples

Check the `demo-build/` or `demo-dev/` directories for working examples:

- **Basic Demo** (`demo-dev/index.html`) - Simple use cases of PHP execution (npm run dev)
- **CRUD Application** (`demo-build/index.html`) - WASM PHP SQLite API backend + Vanilla HTML+JS Client
- **Load Testing** (`demo-build/load_example.html`) - Performance metrics for some scenarios


## License

Licensed under the Apache License, Version 2.0. See [LICENSE.txt](LICENSE.txt) for details.


## Support

For issues and questions, please open an issue on GitHub.
