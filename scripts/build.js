// scripts/build.js
import { execSync } from "child_process";
import fs from "fs-extra";
import path from "path";

const BUILD_DIR = "dist_build";

// --- 1. Limpiar carpeta de build ---
fs.emptyDirSync(BUILD_DIR);
console.log(`Cleared ${BUILD_DIR} \n`);

// --- 2. Copiar test.html y assets ---
fs.copySync("test.html", `${BUILD_DIR}/test.html`);
fs.copySync("assets", `${BUILD_DIR}/assets`);

// --- 3. Build con Parcel sin source maps ---
execSync(`npx parcel build php-runtime.js --dist-dir ${BUILD_DIR} --no-source-maps`, { stdio: "inherit" });

// --- 4. Borrar cualquier .wasm en la raíz de dist_build ---
const wasmFiles = fs.readdirSync(BUILD_DIR).filter(f => f.endsWith(".wasm"));
for (const file of wasmFiles) {
  fs.removeSync(path.join(BUILD_DIR, file));
}

// --- 5. Renombrar php-worker.[hash].js a php-worker.js ---
const workerFile = fs.readdirSync(BUILD_DIR).find(f => /^php-worker\.[a-f0-9]+\.js$/.test(f));
if (workerFile) {
  const oldPath = path.join(BUILD_DIR, workerFile);
  const newPath = path.join(BUILD_DIR, "php-worker.js");
  fs.moveSync(oldPath, newPath, { overwrite: true });
} else {
  console.warn("No php-worker file found to rename");
}

// --- 6. Actualizar php-runtime.js para apuntar al worker fijo ---
const runtimeFile = path.join(BUILD_DIR, "php-runtime.js");
if (fs.existsSync(runtimeFile)) {
  let runtimeContent = fs.readFileSync(runtimeFile, "utf-8");
  runtimeContent = runtimeContent.replace(/php-worker\.[a-f0-9]+\.js/g, "php-worker.js");
  fs.writeFileSync(runtimeFile, runtimeContent, "utf-8");
} else {
  console.warn("php-runtime.js not found in build folder");
}

console.log(`\nBuild + testdoc in ./${BUILD_DIR} \n`);

