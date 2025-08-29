// scripts/dev.js
import { exec } from "child_process";
import fs from "fs-extra";
import chokidar from "chokidar";
import path from "path";

const DEV_DIR = "dist_dev";

fs.emptyDirSync(DEV_DIR);

fs.copySync("test.html", `${DEV_DIR}/test.html`);
fs.copySync("assets", `${DEV_DIR}/assets`);

chokidar.watch(DEV_DIR, { ignoreInitial: true }).on("all", (event, changedPath) => {
  if (changedPath.endsWith(".wasm")) {
    fs.removeSync(changedPath);
  }
});

const watcher = chokidar.watch(["test.html", "assets"], { ignoreInitial: true });

watcher.on("all", (event, changedPath) => {
  if (changedPath.endsWith("test.html")) {
    fs.copySync("test.html", `${DEV_DIR}/test.html`);
  } else {
    fs.copySync("assets", `${DEV_DIR}/assets`);
  }
  const now = new Date();
  fs.utimesSync("php-runtime.js", now, now);
});

const parcel = exec(`npx parcel serve php-runtime.js --dist-dir ${DEV_DIR} --port 8080`);

parcel.stderr.on("data", (data) => process.stderr.write(data));

parcel.on("exit", (code) => {
  console.log(`Parcel exited with code ${code}`);
});

console.log(`> Dev server running: Open http://localhost:8080/test.html \n`);

