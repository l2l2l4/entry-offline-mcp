#!/usr/bin/env node
// Entry (엔트리) offline MCP server – lets AI agents (Claude, Codex, ...) build Entry block / Entry-Python projects
// by driving the locally installed Entry app over the Chrome DevTools Protocol.
'use strict';
const fs = require('fs');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { CdpClient, KEY_NAMES } = require('./cdp');
const { AssetLibrary } = require('./assets');
const { findEntryExe, findEntryAsar, isEntryProcessRunning, killEntry, startEntry, sleep } = require('./launcher');

const PORT = Number(process.env.ENTRY_DEBUG_PORT || 9333);
const cdp = new CdpClient(PORT);
let assets = null;
function getAssets() {
  if (assets) return assets;
  const exe = findEntryExe();
  const asarPath = findEntryAsar(exe);
  if (!asarPath) throw new Error('엔트리 리소스(app.asar)를 찾지 못했습니다. 환경변수 ENTRY_ASAR로 경로를 지정하세요.');
  assets = new AssetLibrary(asarPath);
  assets.load();
  return assets;
}
const GUIDE = fs.readFileSync(path.join(__dirname, '..', 'GUIDE.md'), 'utf8');

// ------------------------------------------------------------------ working folder (auto-created on first run)
const os = require('os');
function defaultHome() {
  if (process.env.ENTRY_MCP_HOME) return process.env.ENTRY_MCP_HOME;
  const docs = path.join(os.homedir(), 'Documents');
  return path.join(fs.existsSync(docs) ? docs : os.homedir(), 'EntryMCP');
}
const HOME = defaultHome();
const DIRS = { home: HOME, projects: path.join(HOME, 'projects'), images: path.join(HOME, 'images'), sounds: path.join(HOME, 'sounds'), screenshots: path.join(HOME, 'screenshots'), json: path.join(HOME, 'json') };
let firstRun = false;
function ensureWorkspace() {
  if (!fs.existsSync(HOME)) firstRun = true;
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
  const readme = path.join(HOME, 'README.txt');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      [
        'Entry MCP 작업 폴더 (MCP가 처음 실행될 때 자동 생성됨)',
        '',
        "projects    : 저장한 엔트리 작품(.ent)",
        "images      : 오브젝트/모양으로 쓸 이미지 파일을 넣어두는 곳",
        "sounds      : 소리로 쓸 mp3/wav 파일을 넣어두는 곳",
        "screenshots : 실행 화면 캡처",
        "json        : 내보낸 project JSON",
        "",
        "도구에 상대경로를 주면 이 폴더 기준으로 처리됩니다.",
        "다른 위치를 쓰려면 환경변수 ENTRY_MCP_HOME 을 설정하세요.",
      ].join(String.fromCharCode(13, 10)),
      'utf8'
    );
  }
}
ensureWorkspace();
// Resolve a user path: absolute stays, relative goes under the given workspace sub-folder.
function wpath(p, kind = 'home') {
  if (!p) return p;
  if (path.isAbsolute(p)) return path.normalize(p);
  return path.join(DIRS[kind] || HOME, p);
}
function findInput(p, kinds) {
  if (path.isAbsolute(p)) return p;
  for (const k of kinds) {
    const c = path.join(DIRS[k], p);
    if (fs.existsSync(c)) return c;
  }
  return path.join(DIRS[kinds[0]], p);
}
function safeName(n) {
  return String(n || 'entry_project').replace(/[\\/:*?"<>|]/g, '_').trim() || 'entry_project';
}

// ------------------------------------------------------------------ helpers
const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1) }] });
// for unexpected errors raised inside Entry's page (not our own "fail()" messages) append where it happened
const errorResult = (e) => {
  let msg = e && e.message ? e.message : String(e);
  if (e && e.bridgeStack && /Cannot read|is not a function|is not defined|undefined/.test(msg)) msg += ' @ ' + String(e.bridgeStack).split('\n').slice(1, 3).map((l) => l.trim()).join(' | ');
  return { isError: true, content: [{ type: 'text', text: '오류: ' + msg }] };
};

async function ensureConnected() {
  if (cdp.connected) return;
  if (!(await cdp.isPortOpen())) {
    const running = await isEntryProcessRunning();
    throw new Error(
      running
        ? `Entry가 디버그 포트(${PORT}) 없이 실행 중입니다. entry_launch(restart=true)로 재시작하세요 (저장하지 않은 작업은 사라질 수 있으니 사용자에게 먼저 확인).`
        : 'Entry가 실행 중이 아닙니다. 먼저 entry_launch를 호출하세요.'
    );
  }
  await cdp.connect();
}

// helpers that must work even while Entry is still loading / showing a dialog
const NO_READY_WAIT = new Set(['isReady', 'findModal', 'dismissAlert', 'clickModal', 'stageRect', 'forceRender', 'captureStage']);

async function bridge(fn, ...args) {
  await ensureConnected();
  if (!NO_READY_WAIT.has(fn)) {
    // Entry may still be booting right after entry_launch: wait a little instead of failing with an internal error
    const t0 = Date.now();
    while (!(await cdp.call('isReady').catch(() => false))) {
      if (Date.now() - t0 > 15000) {
        const modal = await cdp.call('findModal').catch(() => null);
        throw new Error('엔트리가 아직 준비되지 않았습니다' + (modal ? ` (대화상자: ${JSON.stringify(modal).slice(0, 200)})` : '') + '. entry_status로 상태를 확인하세요.');
      }
      await sleep(500);
    }
  }
  return cdp.call(fn, ...args);
}

function tool(server, name, description, schema, handler) {
  server.registerTool(name, { description, inputSchema: schema }, async (args) => {
    try {
      return await handler(args || {});
    } catch (e) {
      return errorResult(e);
    }
  });
}

async function waitReady(timeoutMs = 40000) {
  const t0 = Date.now();
  let lastErr;
  let modalSince = 0;
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (!cdp.connected) {
        if (await cdp.isPortOpen()) await cdp.connect();
        else {
          await sleep(500);
          continue;
        }
      }
      const st = await cdp.call('isReady').catch(() => false);
      if (st) return { ready: true };
      const modal = await cdp.call('findModal').catch(() => null);
      // a dialog that stays for a few seconds needs the user's decision (e.g. project recovery);
      // short-lived ones (loading popups) are just waited out
      if (modal) {
        if (!modalSince) modalSince = Date.now();
        if (Date.now() - modalSince > 3000) return { ready: false, modal };
      } else modalSince = 0;
    } catch (e) {
      lastErr = e;
      cdp.close();
    }
    await sleep(700);
  }
  throw new Error('Entry 준비 대기 시간 초과' + (lastErr ? ': ' + lastErr.message : ''));
}

async function stageScreenshot(target = 'stage') {
  let clip = null;
  if (target === 'stage') {
    // preferred: force-render + read the stage canvas (always the current frame, even if the window is hidden)
    try {
      const png = await bridge('captureStage');
      if (png) return { type: 'image', data: png, mimeType: 'image/png' };
    } catch (e) {}
    const r = await bridge('stageRect');
    if (r && r.width > 0) clip = { x: r.x, y: r.y, width: r.width, height: r.height, scale: Math.max(1, 480 / r.width) };
  }
  try {
    await bridge('forceRender');
  } catch (e) {}
  const data = await cdp.screenshot(clip);
  return { type: 'image', data, mimeType: 'image/png' };
}

function stageToClient(rect, x, y) {
  return { cx: rect.x + ((Number(x) + 240) / 480) * rect.width, cy: rect.y + ((135 - Number(y)) / 270) * rect.height };
}

const keyCodeOf = (k) => {
  if (typeof k === 'number') return k;
  const s = String(k);
  const map = { space: 32, enter: 13, left: 37, up: 38, right: 39, down: 40, shift: 16, ctrl: 17, control: 17, alt: 18, esc: 27, escape: 27, tab: 9, backspace: 8 };
  if (map[s.toLowerCase()] !== undefined) return map[s.toLowerCase()];
  if (/^[a-z]$/i.test(s)) return s.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(s)) return 48 + Number(s);
  if (/^\d+$/.test(s)) return Number(s);
  throw new Error('알 수 없는 키: ' + k);
};

// ------------------------------------------------------------------ schemas
const ObjectProps = z
  .object({
    name: z.string().optional(),
    x: z.number().optional().describe('stage x (-240 ~ 240, 0 = center)'),
    y: z.number().optional().describe('stage y (-135 ~ 135, 0 = center, up is +)'),
    size: z.number().optional().describe("Entry '크기' = (보이는 너비+높이)/2 px. 새 이미지는 엔트리가 자동으로 (너비+높이)≈200px로 줄이거나 키움"),
    scale: z.number().optional().describe('이미지 원본 픽셀 배율 (1 = 원본 크기 그대로, 예: 480x270 배경을 무대에 꽉 차게). scaleX/scaleY를 함께 설정'),
    scaleX: z.number().optional(),
    scaleY: z.number().optional(),
    rotation: z.number().optional().describe('방향(회전) in degrees'),
    direction: z.number().optional().describe('이동 방향 in degrees (90 = right, 0 = up)'),
    visible: z.boolean().optional(),
    rotateMethod: z.enum(['free', 'vertical', 'none']).optional().describe('free=360°, vertical=좌우만 뒤집기, none=회전 안함'),
    locked: z.boolean().optional(),
    picture: z.union([z.string(), z.number()]).optional().describe('현재 모양으로 할 모양 이름/ID/인덱스'),
    layer: z.union([z.enum(['front', 'back', 'forward', 'backward']), z.number()]).optional().describe('z-order within the scene; 0 = front-most'),
    text: z.string().optional().describe('textbox only'),
    fontSize: z.number().optional().describe('textbox only'),
    fontFamily: z.string().optional().describe("textbox only, e.g. 'NanumGothic', 'Nanum Myeongjo', 'NanumBarunPen', 'Nanum Pen Script', 'Jeju Hallasan'"),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strike: z.boolean().optional(),
    color: z.string().optional().describe('textbox text color #rrggbb'),
    bgColor: z.string().optional().describe("textbox background color #rrggbb or 'transparent'"),
    lineBreak: z.boolean().optional().describe('textbox: multi-line mode'),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    width: z.number().optional().describe('textbox width'),
    height: z.number().optional().describe('textbox height'),
  })
  .partial();

const BlockArray = z.array(z.any());

// ------------------------------------------------------------------ server
const server = new McpServer(
  { name: 'entry-offline', version: require('../package.json').version },
  {
    instructions:
      'Entry(엔트리) 오프라인 앱을 직접 조작해 블록코딩/엔트리파이썬 작품을 만드는 도구입니다. ' +
      '처음에는 entry_guide를 읽고 entry_launch로 앱을 연결하세요. 새 작품을 만들 때의 흐름: entry_project(new) → entry_search_assets/entry_add_object로 오브젝트·배경 배치 → entry_data로 변수/리스트/신호 → ' +
      '(화면이 바뀌는 작품은 한 장면에 몰아넣지 말고 entry_scene add로 시작/게임/결과처럼 장면을 나누세요) → ' +
      'entry_set_script(python 또는 blocks)로 코드 작성 → entry_run + entry_screenshot/entry_runtime_state/entry_input으로 실제 실행해 검증 → entry_project(save). ' +
      '이미 만든 작품을 고칠 때는 entry_project(new)로 처음부터 다시 만들지 마세요(현재 작품이 사라집니다). 열려 있는 작품을 그대로 두거나 entry_project(open)으로 연 뒤, ' +
      '바뀐 오브젝트만 entry_update_object / entry_set_script / entry_object_assets / entry_data로 고치고 entry_project(save)하세요. ' +
      '블록 형식이 헷갈리면 entry_block_reference로 확인하세요.',
  }
);

// ---- guide
tool(server, 'entry_guide', '엔트리 MCP 사용 설명서(좌표계, 블록 JSON 형식, 엔트리파이썬 문법, 고품질 작품 제작 팁). 작업 시작 전에 한 번 읽으세요.', {}, async () => text(GUIDE));

// ---- launch / status
tool(
  server,
  'entry_launch',
  'Entry 오프라인 앱을 원격 디버깅 포트로 실행하고 연결합니다. 이미 연결 가능하면 그대로 연결합니다. Entry가 디버그 포트 없이 실행 중이면 restart=true가 필요합니다(앱 강제 종료 → 저장 안 된 작업 손실 가능, 사용자 확인 후 사용). 시작 시 "작품 복구" 대화상자가 뜨면 recovery 옵션으로 처리합니다.',
  {
    restart: z.boolean().optional().describe('실행 중인 Entry를 강제 종료 후 디버그 모드로 재실행'),
    recovery: z.enum(['ask', 'restore', 'discard']).optional().describe("시작 시 '작품 복구' 대화상자 처리: ask(그대로 두고 보고), restore(복구=확인), discard(취소). 기본 ask"),
    open_file: z.string().optional().describe('실행하면서 열 .ent 파일 경로'),
  },
  async ({ restart, recovery = 'ask', open_file }) => {
    const notes = [];
    if (!(await cdp.isPortOpen())) {
      const running = await isEntryProcessRunning();
      if (running && !restart) {
        return errorResult(new Error(`Entry가 이미 디버그 포트 없이 실행 중입니다. 사용자에게 저장 여부를 확인한 뒤 restart=true로 다시 호출하세요.`));
      }
      if (running) {
        await killEntry();
        await sleep(1500);
        notes.push('기존 Entry 프로세스를 종료했습니다.');
      }
      const exe = findEntryExe();
      if (!exe) throw new Error('엔트리 오프라인 실행 파일을 찾지 못했습니다. 환경변수 ENTRY_PATH로 경로를 지정하세요 (Windows: C:\\entry\\Entry.exe, macOS: /Applications/Entry.app).');
      startEntry(exe, PORT, open_file);
      notes.push(`Entry 실행: ${exe} (port ${PORT})`);
    } else if (open_file) {
      await ensureConnected();
      await cdp.call('openEnt', open_file);
      notes.push('파일 열기: ' + open_file);
    }
    let st = await waitReady();
    // first run on a fresh install: Entry asks which "환경" to use. The MCP needs the full-featured one (기본형).
    for (let i = 0; i < 3 && !st.ready && st.modal && /환경을 선택/.test(st.modal.text || ''); i++) {
      const done = await cdp.call('chooseEnvironment', '기본형');
      notes.push(`첫 실행 환경 선택 대화상자: 기본형으로 진행${done ? '' : ' (버튼을 찾지 못함)'} — 사용자에게 알려 주세요`);
      await sleep(3000);
      st = await waitReady();
    }
    if (!st.ready && st.modal) {
      if (recovery === 'ask') {
        return text({ connected: true, ready: false, modal: st.modal, message: "대화상자가 열려 있습니다. 사용자에게 물어본 뒤 recovery='restore' 또는 'discard'로 다시 호출하세요.", notes });
      }
      await cdp.call('clickModal', recovery === 'restore' ? '확인' : '취소');
      notes.push(`대화상자 처리: ${recovery}`);
      await sleep(1500);
      st = await waitReady();
    }
    if (!st.ready) {
      // still blocked (e.g. by a dialog): report it instead of reading the project of a half-loaded app
      const modal = st.modal || (await cdp.call('findModal').catch(() => null));
      return text({ connected: true, ready: false, modal, notes, message: '엔트리가 아직 준비되지 않았습니다.' + (modal ? ' 화면에 대화상자가 열려 있습니다.' : ' 잠시 후 entry_status로 다시 확인하세요.'), workspace: Object.assign({ createdNow: firstRun }, DIRS) });
    }
    const summary = await cdp.call('summary', { brief: true });
    return text({ connected: true, ready: st.ready, notes, workspace: Object.assign({ createdNow: firstRun }, DIRS), project: summary });
  }
);

tool(server, 'entry_status', '연결 상태, 작업 폴더 경로, 현재 작품 요약(장면/오브젝트 이름/변수/신호/함수, 코딩 모드, 실행 상태)을 봅니다.', {}, async () => {
  const port = await cdp.isPortOpen();
  if (!port) return text({ connected: false, entryRunning: await isEntryProcessRunning(), workspace: DIRS, hint: 'entry_launch를 호출하세요.' });
  await ensureConnected();
  const ready = await cdp.call('isReady');
  const modal = await cdp.call('findModal');
  const summary = ready ? await cdp.call('summary', { brief: true }) : null;
  return text({ connected: true, ready, modal, workspace: DIRS, project: summary });
});

// ---- project
tool(
  server,
  'entry_project',
  [
    '작품 단위 작업.',
    "action='new': 새 작품(기본 엔트리봇 포함, empty=true면 오브젝트 모두 제거). 현재 작품은 저장하지 않으면 사라짐. 이미 만든 작품을 고치는 중이면 new를 쓰지 말고 open + 오브젝트 단위 수정(entry_update_object / entry_set_script / entry_object_assets)을 쓰세요.",
    "action='open': .ent 파일 열기(path; 상대경로는 작업폴더/projects 기준).",
    "action='save': .ent 파일로 저장. path 생략 시 작업폴더/projects/<작품이름>.ent. 상대경로는 작업폴더/projects 기준. name을 주면 작품 이름도 변경.",
    "action='rename': 작품 이름 변경(name).",
    "action='export_json': 엔트리 원본 project JSON 전체를 반환(고급 편집용, path를 주면 파일로 저장).",
    "action='import_json': project JSON(json 문자열 또는 json_path 파일)을 그대로 불러오기.",
  ].join('\n'),
  {
    action: z.enum(['new', 'open', 'save', 'rename', 'export_json', 'import_json']),
    path: z.string().optional(),
    name: z.string().optional(),
    empty: z.boolean().optional(),
    json: z.string().optional(),
    json_path: z.string().optional(),
  },
  async ({ action, path: p, name, empty, json, json_path }) => {
    if (action === 'new') {
      // how much work is about to be thrown away? (objects that already have code)
      let hadCode = 0;
      try {
        await ensureConnected();
        hadCode = Number(await cdp.evaluate('Entry.container.getAllObjects().filter(function (o) { return o.script && o.script.getBlockList().length > 0; }).length')) || 0;
      } catch (e) {}
      const res = await bridge('newProject', name, !!empty);
      if (hadCode > 0) {
        return text(Object.assign({}, res, {
          warning: `방금까지 열려 있던 작품(코드가 있는 오브젝트 ${hadCode}개)을 닫고 새 작품을 만들었습니다. 저장하지 않았다면 사라집니다. 이미 만든 작품을 고치는 중이었다면 new 대신 entry_project open으로 다시 열고, 바뀐 오브젝트만 entry_update_object / entry_set_script / entry_object_assets로 고치세요.`,
        }));
      }
      return text(res);
    }
    if (action === 'open') {
      if (!p) throw new Error('path가 필요합니다. (상대경로면 ' + DIRS.projects + ' 기준)');
      let abs = findInput(p, ['projects', 'home']);
      if (!fs.existsSync(abs) && fs.existsSync(abs + '.ent')) abs += '.ent';
      if (!fs.existsSync(abs)) throw new Error('파일 없음: ' + abs);
      return text(await bridge('openEnt', abs));
    }
    if (action === 'save') {
      let abs = p ? wpath(p, 'projects') : null;
      if (!abs) {
        const cur = await bridge('setProjectName', name || undefined);
        abs = path.join(DIRS.projects, safeName(name || cur));
      }
      if (!abs.toLowerCase().endsWith('.ent')) abs += '.ent';
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const r = await bridge('saveEnt', abs, name);
      const size = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
      return text(Object.assign(r, { bytes: size, verified: size > 0 }));
    }
    if (action === 'rename') return text({ name: await bridge('setProjectName', name) });
    if (action === 'export_json') {
      await ensureConnected();
      const j = await cdp.evaluate('JSON.stringify(Entry.exportProject())');
      if (p) {
        const out = wpath(p, 'json');
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, j);
        return text({ saved: out, bytes: j.length });
      }
      return text(j);
    }
    if (action === 'import_json') {
      const src = json || (json_path ? fs.readFileSync(findInput(json_path, ['json', 'home']), 'utf8') : null);
      if (!src) throw new Error('json 또는 json_path가 필요합니다.');
      return text(await bridge('loadProjectJson', JSON.parse(src)));
    }
  }
);

tool(
  server,
  'entry_get_project',
  "현재 작품의 상세 구조: 장면별 오브젝트(id, 이름, 좌표, 크기, 방향, 모양/소리 목록, 레이어), 변수/리스트/신호/함수. scripts='blocks'면 각 오브젝트 코드를 compact 블록 JSON으로, 'python'이면 엔트리파이썬으로 포함.",
  { scripts: z.enum(['none', 'blocks', 'python']).optional(), object: z.string().optional().describe('이 오브젝트만 자세히 (이름 또는 id)') },
  async ({ scripts = 'none', object }) => {
    if (object) {
      await ensureConnected();
      const r = await bridge('summary', { scripts });
      const all = r.scenes.flatMap((s) => s.objects);
      const o = all.find((x) => x.name === object || x.id === object);
      if (!o) throw new Error('오브젝트를 찾을 수 없음: ' + object);
      return text(o);
    }
    return text(await bridge('summary', { scripts }));
  }
);

// ---- assets
tool(
  server,
  'entry_search_assets',
  "엔트리 기본 리소스 라이브러리 검색(오프라인 내장). kind='sprite'(오브젝트: 모양 여러 개+소리 포함), 'background'(배경 오브젝트), 'picture'(모양 단일 그림), 'sound'(소리). query는 한국어/영어 키워드(공백=AND). query 없이 list_categories=true면 카테고리 목록.",
  {
    kind: z.enum(['sprite', 'background', 'picture', 'sound']),
    query: z.string().optional(),
    category: z.string().optional().describe("예: 'people', 'animal', 'background/background_nature', '배경/실내'"),
    limit: z.number().int().optional(),
    offset: z.number().int().optional(),
    list_categories: z.boolean().optional(),
  },
  async ({ kind, query, category, limit = 25, offset = 0, list_categories }) => {
    const a = getAssets();
    if (list_categories) return text(a.categories(kind === 'background' ? 'sprite' : kind));
    return text(a.search(kind, query, category, limit, offset));
  }
);

tool(
  server,
  'entry_preview_assets',
  '라이브러리 리소스의 썸네일 이미지를 봅니다(디자인 선택용). 최대 8개.',
  { kind: z.enum(['sprite', 'picture']), ids: z.array(z.string()).max(8) },
  async ({ kind, ids }) => {
    const a = getAssets();
    const content = [];
    for (const id of ids) {
      const th = a.thumbnail(kind === 'picture' ? 'picture' : 'sprite', id);
      if (!th || !th.length) {
        content.push({ type: 'text', text: `${id}: 썸네일 없음` });
        continue;
      }
      content.push({ type: 'text', text: `${id}: ${th[0].name}` });
      if (th[0].mime === 'image/png') content.push({ type: 'image', data: th[0].data, mimeType: 'image/png' });
    }
    return { content };
  }
);

// ---- objects
tool(
  server,
  'entry_add_object',
  [
    '오브젝트 추가.',
    "source='library': 라이브러리 스프라이트/배경(asset_id 또는 asset_name; entry_search_assets로 찾기). 배경은 자동으로 맨 뒤+잠금.",
    "source='image': 로컬 이미지 파일(image_paths, png/jpg/svg 등; 여러 장이면 모양 여러 개; 상대경로는 작업폴더/images 기준).",
    "source='textbox': 글상자(text, props로 fontSize/color/bgColor 등).",
    "source='empty': 빈 오브젝트(붓 그리기용 등).",
    'props로 위치/크기/이름 등을 바로 지정. scene을 주면 그 장면에 추가(없으면 현재 장면).',
  ].join('\n'),
  {
    source: z.enum(['library', 'image', 'textbox', 'empty']),
    asset_id: z.string().optional(),
    asset_name: z.string().optional(),
    image_paths: z.array(z.string()).optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    scene: z.string().optional(),
    props: ObjectProps.optional(),
  },
  async ({ source, asset_id, asset_name, image_paths, name, text: tx, scene, props = {} }) => {
    const p = Object.assign({}, props);
    if (name) p.name = name;
    if (source === 'library') {
      const a = getAssets();
      const ref = asset_id || asset_name;
      if (!ref) throw new Error('asset_id 또는 asset_name이 필요합니다.');
      const sp = a.get('sprite', ref);
      if (!sp) throw new Error('라이브러리에서 찾을 수 없음: ' + ref + ' (entry_search_assets로 id 확인)');
      return text(await bridge('addLibrarySprite', sp, p, scene));
    }
    if (source === 'image') {
      if (!image_paths || !image_paths.length) throw new Error('image_paths가 필요합니다.');
      const abs = image_paths.map((x) => findInput(x, ['images', 'home']));
      abs.forEach((x) => {
        if (!fs.existsSync(x)) throw new Error('파일 없음: ' + x);
      });
      return text(await bridge('addImageObject', abs, name, p, scene));
    }
    if (source === 'textbox') {
      const t = Object.assign({ text: tx !== undefined ? tx : props.text, name }, props);
      delete p.text;
      return text(await bridge('addTextBox', t, p, scene));
    }
    return text(await bridge('addEmptyObject', name, p, scene));
  }
);

tool(
  server,
  'entry_update_object',
  '오브젝트 속성 변경(이름, x/y, 크기, 방향, 이동방향, 회전방식, 보이기, 현재 모양, 레이어 순서, 글상자 글자/글꼴/색 등). 실행 전 "초기 상태"를 정하는 용도입니다.',
  { object: z.string().describe('오브젝트 이름 또는 id'), props: ObjectProps },
  async ({ object, props }) => text(await bridge('updateObject', object, props))
);

tool(
  server,
  'entry_object_op',
  "오브젝트 관리: action='delete' 삭제, 'duplicate' 복제(스크립트 포함, new_name), 'select' 선택(편집 화면에 표시).",
  { action: z.enum(['delete', 'duplicate', 'select']), object: z.string(), new_name: z.string().optional() },
  async ({ action, object, new_name }) => {
    if (action === 'delete') return text(await bridge('removeObject', object));
    if (action === 'duplicate') return text(await bridge('cloneObject', object, new_name));
    return text(await bridge('selectObject', object));
  }
);

tool(
  server,
  'entry_object_assets',
  [
    '오브젝트의 모양(picture)/소리(sound) 관리.',
    "add_picture: library_ids(entry_search_assets kind=picture의 id) 또는 files(로컬 이미지 경로; 상대경로는 작업폴더/images 기준).",
    "add_sound: library_ids(kind=sound의 id) 또는 files(mp3/wav 경로; 상대경로는 작업폴더/sounds 기준).",
    'remove_picture / remove_sound / rename_picture / rename_sound: name(현재 이름) [+ new_name].',
  ].join('\n'),
  {
    object: z.string(),
    action: z.enum(['add_picture', 'add_sound', 'remove_picture', 'remove_sound', 'rename_picture', 'rename_sound']),
    library_ids: z.array(z.string()).optional(),
    files: z.array(z.string()).optional(),
    name: z.string().optional(),
    new_name: z.string().optional(),
  },
  async ({ object, action, library_ids = [], files = [], name, new_name }) => {
    const a = library_ids.length ? getAssets() : null;
    const absFiles = files.map((f) => findInput(f, action === 'add_sound' ? ['sounds', 'home'] : ['images', 'home']));
    absFiles.forEach((x) => {
      if (!fs.existsSync(x)) throw new Error('파일 없음: ' + x);
    });
    if (action === 'add_picture') {
      const lib = library_ids.map((id) => {
        const x = a.get('picture', id) || (a.get('sprite', id) || {}).pictures;
        if (!x) throw new Error('그림을 찾을 수 없음: ' + id);
        return x;
      }).flat();
      return text(await bridge('addPictures', object, { library: lib, files: absFiles }));
    }
    if (action === 'add_sound') {
      const lib = library_ids.map((id) => {
        const x = a.get('sound', id);
        if (!x) throw new Error('소리를 찾을 수 없음: ' + id);
        return x;
      });
      return text(await bridge('addSounds', object, { library: lib, files: absFiles }));
    }
    if (action === 'remove_picture') return text(await bridge('removeAsset', object, 'picture', name));
    if (action === 'remove_sound') return text(await bridge('removeAsset', object, 'sound', name));
    if (action === 'rename_picture') return text(await bridge('renameAsset', object, 'picture', name, new_name));
    return text(await bridge('renameAsset', object, 'sound', name, new_name));
  }
);

// ---- scenes
tool(
  server,
  'entry_scene',
  "장면 관리: add(name), rename(scene,name), select(scene), delete(scene), move(scene,index). 오브젝트는 '현재 선택된 장면'에 추가되므로, 다른 장면에 넣으려면 entry_add_object의 scene 인자를 쓰세요.",
  { action: z.enum(['add', 'rename', 'select', 'delete', 'move']), scene: z.string().optional(), name: z.string().optional(), index: z.number().int().optional() },
  async (a) => text(await bridge('sceneOp', a))
);

// ---- data
tool(
  server,
  'entry_data',
  [
    '변수/리스트/신호 관리.',
    "kind='variable'|'list'|'message'. action='add'|'set'|'rename'|'delete'.",
    "variable: value(초기값), visible(무대에 표시), x,y(표시 위치), scope('global' 또는 오브젝트 이름=그 오브젝트 전용 지역변수).",
    'list: items(초기 항목 배열), visible, x, y, width, height.',
    'message: name만.',
    '파이썬 코드로 스크립트를 넣으면 쓰인 변수/리스트/신호는 자동 생성되지만, 초기값·표시여부·위치는 여기서 정하세요.',
  ].join('\n'),
  {
    kind: z.enum(['variable', 'list', 'message']),
    action: z.enum(['add', 'set', 'rename', 'delete']),
    name: z.string(),
    new_name: z.string().optional(),
    value: z.union([z.string(), z.number()]).optional(),
    items: z.array(z.union([z.string(), z.number()])).optional(),
    scope: z.string().optional(),
    visible: z.boolean().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  },
  async (a) => text(await bridge('dataOp', Object.assign({}, a, { newName: a.new_name })))
);

// ---- functions
tool(
  server,
  'entry_define_function',
  [
    '함수(나만의 블록) 정의/재정의. 블록 모드용.',
    "params: ['이름', ...] 또는 [{name, type:'string'|'boolean'}] (문자/숫자 값 또는 판단 값). {label:'텍스트'}를 끼우면 블록 모양 중간에 글자 삽입.",
    "body: compact 블록 배열. 본문에서 매개변수는 {\"type\":\"param\",\"name\":\"h\"}로 참조.",
    "kind='value'면 값 반환 함수: return_value에 반환할 값/블록.",
    "local_variables: ['i', ...] 함수 지역변수 → 본문에서 {\"type\":\"local_get\",\"name\":\"i\"}, {\"type\":\"local_set\",\"name\":\"i\",\"value\":0}.",
    "호출: 스크립트에서 {\"type\":\"call\",\"function\":\"함수이름\",\"params\":[인자...]}.",
    "(엔트리파이썬에서는 entry_set_script의 python 안에 def 함수(인자): 를 쓰면 일반 함수가 자동 생성됩니다)",
  ].join('\n'),
  {
    name: z.string(),
    params: z.array(z.any()).optional(),
    kind: z.enum(['normal', 'value']).optional(),
    body: BlockArray.optional(),
    return_value: z.any().optional(),
    local_variables: z.array(z.any()).optional(),
  },
  async ({ name, params, kind, body, return_value, local_variables }) => text(await bridge('defineFunction', { name, params, kind, body, returnValue: return_value, localVariables: local_variables }))
);

// ---- scripts
tool(
  server,
  'entry_set_script',
  [
    '오브젝트의 코드를 설정합니다. python 또는 blocks 중 하나를 주세요.',
    "python: 엔트리파이썬 코드(이벤트는 def when_start():, def when_press_key(\"space\"): 등). 엔트리 자체 변환기로 블록으로 바뀌며, 쓰인 변수/리스트/신호/함수가 자동 생성됩니다. 'import Entry'는 생략 가능.",
    "blocks: 스레드 배열 [[이벤트블록, 블록, ...], [...]] (compact 형식, entry_guide 참고). 숫자/문자 리터럴, 드롭다운은 값 또는 이름(변수/신호/오브젝트/모양/소리/장면 이름 → id 자동 변환).",
    "mode='replace'(기본: 기존 코드 전부 교체) | 'append'(기존 코드 뒤에 스레드 추가).",
    '결과의 warnings를 반드시 확인하세요(없는 모양/변수 등).',
  ].join('\n'),
  {
    object: z.string().describe('오브젝트 이름 또는 id'),
    python: z.string().optional(),
    blocks: BlockArray.optional(),
    mode: z.enum(['replace', 'append']).optional(),
  },
  async ({ object, python, blocks, mode = 'replace' }) => {
    if (python === undefined && blocks === undefined) throw new Error('python 또는 blocks 중 하나가 필요합니다.');
    return text(await bridge('setScript', { object, python, blocks, mode }));
  }
);

tool(
  server,
  'entry_get_script',
  "오브젝트 코드 읽기. format='blocks'(compact JSON, entry_set_script에 그대로 넣을 수 있음) | 'python'(엔트리파이썬) | 'raw'(엔트리 원본 JSON).",
  { object: z.string(), format: z.enum(['blocks', 'python', 'raw']).optional() },
  async ({ object, format = 'blocks' }) => text(await bridge('getScript', object, format))
);

tool(
  server,
  'entry_block_reference',
  [
    '블록 사전(실행 중인 엔트리에서 직접 읽음). 인자 없이 호출하면 카테고리 목록.',
    "category: start, flow, moving, looks, brush, text, sound, judgement, calc, variable, func, analysis, ai_utilize, expansion, arduino.",
    'query: 블록 type/한글 문구/파이썬 문법 검색(공백=AND). types: 특정 블록 type들의 상세.',
    '결과: type, text(블록 문구; [KEY]=입력칸), args(입력칸 순서·종류·옵션·기본값), statements(내부 블록 묶음 수), python(엔트리파이썬 문법).',
  ].join('\n'),
  {
    category: z.string().optional(),
    query: z.string().optional(),
    types: z.array(z.string()).optional(),
    detail: z.boolean().optional(),
    limit: z.number().int().optional(),
    include_hidden: z.boolean().optional(),
  },
  async ({ category, query, types, detail, limit, include_hidden }) => text(await bridge('blockReference', { category, query, types, detail, limit, includeHidden: include_hidden }))
);

tool(
  server,
  'entry_set_coding_mode',
  "엔트리 화면의 코딩 모드 전환: 'block'(블록코딩) | 'python'(엔트리파이썬 텍스트 편집 화면). 코드 자체는 동일하며 표시 방식만 바뀝니다. 파이썬 모드는 일부 블록(값 반환 함수, 지역변수 함수 등)을 지원하지 않습니다.",
  { mode: z.enum(['block', 'python']) },
  async ({ mode }) => text(await bridge('setCodingMode', mode))
);

// ---- runtime
tool(
  server,
  'entry_run',
  "작품 실행 제어. action='start'(시작하기 버튼), 'stop', 'restart'. wait_ms만큼 기다린 뒤 결과를 돌려주며, screenshot=true면 무대 화면 캡처, state=true면 변수/오브젝트 상태 포함. 실행 중 에러/경고 로그도 포함됩니다.",
  { action: z.enum(['start', 'stop', 'restart']), wait_ms: z.number().int().optional(), screenshot: z.boolean().optional(), state: z.boolean().optional() },
  async ({ action, wait_ms = 1000, screenshot = true, state = true }) => {
    await ensureConnected();
    await sleep(50);
    const logStart = cdp.logs.length;
    const bridgeLogStart = await cdp.call('isReady').then(() => cdp.evaluate('window.__entryMcp.logs.length'));
    if (action === 'stop') {
      await bridge('stop');
    } else {
      if (action === 'restart') await bridge('stop');
      await bridge('run');
      if (wait_ms > 0) await sleep(Math.min(wait_ms, 60000));
    }
    const content = [];
    const res = { engine: (await bridge('runtimeState')).engine };
    if (state) Object.assign(res, await bridge('runtimeState'));
    const logs = cdp.logs.slice(logStart).filter((l) => /error|exception/i.test(l.level) && Date.now() - l.t < 120000);
    const toasts = await cdp.evaluate(`window.__entryMcp.logs.slice(${bridgeLogStart})`);
    if (logs.length || (toasts && toasts.length)) res.logs = [...(toasts || []), ...logs].slice(-30);
    content.push({ type: 'text', text: JSON.stringify(res, null, 1) });
    if (screenshot) content.push(await stageScreenshot('stage'));
    return { content };
  }
);

tool(
  server,
  'entry_screenshot',
  "화면 캡처. target='stage'(실행 화면만) | 'window'(엔트리 전체 창: 블록 편집기 포함). save_as를 주면 작업폴더/screenshots에 PNG로도 저장.",
  { target: z.enum(['stage', 'window']).optional(), save_as: z.string().optional() },
  async ({ target = 'stage', save_as }) => {
    await ensureConnected();
    const img = await stageScreenshot(target);
    const content = [img];
    if (save_as) {
      let out = wpath(save_as, 'screenshots');
      if (!/\.png$/i.test(out)) out += '.png';
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(img.data, 'base64'));
      content.unshift({ type: 'text', text: 'saved: ' + out });
    }
    return { content };
  }
);

tool(server, 'entry_runtime_state', '실행 상태 조회: 엔진 상태, 모든 변수/리스트 값, 각 오브젝트의 위치/크기/방향/모양/말풍선/복제본 수, 대답 값.', {}, async () => text(await bridge('runtimeState')));

tool(
  server,
  'entry_input',
  [
    '실행 중인 작품에 사용자 입력을 보냅니다(게임 테스트용). events를 순서대로 실행.',
    "{type:'key', key:'space'|'left'|'a'|..., duration_ms?:누르고 있을 시간(기본 100)}",
    "{type:'key_down'|'key_up', key}",
    "{type:'click', x, y} (무대 좌표, 오브젝트/마우스 클릭 이벤트 발생)",
    "{type:'mouse_move', x, y}",
    "{type:'mouse_down'|'mouse_up', x, y}",
    "{type:'text', text, submit?:true} (묻고 기다리기 대답 입력)",
    "{type:'wait', ms}",
    '마지막에 screenshot/state를 돌려줍니다.',
  ].join('\n'),
  { events: z.array(z.record(z.string(), z.any())), screenshot: z.boolean().optional(), state: z.boolean().optional() },
  async ({ events, screenshot = true, state = false }) => {
    await ensureConnected();
    const rect = await bridge('stageRect');
    const done = [];
    for (const ev of events) {
      const t = ev.type;
      if (t === 'wait') await sleep(Math.min(Number(ev.ms) || 0, 30000));
      else if (t === 'key' || t === 'key_down' || t === 'key_up') {
        const kc = keyCodeOf(ev.key);
        const keyName = KEY_NAMES[kc] || String.fromCharCode(kc).toLowerCase();
        if (t !== 'key_up') await cdp.key('rawKeyDown', kc, keyName);
        if (t === 'key') await sleep(Math.min(Number(ev.duration_ms) || 100, 30000));
        if (t !== 'key_down') await cdp.key('keyUp', kc, keyName);
      } else if (t === 'click' || t === 'mouse_down' || t === 'mouse_up' || t === 'mouse_move') {
        const { cx, cy } = stageToClient(rect, ev.x || 0, ev.y || 0);
        await cdp.mouse('mouseMoved', cx, cy);
        if (t === 'click' || t === 'mouse_down') await cdp.mouse('mousePressed', cx, cy);
        if (t === 'click') await sleep(60);
        if (t === 'click' || t === 'mouse_up') await cdp.mouse('mouseReleased', cx, cy);
      } else if (t === 'text') {
        await cdp.insertText(String(ev.text));
        if (ev.submit !== false) {
          await cdp.key('rawKeyDown', 13, 'Enter');
          await cdp.key('keyUp', 13, 'Enter');
        }
      } else throw new Error('알 수 없는 이벤트 type: ' + t);
      done.push(t);
    }
    const content = [];
    const res = { done };
    if (state) res.state = await bridge('runtimeState');
    content.push({ type: 'text', text: JSON.stringify(res, null, 1) });
    if (screenshot) content.push(await stageScreenshot('stage'));
    return { content };
  }
);

tool(server, 'entry_logs', '엔트리 앱의 콘솔 로그/예외/토스트 경고 메시지를 봅니다(디버깅용).', { clear: z.boolean().optional(), errors_only: z.boolean().optional() }, async ({ clear, errors_only }) => {
  await ensureConnected();
  await cdp.call('isReady');
  const toasts = await cdp.evaluate('window.__entryMcp.logs.slice(-50)');
  let logs = cdp.logs.slice(-100);
  if (errors_only) logs = logs.filter((l) => /error|exception|warn/i.test(l.level));
  const r = { toasts, console: logs.map((l) => `[${l.level}] ${l.text}`) };
  if (clear) {
    cdp.logs = [];
    await cdp.evaluate('window.__entryMcp.logs.length=0');
  }
  return text(r);
});

tool(
  server,
  'entry_eval_js',
  '고급: 엔트리 렌더러에서 JavaScript를 직접 실행합니다(전역 Entry 객체, window.__entryMcp 헬퍼 사용 가능). async 함수 본문으로 실행되며 return 값이 JSON으로 반환됩니다. 다른 도구로 불가능한 경우에만 사용하세요.',
  { code: z.string() },
  async ({ code }) => {
    await ensureConnected();
    await cdp.call('isReady');
    const r = await cdp.evaluate(`(async()=>{ ${code} })()`);
    return text(r === undefined ? 'undefined' : r);
  }
);

// ------------------------------------------------------------------ start
(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
