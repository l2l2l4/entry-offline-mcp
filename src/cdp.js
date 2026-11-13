// Minimal Chrome DevTools Protocol client for the Entry (Electron) main window.
'use strict';
const fs = require('fs');
const path = require('path');

const BRIDGE_SRC = fs.readFileSync(path.join(__dirname, 'bridge.js'), 'utf8');

class CdpClient {
  constructor(port) {
    this.port = port;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.logs = [];
    this.targetId = null;
  }

  async listTargets() {
    const res = await fetch(`http://127.0.0.1:${this.port}/json`, { signal: AbortSignal.timeout(2000) });
    return res.json();
  }

  async isPortOpen() {
    try {
      await this.listTargets();
      return true;
    } catch {
      return false;
    }
  }

  get connected() {
    return this.ws && this.ws.readyState === 1;
  }

  async connect() {
    if (this.connected) return;
    const targets = await this.listTargets();
    const t = targets.find((x) => x.type === 'page' && /main\.html/.test(x.url));
    if (!t) throw new Error('Entry 메인 창(main.html)을 찾지 못했습니다. 대상: ' + targets.map((x) => x.url).join(', '));
    this.targetId = t.id;
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = (e) => reject(new Error('CDP 연결 실패: ' + (e.message || 'websocket error')));
    });
    this.ws = ws;
    ws.onmessage = (m) => this._onMessage(m);
    ws.onclose = () => {
      for (const [, p] of this.pending) p.reject(new Error('CDP 연결이 끊어졌습니다 (Entry가 종료되었거나 새로고침됨).'));
      this.pending.clear();
      this.ws = null;
    };
    await this.send('Runtime.enable');
    await this.send('Page.enable').catch(() => {});
  }

  _onMessage(m) {
    let d;
    try {
      d = JSON.parse(m.data);
    } catch {
      return;
    }
    if (d.id && this.pending.has(d.id)) {
      const p = this.pending.get(d.id);
      this.pending.delete(d.id);
      if (d.error) p.reject(new Error(d.error.message + (d.error.data ? ': ' + d.error.data : '')));
      else p.resolve(d.result);
      return;
    }
    if (d.method === 'Runtime.consoleAPICalled') {
      const args = (d.params.args || []).map((a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : a.description || a.type));
      this._pushLog(d.params.type, args.join(' '));
    } else if (d.method === 'Runtime.exceptionThrown') {
      const ex = d.params.exceptionDetails || {};
      this._pushLog('exception', (ex.exception && ex.exception.description) || ex.text || 'exception');
    } else if (d.method === 'Page.loadEventFired' || d.method === 'Runtime.executionContextsCleared') {
      this._pushLog('info', '[page reloaded]');
    }
  }

  _pushLog(level, text) {
    this.logs.push({ t: Date.now(), level, text: String(text).slice(0, 2000) });
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
  }

  send(method, params = {}, timeoutMs = 60000) {
    if (!this.connected) return Promise.reject(new Error('CDP not connected'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timeout`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, { timeoutMs = 60000 } = {}) {
    await this.connect();
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeoutMs);
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails;
      throw new Error((ex.exception && ex.exception.description) || ex.text || 'evaluation error');
    }
    return r.result ? r.result.value : undefined;
  }

  async injectBridge() {
    await this.evaluate(BRIDGE_SRC + '\n;true');
  }

  // Call window.__entryMcp[fn](...args) and unwrap {ok, result|error}
  async call(fn, ...args) {
    await this.connect();
    const ready = await this.evaluate('!!(window.__entryMcp && window.__entryMcp.VERSION)');
    const ver = await this.evaluate('window.__entryMcp ? window.__entryMcp.VERSION : 0');
    const want = Number((BRIDGE_SRC.match(/const VERSION = (\d+)/) || [])[1] || 0);
    if (!ready || ver !== want) {
      await this.evaluate('try{delete window.__entryMcp}catch(e){};true');
      await this.injectBridge();
    }
    const expr = `window.__entryMcp.call(${JSON.stringify(fn)}, ${JSON.stringify(args)})`;
    const r = await this.evaluate(expr, { timeoutMs: 120000 });
    if (!r) throw new Error('bridge returned nothing');
    if (!r.ok) {
      const e = new Error(r.error);
      e.bridgeStack = r.stack;
      throw e;
    }
    return r.result;
  }

  async screenshot(clip) {
    await this.connect();
    const params = { format: 'png', captureBeyondViewport: false };
    if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: clip.scale || 1 };
    const r = await this.send('Page.captureScreenshot', params, 30000);
    return r.data; // base64
  }

  async key(type, keyCode, key) {
    await this.connect();
    const k = key || String.fromCharCode(keyCode);
    await this.send('Input.dispatchKeyEvent', {
      type,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      key: k,
      code: codeFor(keyCode),
    });
  }

  async insertText(text) {
    await this.connect();
    await this.send('Input.insertText', { text });
  }

  async mouse(type, x, y, button = 'left', clickCount = 1) {
    await this.connect();
    await this.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: type === 'mouseReleased' || type === 'mouseMoved' ? 0 : 1 });
  }

  close() {
    try {
      this.ws && this.ws.close();
    } catch {}
    this.ws = null;
  }
}

function codeFor(kc) {
  if (kc >= 65 && kc <= 90) return 'Key' + String.fromCharCode(kc);
  if (kc >= 48 && kc <= 57) return 'Digit' + String.fromCharCode(kc);
  return { 32: 'Space', 13: 'Enter', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 16: 'ShiftLeft', 17: 'ControlLeft', 18: 'AltLeft', 27: 'Escape', 9: 'Tab', 8: 'Backspace' }[kc] || '';
}

const KEY_NAMES = { 32: ' ', 13: 'Enter', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 16: 'Shift', 17: 'Control', 18: 'Alt', 27: 'Escape', 9: 'Tab', 8: 'Backspace' };

module.exports = { CdpClient, KEY_NAMES };
