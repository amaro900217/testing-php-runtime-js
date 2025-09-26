import sirv from "sirv";
import { resolve } from "path";
import { defineConfig } from "vite";
import { networkInterfaces } from "node:os";
import { cpSync, existsSync, mkdirSync } from "node:fs";

export default defineConfig(({ command }) => {
  let port, ip;
  const plugins = [
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
              `\n  ➜  Local Demo:   http://localhost:${port}/demo/index.html`,
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
