// php-worker.js
import { PhpWeb } from "./node_modules/php-wasm/PhpWeb.mjs";

class PhpWorker {
  constructor() {
    this.phpWeb = null;
    this.initialized = false;
    this.config = {};

    // Bind de métodos para mantener el contexto
    this.onMessage = this.onMessage.bind(this);
    this.log = this.log.bind(this);

    // Inicializar el worker
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

    const headers = this._parseHeaders(headersStr);
    const [requestUri, queryString = ""] = (query ?? "").split("?");
    const contentType =
      headers["Content-Type"] || "application/x-www-form-urlencoded";

    let php = this._buildServerVariables(
      method,
      requestUri,
      queryString,
      contentType,
      payload,
    );
    php += this._buildHeaderVariables(headers);
    php += this._buildConfigVariables(config);

    if (method === "GET" && query) {
      php += this._buildGetVariables(query);
    }

    if (method === "POST" && payload) {
      php += this._buildPostVariables(payload);
    }

    this.log("✅ PHP server environment built", php);
    return php;
  }

  _parseHeaders(headersStr) {
    const headers = {};
    if (headersStr?.trim()) {
      headersStr.split(";").forEach((h) => {
        if (!h.trim()) return;
        const [key, ...rest] = h.split(":");
        headers[key.trim()] = rest.join(":").trim();
      });
    }
    return headers;
  }

  _buildServerVariables(method, requestUri, queryString, contentType, payload) {
    return `
            $_SERVER['REMOTE_ADDR']    = '127.0.0.1';
            $_SERVER['REQUEST_TIME']   = '${Math.floor(Date.now() / 1000)}';
            $_SERVER['CONTENT_TYPE']   = '${contentType}';
            $_SERVER['CONTENT_LENGTH'] = '${(payload ?? "").length}';
            $_SERVER['REQUEST_METHOD'] = '${method}';
            $_SERVER['REQUEST_URI']    = '${requestUri}';
            $_SERVER['QUERY_STRING']   = '${queryString}';
            $_SERVER['SCRIPT_FILENAME']= '${requestUri}';
        `;
  }

  _buildHeaderVariables(headers) {
    let php = "";
    for (const key in headers) {
      const keyFormatted = "HTTP_" + key.toUpperCase().replace(/-/g, "_");
      php += `$_SERVER['${keyFormatted}'] = '${headers[key]}';\n`;
    }
    return php;
  }

  _buildConfigVariables(config) {
    let php = "";
    for (const key in config) {
      const val = config[key];
      if (typeof val === "boolean") {
        php += `$_SERVER['${key}'] = ${val ? "true" : "false"};\n`;
      } else if (typeof val === "number") {
        php += `$_SERVER['${key}'] = ${val};\n`;
      } else {
        php += `$_SERVER['${key}'] = '${val.toString().replace(/'/g, "\\'")}';\n`;
      }
    }
    return php;
  }

  _buildGetVariables(query) {
    let php = "";
    const queryString = query.split("?")[1] || "";
    const params = new URLSearchParams(queryString);
    for (const [key, value] of params.entries()) {
      php += `$_GET['${key}'] = '${value.replace(/'/g, "\\'")}';\n`;
    }
    return php;
  }

  _buildPostVariables(payload) {
    let php = "";
    const params = new URLSearchParams(payload);
    for (const [key, value] of params.entries()) {
      php += `$_POST['${key}'] = '${value.replace(/'/g, "\\'")}';\n`;
    }
    return php;
  }

  captureOutput() {
    let buffer = "";
    const onOutput = (e) => {
      buffer += e.detail;
      this.log("📤 PHP output chunk", e.detail);
    };
    const onError = (e) => {
      buffer += e.detail;
      this.log("⚠️ PHP error chunk", e.detail);
    };

    this.phpWeb.addEventListener("output", onOutput);
    this.phpWeb.addEventListener("error", onError);

    return {
      stop: () => {
        this.phpWeb.removeEventListener("output", onOutput);
        this.phpWeb.removeEventListener("error", onError);
      },
      get: () => buffer,
    };
  }

  async loadWasm(wasmBin, config) {
    if (!this.phpWeb) {
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
      const phpCode = `<?php ${serverEnv} include_once($_SERVER['SCRIPT_FILENAME']);`;
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
    const msg = e.data;
    this.log("📨 Received message", msg);

    if (msg.type === "loadWasm") {
      await this.loadWasm(msg.wasmBin, msg.cnfg);
      return;
    }

    if (!this.initialized) {
      this.log("⚠️ Worker not initialized yet");
      return;
    }

    switch (msg.type) {
      case "runInline":
        await this.runInline(msg.id, msg.request.code);
        break;
      case "runRequest":
        await this.runRequest(msg.id, msg.request);
        break;
    }
  }
}

// Inicializar el worker
new PhpWorker();
