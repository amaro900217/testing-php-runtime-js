// php-worker.js
import { PhpWeb } from "./node_modules/php-wasm/PhpWeb.mjs";

class PhpWorker {
  constructor() {
    this.phpWeb = null;
    this.initialized = false;
    this.config = {};
    this.onMessage = this.onMessage.bind(this);
    this.log = this.log.bind(this);
    self.onmessage = this.onMessage;
  }

  log(...args) {
    self.postMessage({ type: "log", args });
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
    const [requestUri, queryString = ""] = (query ?? "").split("?");
    const contentType =
      headers["Content-Type"] || "application/x-www-form-urlencoded";
    phpParts.push(
      this.buildServerVariables(
        method,
        requestUri,
        queryString,
        contentType,
        payload,
      ),
    );
    phpParts.push(this.buildHeaderVariables(headers));
    phpParts.push(this.buildConfigVariables(config));
    if (method === "GET" && query) {
      phpParts.push(this.buildGetVariables(query));
    }
    if (method === "POST" && payload) {
      phpParts.push(this.buildPostVariables(payload));
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
        if (colonIndex === -1) continue; // ignorar si no hay ":"
        const key = part.slice(0, colonIndex).trim();
        const value = part.slice(colonIndex + 1).trim();
        headers[key] = value;
      }
    }
    return headers;
  }

  buildServerVariables(method, requestUri, queryString, contentType, payload) {
    return `
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['REQUEST_TIME'] = '${Math.floor(Date.now() / 1000)}';
$_SERVER['CONTENT_TYPE'] = '${contentType}';
$_SERVER['CONTENT_LENGTH'] = '${(payload ?? "").length}';
$_SERVER['REQUEST_METHOD'] = '${method}';
$_SERVER['REQUEST_URI'] = '${requestUri}';
$_SERVER['QUERY_STRING'] = '${queryString}';
$_SERVER['SCRIPT_FILENAME'] = '${requestUri}';
`;
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
        phpParts.push(`$_SERVER['${key}'] = ${val ? "true" : "false"};\n`);
      } else if (typeof val === "number") {
        phpParts.push(`$_SERVER['${key}'] = ${val};\n`);
      } else {
        // Reemplazo de comillas simples
        const strVal = String(val).replace(/'/g, "\\'");
        phpParts.push(`$_SERVER['${key}'] = '${strVal}';\n`);
      }
    }
    return phpParts.join("");
  }

  escapePhp(str) {
    return typeof str === "string" ? str.replace(/'/g, "\\'") : str;
  }

  buildGetVariables(query) {
    const phpParts = [];
    const queryString = query.split("?")[1] || "";
    const params = new URLSearchParams(queryString);
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
    this.phpWeb = new PhpWeb({
      wasmBinary: wasmBin,
      persist: { mountPath: "/www" },
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
    this.log("📨 Received message", msg);
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

// Inicializar el worker
new PhpWorker();
