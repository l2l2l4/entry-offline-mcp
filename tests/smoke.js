// Cross-platform smoke test (runs in CI on macOS / Windows / Linux, no Entry app needed).
//  1) launcher: finds a fake Entry installation in the platform's layout and its app.asar
//  2) MCP server starts and answers tools/list; entry_status reports "not connected" without Entry
// Usage: node tests/smoke.js [command args...]   (default: node src/index.js)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const results = [];
// in GitHub Actions, failures are also written as annotations (visible on the public run page)
const annotate = (msg) => { if (process.env.GITHUB_ACTIONS) console.log('::error::' + String(msg).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A').slice(0, 1500)); };
const check = (name, fn) => Promise.resolve().then(fn).then(() => { results.push([name, true]); console.log('PASS', name); }, (e) => { results.push([name, false, e]); console.log('FAIL', name, '-', e.message); annotate(`FAIL ${name}: ${e.message}`); });

(async () => {
  console.log(`platform=${process.platform} arch=${process.arch} node=${process.version}`);

  await check('launcher finds a fake Entry install and its app.asar', () => {
    const L = require('../src/launcher');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-smoke-'));
    let exe;
    if (process.platform === 'darwin') {
      const app = path.join(root, 'Entry.app');
      fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
      fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
      fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'Entry'), '');
      fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'app.asar'), '');
      fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), '<plist><dict><key>CFBundleExecutable</key><string>Entry</string></dict></plist>');
      exe = L.findEntryExe(process.platform, { ENTRY_PATH: app }, root);
      assert.ok(exe && exe.endsWith(path.join('Contents', 'MacOS', 'Entry')), 'exe from .app: ' + exe);
      assert.strictEqual(L.findEntryAsar(exe, {}), path.join(app, 'Contents', 'Resources', 'app.asar'));
    } else {
      const dir = path.join(root, 'entry');
      fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
      const name = process.platform === 'win32' ? 'Entry.exe' : 'entry';
      fs.writeFileSync(path.join(dir, name), '');
      fs.writeFileSync(path.join(dir, 'resources', 'app.asar'), '');
      exe = L.findEntryExe(process.platform, { ENTRY_PATH: dir }, root);
      assert.strictEqual(exe, path.join(dir, name));
      assert.strictEqual(L.findEntryAsar(exe, {}), path.join(dir, 'resources', 'app.asar'));
    }
    assert.strictEqual(L.findEntryAsar(exe, { ENTRY_ASAR: '/custom/app.asar' }), '/custom/app.asar');
    fs.rmSync(root, { recursive: true, force: true });
  });

  await check('process check works without Entry running', async () => {
    const L = require('../src/launcher');
    const running = await L.isEntryProcessRunning();
    assert.strictEqual(typeof running, 'boolean');
  });

  const [cmd, ...args] = process.argv.length > 2 ? process.argv.slice(2) : ['node', path.join(__dirname, '..', 'src', 'index.js')];
  let client;
  await check(`MCP server starts (${cmd} ${args.join(' ').slice(0, 80)})`, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-home-'));
    const transport = new StdioClientTransport({ command: cmd, args, env: Object.assign({}, process.env, { ENTRY_MCP_HOME: home, ENTRY_PATH: path.join(home, 'no-entry'), ENTRY_DEBUG_PORT: '59333' /* an unused port: never attach to a real Entry */ }), stderr: 'pipe' });
    client = new Client({ name: 'smoke', version: '1' });
    let serverErr = '';
    if (transport.stderr) transport.stderr.on('data', (d) => { serverErr += d; });
    const t0 = Date.now();
    try {
      // first run of "npx github:..." has to clone and install: allow up to 4 minutes
      await client.connect(transport, { timeout: 240000 });
    } catch (e) {
      throw new Error(`${e.message} after ${Math.round((Date.now() - t0) / 1000)}s; server stderr: ${serverErr.slice(-800) || '(none)'}`);
    }
    console.log(`     connected in ${Math.round((Date.now() - t0) / 1000)}s`);
    // diagnostics: if the server process dies right after the handshake, say why
    const proc = transport._process;
    if (proc) {
      proc.on('exit', (code, sig) => {
        const msg = `server process exited: code=${code} signal=${sig} after ${Math.round((Date.now() - t0) / 1000)}s total; stderr: ${serverErr.slice(-1000) || '(none)'}`;
        console.log('     ' + msg);
        annotate(msg);
      });
    }
    await new Promise((r) => setTimeout(r, 1500)); // give a crash a moment to show up
  });

  if (client) {
    await check('tools/list returns the Entry tools', async () => {
      const l = await client.listTools();
      assert.ok(l.tools.length >= 20, 'tool count ' + l.tools.length);
      for (const n of ['entry_launch', 'entry_status', 'entry_set_script']) assert.ok(l.tools.some((t) => t.name === n), 'missing ' + n);
      console.log('     tools:', l.tools.length);
    });
    await check('entry_status without Entry says not connected (no crash)', async () => {
      const r = await client.callTool({ name: 'entry_status', arguments: {} });
      const text = r.content[0].text;
      assert.ok(/"connected":\s*false/.test(text), text.slice(0, 200));
    });
    await check('entry_guide is served', async () => {
      const r = await client.callTool({ name: 'entry_guide', arguments: {} });
      assert.ok(r.content[0].text.length > 5000);
    });
    try { await client.close(); } catch (e) {}
  }

  const failed = results.filter((r) => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
