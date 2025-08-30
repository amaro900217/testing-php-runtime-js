// php-worker.js
import { PhpWeb } from './node_modules/php-wasm/PhpWeb.mjs';

let phpWeb = null;
let initialized = false;

self.log = (...args) => { self.postMessage({ type: 'log', args }); };

function buildPhpServerEnv({ method, query, payload, headersStr, config = {} }) {
  self.log('🔧 Building PHP server environment', { method, query, payload, headersStr });
  const headers = {};
  if (headersStr?.trim()) {
    headersStr.split(';').forEach(h => {
      if (!h.trim()) return;
      const [key, ...rest] = h.split(':');
      headers[key.trim()] = rest.join(':').trim();
    });
  }
  const [requestUri, queryString = ''] = (query ?? '').split('?');
  const contentType = headers['Content-Type'] || 'application/x-www-form-urlencoded';
  let php = `
  $_SERVER['REMOTE_ADDR']    = '127.0.0.1';
  $_SERVER['REQUEST_TIME']   = '${Math.floor(Date.now()/1000)}';
  $_SERVER['CONTENT_TYPE']   = '${contentType}';
  $_SERVER['CONTENT_LENGTH'] = '${(payload ?? '').length}';
  $_SERVER['REQUEST_METHOD'] = '${method}';
  $_SERVER['REQUEST_URI']    = '${requestUri}';
  $_SERVER['QUERY_STRING']   = '${queryString}';
  $_SERVER['SCRIPT_FILENAME']= '${requestUri}';
  `;
  for (const key in headers) {
    const keyFormatted = 'HTTP_' + key.toUpperCase().replace(/-/g, '_');
    php += `$_SERVER['${keyFormatted}'] = '${headers[key]}';\n`;
  }
  for (const key in config) {
    const val = config[key];
    if (typeof val === 'boolean') php += `$_SERVER['${key}'] = ${val ? 'true' : 'false'};\n`;
    else if (typeof val === 'number') php += `$_SERVER['${key}'] = ${val};\n`;
    else php += `$_SERVER['${key}'] = '${val.toString().replace(/'/g, "\\'")}';\n`;
  }
  // Llenar $_GET desde la query string
  if (method === 'GET' && query) {
    const queryString = query.split('?')[1] || '';
    const params = new URLSearchParams(queryString);
    for (const [key, value] of params.entries()) {
      php += `$_GET['${key}'] = '${value.replace(/'/g, "\\'")}';\n`;
    }
  }
  // Llenar $_POST desde payload
  if (method === 'POST' && payload) {
    const params = new URLSearchParams(payload);
    for (const [key, value] of params.entries()) {
      php += `$_POST['${key}'] = '${value.replace(/'/g, "\\'")}';\n`;
    }
  }
  self.log('✅ PHP server environment built', php);
  return php;
}

function captureOutput() {
  let buffer = '';
  const onOutput = e => { buffer += e.detail; self.log('📤 PHP output chunk', e.detail); };
  const onError  = e => { buffer += e.detail; self.log('⚠️ PHP error chunk', e.detail); };
  phpWeb.addEventListener('output', onOutput);
  phpWeb.addEventListener('error', onError);
  return {
    stop() { phpWeb.removeEventListener('output', onOutput); phpWeb.removeEventListener('error', onError); },
    get() { return buffer; }
  };
}

self.onmessage = async e => {
  const msg = e.data;
  self.log('📨 Received message', msg);
  if (msg.type === 'loadWasm') {
    if (!phpWeb) {
      phpWeb = new PhpWeb({ wasmBinary: msg.wasmBin, persist: { mountPath: "/www" } });
      await phpWeb.ready;
      self.config = { ...msg.cnfg };
      initialized = true;
      self.log('✅ PhpWeb WASM loaded and ready');
      self.postMessage({ type: 'workerReady' });
    }
    return;
  }

  if (!initialized) {
    self.log('⚠️ Worker not initialized yet');
    return;
  }

  if (msg.type === 'runInline') {
    try {
      self.log('▶️ Running inline PHP code');
      await phpWeb.refresh();
      const cap = captureOutput();
      await phpWeb.run(msg.request.code);
      cap.stop();
      self.log('✅ Inline PHP run completed');
      self.postMessage({ id: msg.id, result: cap.get() });
    } catch (err) {
      self.log('❌ Error in runInline', err);
      self.postMessage({ id: msg.id, result: `PHP ERROR: ${err.message}` });
    }
  }

  if (msg.type === 'runRequest') {
    try {
      const { method, query, payload, headers } = msg.request;
            self.log('▶️ Running PHP request', { method, query, payload, headers });

      const serverEnv = buildPhpServerEnv({ method, query, payload, headersStr: headers, config: self.config });
      const phpCode = `<?php ${serverEnv} include_once($_SERVER['SCRIPT_FILENAME']);`;
            self.log('💻 Full PHP code to run:', phpCode);

      await phpWeb.refresh();
      const cap = captureOutput();
      await phpWeb.run(phpCode);
      cap.stop();
      self.log('✅ PHP request completed');
      self.postMessage({ id: msg.id, result: cap.get() });
    } catch (err) {
      self.log('❌ Error in runRequest', err);
      self.postMessage({ id: msg.id, result: `PHP ERROR: ${err.message}` });
    }
  }
};
