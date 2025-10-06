import sirv from "sirv";
import { resolve } from "path";
import { defineConfig } from "vite";
import { networkInterfaces } from "node:os";
import { cpSync, rmSync, existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";

const defaultLogger = console;
const originalLogger = console.log;

function createCustomLogger() {
    const logger = { ...defaultLogger };
    const targetMessagePart = 'doesn\'t exist at build time, it will remain unchanged';
    logger.info = (msg) => {
        if (typeof msg === 'string' && msg.includes(targetMessagePart)) {
            return; // Suprimido
        }
        originalLogger(msg);
    };
    logger.warn = (msg) => {
        if (typeof msg === 'string' && msg.includes(targetMessagePart)) {
            return; // Suprimido
        }
        originalLogger(msg);
    };
    logger.warnOnce = (msg) => {
        logger.warn(msg);
    };
    return logger;
}

function movePhpWasmTemporarily() {
    const tempDir = resolve(__dirname, ".temp_php_wasm");
    const wasmDir = resolve(__dirname, "node_modules/php-wasm");
    let movedFiles = [];
    return {
        name: "move-php-wasm-temporarily",
        buildStart() {
            if (!existsSync(wasmDir)) return;
            mkdirSync(tempDir, { recursive: true });
            const files = readdirSync(wasmDir);
            for (const file of files) {
                if (file.endsWith(".wasm")) {
                    const srcPath = resolve(wasmDir, file);
                    const destPath = resolve(tempDir, file);
                    renameSync(srcPath, destPath);
                    movedFiles.push({ src: srcPath, dest: destPath });
                }
            }
        },
        closeBundle() {
            for (const { src, dest } of movedFiles) {
                renameSync(dest, src);
            }
            movedFiles = [];
            if (existsSync(tempDir)) {
                rmSync(tempDir, { recursive: true, force: true });
            }
        },
    };
}

export default defineConfig(({ command }) => {
    let port, ip;
    const plugins = [
        movePhpWasmTemporarily(),
        {
            name: "servir-zip-dev",
            configureServer(server) {
                server.middlewares.use(
                    "/assets",
                    sirv(resolve(__dirname, "src/assets")),
                );
                server.httpServer?.once("listening", () => {
                    port = server.config.server.port;
                    const nets = networkInterfaces();
                    ip = "0.0.0.0";
                    for (const name of Object.keys(nets)) {
                        for (const net of nets[name] || []) {
                            if (net.family === "IPv4" && !net.internal) {
                                ip = net.address;
                                break;
                            }
                        }
                        if (ip !== "0.0.0.0") break;
                    }
                });
            },
        },
        {
            name: "copiar-zip-build",
            closeBundle() {
                if (command !== "build") return;
                const src = resolve(__dirname, "src/assets");
                const dst = resolve(__dirname, "dist/assets");
                mkdirSync(dst, { recursive: true });
                cpSync(src, dst, { recursive: true });
            },
        },
        {
            name: "print-url-final",
            configureServer(server) {
                server.httpServer?.once("listening", () => {
                    setTimeout(() => {
                        console.log(
                            `\n  ➜  Local Demo:    http://localhost:${port}/demo/index.html`,
                        );
                        console.log(
                            `  ➜  Network Demo: http://${ip}:${port}/demo/index.html\n`,
                        );
                    }, 0);
                });
            },
        },
    ];
    return {
        customLogger: createCustomLogger(),
        plugins,
        server: { host: "0.0.0.0" },
        build: {
            lib: {
                entry: resolve(__dirname, "src/php_runtime.js"),
                name: "MiLibreriaZip",
                fileName: () => "php_runtime.js",
                formats: ["es"],
            },
            rollupOptions: {
                output: {
                    exports: "named",
                    entryFileNames: "php_runtime.js",
                    chunkFileNames: "php_worker.js",
                    assetFileNames: "[name][extname]",
                },
                onwarn(warning, warn) {
                    if (warning.id && warning.id.includes('php-web.mjs')) return;
                    warn(warning);
                },
            },
            minify: "terser",
            sourcemap: false,
        },
        worker: {
            format: "es",
            rollupOptions: { output: { entryFileNames: "php_worker.js" } },
        },
    };
});
