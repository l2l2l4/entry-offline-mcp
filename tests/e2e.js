// End-to-end test: needs the real Entry offline app installed.
//   entry_launch -> asset search (reads app.asar) -> new project -> object + Python script -> run
//   -> stage screenshot -> save .ent
// Usage: node tests/e2e.js           (uses ENTRY_PATH / default install locations)
// WARNING: it creates a new project in the running Entry, discarding unsaved work in that window.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const annotate = (msg) => { if (process.env.GITHUB_ACTIONS) console.log('::error::' + String(msg).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A').slice(0, 1500)); };
const results = [];
const check = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push([name, true]); console.log(`PASS ${name} (${Math.round((Date.now() - t0) / 1000)}s)`); }
  catch (e) { results.push([name, false]); console.log(`FAIL ${name} - ${e.message}`); annotate(`FAIL ${name}: ${e.message}`); }
};
const textOf = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const jsonOf = (r) => { const t = textOf(r); try { return JSON.parse(t); } catch (e) { return t; } };

(async () => {
  console.log(`platform=${process.platform} arch=${process.arch} node=${process.version}`);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-e2e-'));
  const transport = new StdioClientTransport({ command: 'node', args: [path.join(__dirname, '..', 'src', 'index.js')], env: Object.assign({}, process.env, { ENTRY_MCP_HOME: home }), stderr: 'pipe' });
  const client = new Client({ name: 'e2e', version: '1' });
  await client.connect(transport, { timeout: 60000 });
  const call = async (name, args = {}, timeout = 120000) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
    if (r.isError) throw new Error(`${name}: ${textOf(r).slice(0, 600)}`);
    return r;
  };

  let ready = false;
  await check('entry_launch starts the real Entry app and connects', async () => {
    let last = '';
    for (let i = 0; i < 8 && !ready; i++) {
      try {
        const r = jsonOf(await call('entry_launch', { recovery: 'discard' }, 180000));
        last = JSON.stringify(r).slice(0, 400);
        if (r && r.ready) { ready = true; break; }
      } catch (e) { last = e.message; }
      console.log(`     attempt ${i + 1} not ready yet: ${last.slice(0, 200)}`);
      await sleep(20000);
    }
    assert.ok(ready, 'Entry never became ready; last: ' + last);
  });

  if (ready) {
    await check('entry_status: connected and ready', async () => {
      const s = jsonOf(await call('entry_status'));
      assert.ok(s.connected && s.ready, JSON.stringify(s).slice(0, 300));
    });
    await check('entry_search_assets reads the built-in resource DB (app.asar)', async () => {
      const r = textOf(await call('entry_search_assets', { kind: 'sprite', query: '강아지', limit: 3 }));
      assert.ok(r.includes('강아지'), r.slice(0, 300));
    });
    await check('new project, add object, write Python script', async () => {
      await call('entry_project', { action: 'new', name: 'E2E 테스트', empty: true });
      await call('entry_add_object', { source: 'empty', name: '공' });
      const r = jsonOf(await call('entry_set_script', { object: '공', python: 'def when_start():\n    점수 = 0\n    while True:\n        점수 += 1\n        Entry.wait_for_sec(0.05)\n' }));
      assert.ok(r.blocks >= 4, JSON.stringify(r).slice(0, 300));
    });
    await check('run the program and the variable changes', async () => {
      const r = jsonOf(await call('entry_run', { action: 'start', wait_ms: 2000, screenshot: false, state: true }));
      const v = r.variables && r.variables['점수'];
      await call('entry_run', { action: 'stop', screenshot: false, state: false });
      assert.ok(Number(v) > 3, 'score=' + v);
    });
    await check('stage screenshot returns a real PNG', async () => {
      const r = await call('entry_screenshot', { target: 'stage' });
      const img = (r.content || []).find((c) => c.type === 'image');
      assert.ok(img && img.data, 'no image');
      const buf = Buffer.from(img.data, 'base64');
      assert.ok(buf.length > 1000 && buf.slice(1, 4).toString() === 'PNG', 'bad png, bytes=' + buf.length);
    });
    await check('AI watermark is present', async () => {
      const s = jsonOf(await call('entry_status'));
      const w = s.project && s.project.aiWatermark;
      assert.ok(w && w.marked, JSON.stringify(w));
    });
    await check('save .ent file', async () => {
      const target = path.join(home, 'e2e.ent');
      await call('entry_project', { action: 'save', path: target });
      assert.ok(fs.existsSync(target) && fs.statSync(target).size > 5000, 'saved file missing/small');
      console.log('     saved bytes:', fs.statSync(target).size);
    });
    await check('re-open the saved .ent', async () => {
      await call('entry_project', { action: 'new', empty: true });
      const r = jsonOf(await call('entry_project', { action: 'open', path: path.join(home, 'e2e.ent') }));
      assert.ok(JSON.stringify(r).includes('공'), 'object missing after reopen');
    });
  }

  try { await client.close(); } catch (e) {}
  const failed = results.filter((r) => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.log('FATAL', e.message); annotate('FATAL ' + e.message); process.exit(2); });
