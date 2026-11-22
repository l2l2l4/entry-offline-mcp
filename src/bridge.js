/* eslint-disable */
// This file is injected into the Entry renderer (main.html) via CDP Runtime.evaluate.
// It defines window.__entryMcp, a helper layer on top of the Entry (entryjs) runtime.
// It must be plain browser JS (no require / import).
(function () {
  const VERSION = 32;
  if (window.__entryMcp && window.__entryMcp.VERSION === VERSION) return;

  const M = { VERSION };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const NO_INPUT = new Set(['Indicator', 'Text', 'LineBreak']);
  const LITERAL_TYPES = new Set(['number', 'text', 'angle']);
  M.logs = M.logs || [];

  function fail(msg, extra) {
    const e = new Error(msg);
    if (extra) e.extra = extra;
    throw e;
  }
  M.fail = fail;

  // ---------------------------------------------------------------- toast hook
  (function hookToasts() {
    try {
      if (!Entry.toast || Entry.toast.__mcpHooked) return;
      ['alert', 'warning', 'success'].forEach((k) => {
        const orig = Entry.toast[k];
        if (typeof orig !== 'function') return;
        Entry.toast[k] = function (title, message) {
          M.logs.push({ t: Date.now(), level: 'toast-' + k, text: String(title || '') + ' | ' + String(message || '') });
          if (M.logs.length > 300) M.logs.splice(0, M.logs.length - 300);
          return orig.apply(this, arguments);
        };
      });
      Entry.toast.__mcpHooked = true;
    } catch (e) {}
  })();

  // ---------------------------------------------------------------- workspace component (React)
  M.ws = function () {
    if (M._ws && M._ws.loadProject) return M._ws;
    const root = document.getElementById('__next');
    if (!root) return null;
    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer') || k.startsWith('_reactRootContainer'));
    let fiber = root[key];
    if (fiber && fiber._internalRoot) fiber = fiber._internalRoot.current;
    const stack = [fiber];
    let n = 0;
    while (stack.length && n < 100000) {
      const f = stack.pop();
      n++;
      if (!f) continue;
      const s = f.stateNode;
      if (s && typeof s === 'object' && !(s instanceof Node) && typeof s.loadProject === 'function' && typeof s.handleProgramLanguageModeChanged === 'function') {
        M._ws = s;
        return s;
      }
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return null;
  };

  M.isReady = function () {
    return !!(window.Entry && Entry.container && Entry.playground && Entry.engine && Entry.stage && Entry.variableContainer && Entry.scene && M.ws());
  };

  // A modal dialog (e.g. 작품 복구) blocking the UI.
  M.findModal = function () {
    const btns = [...document.querySelectorAll('button, a, span, div')].filter((e) => e.children.length === 0 && /^(확인|취소)$/.test((e.innerText || '').trim()) && e.offsetParent !== null);
    if (!btns.length) return null;
    let box = btns[0];
    for (let i = 0; i < 6 && box.parentElement; i++) box = box.parentElement;
    return { text: (box.innerText || '').trim().slice(0, 300), buttons: btns.map((b) => b.innerText.trim()) };
  };
  // Close an Entry alert popup (only a single 확인 button) and return its message.
  M.dismissAlert = function () {
    const boxes = [...document.querySelectorAll('.entry-modal-box, .entry-modal-alert')].filter((e) => e.offsetParent !== null);
    if (!boxes.length) return null;
    const box = boxes[0];
    const btn = [...box.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.innerText || '').trim() === '확인');
    const msg = (box.innerText || '').split(/\n/).map((x) => x.trim()).filter((x) => x && x !== '확인' && x !== '알림').join(' ');
    if (btn) btn.click();
    return msg.slice(0, 300);
  };
  M.clickModal = function (label) {
    const b = [...document.querySelectorAll('button, a, span, div')].find((e) => e.children.length === 0 && (e.innerText || '').trim() === label && e.offsetParent !== null);
    if (!b) return false;
    b.click();
    return true;
  };
  // First-run dialog "엔트리 만들기 환경을 선택해 주세요" (기본형 / 교과형 + 확인): pick one inside that dialog, then confirm.
  M.chooseEnvironment = async function (label) {
    const visibleLeaves = (root, text) => [...root.querySelectorAll('*')].filter((e) => e.children.length === 0 && (e.innerText || '').trim() === text && e.offsetParent !== null);
    const oks = visibleLeaves(document, '확인');
    if (!oks.length) return false;
    let box = oks[oks.length - 1];
    for (let i = 0; i < 10 && box.parentElement; i++) {
      box = box.parentElement;
      if ((box.innerText || '').includes('환경을 선택')) break;
    }
    if ((box.innerText || '').includes('환경을 선택')) {
      // the option card may be the leaf itself or its parent: click the label, then its ancestors' own click targets
      const opts = visibleLeaves(box, label);
      if (opts.length) {
        opts[0].click();
        if (opts[0].parentElement) opts[0].parentElement.click();
        await sleep(300);
      }
    }
    const ok = visibleLeaves(box, '확인')[0] || oks[oks.length - 1];
    ok.click();
    return true;
  };

  // ---------------------------------------------------------------- lookups
  const vc = () => Entry.variableContainer;
  const allObjects = () => Entry.container.getAllObjects();
  const scenes = () => Entry.scene.getScenes();

  M.findObject = function (ref, opt) {
    if (ref && typeof ref === 'object' && ref.id && ref.entity) return ref;
    const objs = allObjects();
    if (ref === undefined || ref === null || ref === '') {
      const cur = Entry.playground.object;
      if (cur) return cur;
      fail('object를 지정하세요.');
    }
    let o = objs.find((x) => x.id === ref) || objs.find((x) => x.name === ref) || objs.find((x) => String(x.name).toLowerCase() === String(ref).toLowerCase());
    if (!o && !(opt && opt.optional)) fail(`오브젝트 "${ref}"를 찾을 수 없습니다. 존재하는 오브젝트: ${objs.map((x) => x.name + '(' + x.id + ')').join(', ')}`);
    return o;
  };
  M.findScene = function (ref, opt) {
    const s = scenes();
    if (ref === undefined || ref === null || ref === '') return Entry.scene.selectedScene;
    const r = s.find((x) => x.id === ref) || s.find((x) => x.name === ref) || (typeof ref === 'number' ? s[ref] : null);
    if (!r && !(opt && opt.optional)) fail(`장면 "${ref}"를 찾을 수 없습니다. 존재하는 장면: ${s.map((x) => x.name + '(' + x.id + ')').join(', ')}`);
    return r;
  };
  function findVariable(ref, kind, obj) {
    const list = kind === 'list' ? vc().lists_ : vc().variables_;
    let cands = list.filter((v) => v.id_ === ref);
    if (!cands.length) cands = list.filter((v) => v.name_ === ref);
    if (cands.length > 1 && obj) {
      const local = cands.find((v) => v.object_ === obj.id);
      if (local) return local;
      const global = cands.find((v) => !v.object_);
      if (global) return global;
    }
    return cands[0];
  }
  M.findVariable = findVariable;
  function findMessage(ref) {
    return vc().messages_.find((m) => m.id === ref) || vc().messages_.find((m) => m.name === ref);
  }
  function funcName(func) {
    try {
      const c = func.content;
      const def = c.getEventMap ? c.getEventMap('funcDef')[0] : null;
      if (def) {
        const label = def.params[0];
        if (label && label.params) return String(label.params[0]);
      }
    } catch (e) {}
    try {
      return Entry.block['func_' + func.id].template.split('%')[0].trim();
    } catch (e) {}
    return func.id;
  }
  M.funcName = funcName;
  function funcLabelChain(func) {
    // returns [{kind:'label'|'string'|'boolean', value|paramType}] from function definition
    const out = [];
    try {
      const def = func.content.getEventMap('funcDef')[0];
      let cur = def.params[0];
      while (cur) {
        if (cur.type === 'function_field_label') out.push({ kind: 'label', value: cur.params[0] });
        else if (cur.type === 'function_field_string') out.push({ kind: 'string', paramType: cur.params[0] && cur.params[0].type });
        else if (cur.type === 'function_field_boolean') out.push({ kind: 'boolean', paramType: cur.params[0] && cur.params[0].type });
        cur = cur.params[1];
      }
    } catch (e) {}
    return out;
  }
  function findFunction(ref) {
    const fs = vc().functions_;
    if (fs[ref]) return fs[ref];
    if (typeof ref === 'string' && ref.startsWith('func_') && fs[ref.slice(5)]) return fs[ref.slice(5)];
    return Object.values(fs).find((f) => funcName(f) === ref);
  }
  M.findFunction = findFunction;

  // ---------------------------------------------------------------- keyboard map
  const KEY_ALIASES = {
    space: 32, spacebar: 32, ' ': 32, '스페이스': 32, enter: 13, return: 13, '엔터': 13, tab: 9, shift: 16, ctrl: 17, control: 17, alt: 18, esc: 27, escape: 27,
    left: 37, arrowleft: 37, '왼쪽 화살표': 37, '왼쪽': 37, up: 38, arrowup: 38, '위쪽 화살표': 38, '위쪽': 38, right: 39, arrowright: 39, '오른쪽 화살표': 39, '오른쪽': 39,
    down: 40, arrowdown: 40, '아래쪽 화살표': 40, '아래쪽': 40, backspace: 8,
    ';': 186, '=': 187, ',': 188, '-': 189, '.': 190, '/': 191, '~': 192, '`': 192, '[': 219, '\\': 220, ']': 221, "'": 222,
  };
  M.keyCode = function (k) {
    if (k === null || k === undefined) return k;
    if (typeof k === 'number') return String(k);
    const s = String(k);
    if (/^\d{2,3}$/.test(s)) return s; // already a key code (two/three digits)
    const low = s.toLowerCase();
    if (KEY_ALIASES[low] !== undefined) return String(KEY_ALIASES[low]);
    if (KEY_ALIASES[s] !== undefined) return String(KEY_ALIASES[s]);
    if (/^[a-z]$/i.test(s)) return String(s.toUpperCase().charCodeAt(0));
    if (/^[0-9]$/.test(s)) return String(48 + Number(s));
    return s;
  };

  // ---------------------------------------------------------------- normalization (compact -> entry JSON)
  function hash() {
    return markedId(); // invisible watermark id (see "generative-AI watermark" below)
  }
  function cloneDefault(p) {
    if (p === null || p === undefined) return null;
    if (typeof p !== 'object') return p;
    const c = JSON.parse(JSON.stringify(p));
    (function strip(b) {
      if (!b || typeof b !== 'object') return;
      if (b.type) b.id = hash();
      (b.params || []).forEach(strip);
      (b.statements || []).forEach((s) => (s || []).forEach(strip));
    })(c);
    return c;
  }
  function resolveDynamic(menuName, value, ctx, blockType) {
    if (value === null || value === undefined) return value;
    const v = String(value);
    const objCtx = ctx.object;
    const m = typeof menuName === 'string' ? menuName : '';
    if (blockType === 'set_func_variable' || blockType === 'get_func_variable') {
      const fl = ctx.func && ctx.func.localVariables;
      if (fl) {
        const lv = fl.find((x) => x.id === v) || fl.find((x) => x.name === v);
        if (lv) return lv.id;
      }
      return v;
    }
    if (m === 'variables' || m === 'variablesWithSystem' || m === 'variablesWithoutSystem') {
      const x = findVariable(v, 'variable', objCtx);
      if (x) return x.id_;
      if (ctx.strict) ctx.warnings.push(`변수 "${v}"가 없습니다. (먼저 entry_data로 생성하세요)`);
      return v;
    }
    if (m === 'lists') {
      const x = findVariable(v, 'list', objCtx);
      if (x) return x.id_;
      if (ctx.strict) ctx.warnings.push(`리스트 "${v}"가 없습니다.`);
      return v;
    }
    if (m === 'messages') {
      const x = findMessage(v);
      if (x) return x.id;
      if (ctx.autoCreateMessages) {
        const msg = { id: hash(), name: v };
        vc().appendMessages([msg]);
        ctx.created.push('신호:' + v);
        return msg.id;
      }
      ctx.warnings.push(`신호 "${v}"가 없습니다.`);
      return v;
    }
    if (m === 'scenes') {
      const x = M.findScene(v, { optional: true });
      return x ? x.id : v;
    }
    if (m === 'pictures') {
      if (objCtx) {
        const p = objCtx.pictures.find((p) => p.id === v) || objCtx.pictures.find((p) => p.name === v);
        if (p) return p.id;
        ctx.warnings.push(`오브젝트 "${objCtx.name}"에 모양 "${v}"가 없습니다. 있는 모양: ${objCtx.pictures.map((p) => p.name).join(', ')}`);
      }
      return v;
    }
    if (m === 'sounds') {
      if (objCtx) {
        const s = objCtx.sounds.find((p) => p.id === v) || objCtx.sounds.find((p) => p.name === v);
        if (s) return s.id;
        ctx.warnings.push(`오브젝트 "${objCtx.name}"에 소리 "${v}"가 없습니다.`);
      }
      return v;
    }
    if (/sprite|collision|clone|object|textBox/i.test(m)) {
      const special = { mouse: 'mouse', 'mouse_pointer': 'mouse', '마우스포인터': 'mouse', self: 'self', '자신': 'self', wall: 'wall', '벽': 'wall', wall_up: 'wall_up', wall_down: 'wall_down', wall_left: 'wall_left', wall_right: 'wall_right' };
      if (special[v] !== undefined) {
        return special[v];
      }
      const o = M.findObject(v, { optional: true });
      if (o) return o.id;
      return v;
    }
    if (m === 'tables' || m === 'tableFields') return v;
    return v;
  }
  function resolveStaticDropdown(options, value) {
    if (!Array.isArray(options) || value === null || value === undefined) return value;
    const v = String(value);
    if (options.some((o) => Array.isArray(o) && String(o[1]) === v)) return value;
    const byLabel = options.find((o) => Array.isArray(o) && String(o[0]) === v);
    if (byLabel) return byLabel[1];
    const ci = options.find((o) => Array.isArray(o) && String(o[1]).toLowerCase() === v.toLowerCase());
    if (ci) return ci[1];
    return value;
  }

  function literalBlock(v, defParam, accept) {
    if (accept === 'boolean' || (defParam && (defParam.type === 'True' || defParam.type === 'False'))) {
      if (v === true || v === 'true' || v === 'True' || v === '참') return { id: hash(), type: 'True', params: [] };
      if (v === false || v === 'false' || v === 'False' || v === '거짓') return { id: hash(), type: 'False', params: [] };
    }
    const dt = defParam && defParam.type;
    const isNum = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)));
    if (dt === 'number' || dt === 'angle') {
      return { id: hash(), type: isNum ? dt : 'text', params: [isNum ? String(v) : String(v)] };
    }
    if (dt && !LITERAL_TYPES.has(dt) && Entry.block[dt]) {
      // e.g. get_pictures / get_sounds / text-like dropdown reporter blocks with one input
      const s = Entry.block[dt];
      const inputs = (s.params || []).map((p, i) => ({ p, i })).filter((x) => !NO_INPUT.has(x.p.type));
      if (inputs.length === 1 && inputs[0].p.type !== 'Block') {
        return { type: dt, params: [v] }; // will be normalized by caller
      }
    }
    return { id: hash(), type: isNum && dt !== 'text' ? 'number' : 'text', params: [String(v)] };
  }

  M.normalizeBlock = function normalizeBlock(input, ctx) {
    if (input === null || input === undefined) return null;
    if (typeof input === 'string') input = { type: input };
    if (Array.isArray(input)) fail('블록 자리에 배열이 왔습니다: ' + JSON.stringify(input).slice(0, 200));
    let b = Object.assign({}, input);

    // sugar: function call / function parameter / local variables
    if (b.type === 'call' || b.type === 'function' || b.type === 'call_function') {
      const fname = b.function || b.name;
      const f = findFunction(fname);
      if (!f) fail(`함수 "${fname}"가 없습니다. 먼저 entry_define_function으로 정의하세요.`);
      b = { type: 'func_' + f.id, params: b.params || b.args || [] };
    }
    if (b.type === 'param') {
      const pname = b.name || b.param;
      const pm = ctx.funcParams && ctx.funcParams[pname];
      if (!pm) fail(`함수 매개변수 "${pname}"는 함수 정의(entry_define_function) 본문 안에서만 쓸 수 있습니다.`);
      return { id: hash(), type: pm, params: [] };
    }
    if (b.type === 'local_get' || b.type === 'local_set') {
      const lv = ctx.func && ctx.func.localVariables && ctx.func.localVariables.find((x) => x.name === b.name || x.id === b.name);
      if (!lv) fail(`지역변수 "${b.name}"가 없습니다 (함수 정의에서 local_variables로 선언).`);
      if (b.type === 'local_get') b = { type: 'get_func_variable', params: [lv.id] };
      else b = { type: 'set_func_variable', params: [lv.id, b.value !== undefined ? b.value : (b.params || [])[0]] };
    }

    const schema = Entry.block[b.type];
    if (!schema) {
      const near = Object.keys(Entry.block).filter((k) => k.includes(String(b.type).slice(0, 6))).slice(0, 8);
      fail(`알 수 없는 블록 type "${b.type}". 비슷한 블록: ${near.join(', ')} (entry_block_reference로 검색)`);
    }
    const sp = schema.params || [];
    const defParams = (schema.def && schema.def.params) || [];
    const inputIdx = sp.map((p, i) => i).filter((i) => !NO_INPUT.has(sp[i].type));

    // collect params: array (positional, either full or input-only) or object keyed by paramsKeyMap
    let given = b.params !== undefined ? b.params : b.args;
    let full = new Array(sp.length).fill(undefined);
    if (given && !Array.isArray(given) && typeof given === 'object') {
      const map = schema.paramsKeyMap || {};
      Object.keys(given).forEach((k) => {
        if (map[k] !== undefined) full[map[k]] = given[k];
        else fail(`블록 ${b.type}: 알 수 없는 인자 키 "${k}" (가능: ${Object.keys(map).join(', ')})`);
      });
    } else if (Array.isArray(given)) {
      if (given.length <= inputIdx.length && !(given.length === sp.length && sp.length === inputIdx.length)) given.forEach((v, j) => (full[inputIdx[j]] = v));
      else if (given.length <= sp.length) given.forEach((v, j) => (full[j] = v)); // positional incl. indicator slots
      else fail(`블록 ${b.type}: 인자가 너무 많습니다 (${given.length}개, 입력 가능 ${inputIdx.length}개)`);
    }

    const out = { id: hash(), type: b.type, params: [], statements: [] };
    for (let i = 0; i < sp.length; i++) {
      const ps = sp[i];
      let v = full[i];
      if (NO_INPUT.has(ps.type)) {
        out.params.push(null);
        continue;
      }
      if (v === undefined) {
        out.params.push(cloneDefault(defParams[i] !== undefined ? defParams[i] : ps.value !== undefined ? ps.value : null));
        continue;
      }
      if (ps.type === 'Block' || ps.type === 'Output') {
        if (v === null) out.params.push(null);
        else if (typeof v === 'object' && !Array.isArray(v)) out.params.push(normalizeBlock(v, ctx));
        else {
          const lit = literalBlock(v, defParams[i], ps.accept);
          out.params.push(lit.id ? lit : normalizeBlock(lit, ctx));
        }
        continue;
      }
      if (ps.type === 'Keyboard') {
        out.params.push(M.keyCode(v));
        continue;
      }
      if (ps.type === 'DropdownDynamic' || ps.type === 'DropdownExtra') {
        out.params.push(resolveDynamic(ps.menuName, v, ctx, b.type));
        continue;
      }
      if (ps.type === 'Dropdown') {
        out.params.push(resolveStaticDropdown(ps.options, v));
        continue;
      }
      if (ps.type === 'Color') {
        out.params.push(String(v));
        continue;
      }
      if (ps.type === 'Angle') {
        out.params.push(String(v));
        continue;
      }
      out.params.push(v);
    }

    // statements
    const nStat = (schema.statements || []).length;
    let st = b.statements;
    if (st === undefined && (b.do || b.then || b.else || b.body)) st = [b.do || b.then || b.body || [], b.else || []];
    if (st && st.length && !Array.isArray(st[0])) st = [st];
    st = st || [];
    for (let i = 0; i < nStat; i++) {
      const arr = st[i] || [];
      out.statements.push(arr.map((x) => normalizeBlock(x, ctx)).filter(Boolean));
    }
    if (st.length > nStat && st.slice(nStat).some((a) => a && a.length)) fail(`블록 ${b.type}는 statements를 ${nStat}개까지만 가집니다.`);
    if (b.x !== undefined) out.x = b.x;
    if (b.y !== undefined) out.y = b.y;
    ctx.count++;
    return out;
  };

  M.normalizeThreads = function (threads, ctx) {
    if (!Array.isArray(threads)) fail('script는 스레드 배열이어야 합니다: [[블록, 블록...], [블록...]]');
    if (threads.length && !Array.isArray(threads[0])) threads = [threads];
    return threads.map((t) => t.map((b) => M.normalizeBlock(b, ctx)).filter(Boolean)).filter((t) => t.length);
  };

  // ---------------------------------------------------------------- compact output (entry JSON -> compact)
  function blockName(b) {
    return b && b.type;
  }
  M.compactBlock = function compactBlock(b, ctx) {
    if (!b) return null;
    if (b.toJSON && !(b.type && Array.isArray(b.params) && !b.data)) b = b.toJSON();
    const schema = Entry.block[b.type];
    if (!schema) return { type: b.type, params: b.params };
    if (LITERAL_TYPES.has(b.type)) return b.params[0];
    if (b.type === 'True') return true;
    if (b.type === 'False') return false;
    if (/^stringParam_|^booleanParam_/.test(b.type)) {
      const n = ctx.paramNames && ctx.paramNames[b.type];
      return { type: 'param', name: n || b.type };
    }
    const sp = schema.params || [];
    const params = [];
    for (let i = 0; i < sp.length; i++) {
      const ps = sp[i];
      if (NO_INPUT.has(ps.type)) continue;
      const v = b.params[i];
      if (v && typeof v === 'object' && v.type) {
        // collapse single-dropdown reporter blocks like get_pictures
        const def = schema.def && schema.def.params && schema.def.params[i];
        const s2 = Entry.block[v.type];
        if (def && def.type === v.type && !LITERAL_TYPES.has(v.type) && s2) {
          const ins = (s2.params || []).map((p, k) => ({ p, k })).filter((x) => !NO_INPUT.has(x.p.type));
          if (ins.length === 1 && ins[0].p.type !== 'Block') {
            params.push(dynName(ins[0].p, v.params[ins[0].k], ctx, v.type));
            continue;
          }
        }
        params.push(compactBlock(v, ctx));
      } else params.push(dynName(ps, v, ctx, b.type));
    }
    const out = { type: b.type };
    if (/^func_/.test(b.type)) {
      const f = vc().functions_[b.type.slice(5)];
      out.type = 'call';
      out.function = f ? funcName(f) : b.type;
    }
    if (b.type === 'get_func_variable' || b.type === 'set_func_variable') {
      const lvs = (ctx.func && ctx.func.localVariables) || [];
      const lv = lvs.find((x) => x.id === b.params[0]);
      if (lv) params[0] = lv.name;
    }
    while (params.length && (params[params.length - 1] === null || params[params.length - 1] === undefined)) params.pop();
    if (params.length) out.params = params;
    const nStat = (schema.statements || []).length;
    if (nStat && b.statements) {
      out.statements = b.statements.map((s) => (s || []).map((x) => compactBlock(x, ctx)));
    }
    return out;
  };
  function dynName(ps, v, ctx, blockType) {
    if (v === null || v === undefined) return v;
    if (ps.type === 'Keyboard') {
      const opt = (ps.options || []).find((o) => String(o[1]) === String(v));
      const code = Number(v);
      if (code >= 65 && code <= 90) return String.fromCharCode(code).toLowerCase();
      if (code >= 48 && code <= 57) return String(code - 48);
      const rev = { 32: 'space', 13: 'enter', 37: 'left', 38: 'up', 39: 'right', 40: 'down', 9: 'tab', 16: 'shift', 17: 'ctrl', 18: 'alt', 27: 'esc' };
      return rev[code] || (opt ? opt[0] : v);
    }
    if (ps.type !== 'DropdownDynamic') return v;
    const m = typeof ps.menuName === 'string' ? ps.menuName : '';
    const sv = String(v);
    if (/^variables/.test(m)) {
      const x = vc().variables_.find((q) => q.id_ === sv);
      return x ? x.name_ : v;
    }
    if (m === 'lists') {
      const x = vc().lists_.find((q) => q.id_ === sv);
      return x ? x.name_ : v;
    }
    if (m === 'messages') {
      const x = findMessage(sv);
      return x ? x.name : v;
    }
    if (m === 'scenes') {
      const x = M.findScene(sv, { optional: true });
      return x ? x.name : v;
    }
    if (m === 'pictures' && ctx.object) {
      const p = ctx.object.pictures.find((p) => p.id === sv);
      return p ? p.name : v;
    }
    if (m === 'sounds' && ctx.object) {
      const p = ctx.object.sounds.find((p) => p.id === sv);
      return p ? p.name : v;
    }
    if (/sprite|collision|clone|object|textBox/i.test(m)) {
      const o = allObjects().find((o) => o.id === sv);
      return o ? o.name : v;
    }
    return v;
  }

  M.compactScript = function (obj) {
    const json = obj.script.toJSON ? obj.script.toJSON() : JSON.parse(obj.script.stringify ? obj.script.stringify() : '[]');
    const ctx = { object: obj };
    return json.filter((t) => !isCommentThread(t)).map((t) => t.map((b) => M.compactBlock(b, ctx)));
  };

  // ---------------------------------------------------------------- Python <-> blocks
  M.pythonToThreads = function (code, obj) {
    if (obj) Entry.container.selectObject(obj.id);
    // keep line numbers: replace import lines by blank lines
    const lines = String(code).replace(/\r\n/g, '\n').replace(/\t/g, '    ').split('\n').map((l) => (/^\s*(import|from)\s+\w+/.test(l) ? '' : l));
    const header = '# ' + (obj ? obj.name : 'object') + '\n\nimport Entry\n\n';
    const text = header + lines.join('\n') + '\n';
    // Entry converts a variable that is read before its first assignment (in parse order) into a
    // string literal, and fails inside functions. Pre-declare every assigned name as a (hidden) global.
    const params = new Set();
    lines.forEach((l) => {
      const m = l.match(/^\s*def\s+[^\s(]+\s*\(([^)]*)\)/);
      if (m) m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => params.add(s));
    });
    const V = vc();
    const assigned = new Set();
    lines.forEach((l) => {
      const m = l.match(/^\s*([\p{L}_][\p{L}\p{N}_]*)\s*(?:[+\-*/%]|\/\/|\*\*)?=(?!=)/u);
      if (m && !params.has(m[1])) assigned.add(m[1]);
    });
    const newVars = [...assigned].filter((n) => !V.variables_.some((v) => v.name_ === n) && !V.lists_.some((v) => v.name_ === n));
    if (newVars.length) {
      V.appendVariables(newVars.map((n) => ({ name: n, id: hash(), variableType: 'variable', value: 0, visible: false, object: null })));
    }
    // Entry's converter fails on calls to a user function that does not exist yet
    // (recursion / forward references). Pre-create stubs for new user functions first.
    try {
      const existingFns = new Set(Object.values(vc().functions_).map((f) => funcName(f)));
      const stubs = [];
      lines.forEach((l) => {
        const m = l.match(/^def\s+([^\s(]+)\s*\(([^)]*)\)\s*:/);
        if (m && !/^when_/.test(m[1]) && !existingFns.has(m[1])) stubs.push(`def ${m[1]}(${m[2]}):\n    Entry.wait_for_sec(0)\n`);
      });
      if (stubs.length) {
        const p0 = new Entry.Parser(null);
        p0.setParser(Entry.Vim.WORKSPACE_MODE, Entry.Vim.PARSER_TYPE_PY_TO_BLOCK);
        const g0 = new Entry.PyAstGenerator();
        const a0 = p0.makeThreads(header + stubs.join('\n') + '\n').map((t) => t.length && g0.generate(t)).filter((a) => a && a.body.length);
        p0._execParser.Programs(a0);
      }
    } catch (e) {}
    const p = new Entry.Parser(null);
    p.setParser(Entry.Vim.WORKSPACE_MODE, Entry.Vim.PARSER_TYPE_PY_TO_BLOCK);
    const threads = p.makeThreads(text);
    // where does each thread start in the user's code? (for error line numbers)
    const starts = [];
    const firstContent = [];
    let pos = 0;
    threads.forEach((t, k) => {
      const tl = t.split('\n');
      const f = tl.findIndex((x) => x.trim() !== '');
      firstContent[k] = f;
      if (f < 0) {
        starts[k] = pos;
        return;
      }
      let u = lines.indexOf(tl[f], pos);
      if (u < 0) u = pos;
      starts[k] = u;
      pos = u + 1;
    });
    const toUserLine = (k, t) => (k === undefined || firstContent[k] < 0 ? undefined : starts[k] + (t - 1 - firstContent[k]) + 1);
    const gen = new Entry.PyAstGenerator();
    const asts = [];
    const astThread = new Map();
    let curThread;
    const ep = p._execParser;
    const origNode = ep.Node;
    ep.Node = function (node) {
      if (astThread.has(node)) curThread = astThread.get(node);
      return origNode.apply(this, arguments);
    };
    try {
      for (let k = 0; k < threads.length; k++) {
        const t = threads[k];
        if (!t.length) continue;
        curThread = k;
        const a = gen.generate(t);
        if (a && a.body.length) {
          asts.push(a);
          astThread.set(a, k);
        }
      }
      curThread = undefined;
      return ep.Programs(asts);
    } catch (e) {
      let line;
      try {
        if (e && e.loc && e.loc.line) line = toUserLine(curThread, e.loc.line);
        else if (e && e.line && e.line.start) line = toUserLine(curThread, e.line.start.line);
        if (line !== undefined && (line < 1 || line > lines.length + 1)) line = undefined;
      } catch (x) {}
      const msg = [e.title, e.subject && '[' + e.subject + ']', e.keyword && "'" + e.keyword + "'", e.message].filter(Boolean).join(' ');
      fail('파이썬 변환 오류' + (line !== undefined ? ` (line ${line})` : '') + ': ' + msg + (line !== undefined && lines[line - 1] !== undefined ? '\n> ' + lines[line - 1] : ''));
    }
  };

  M.threadsToPython = function (obj, threadsJson) {
    Entry.container.selectObject(obj.id);
    const p = new Entry.Parser(null);
    p.setParser(Entry.Vim.WORKSPACE_MODE, Entry.Vim.PARSER_TYPE_BLOCK_TO_PY);
    let code = obj.script;
    if (threadsJson) code = new Entry.Code(threadsJson.filter((t) => !isCommentThread(t)), obj);
    else if (obj.script.toJSON().some(isCommentThread)) code = new Entry.Code(obj.script.toJSON().filter((t) => !isCommentThread(t)), obj);
    return p.parse(code, Entry.Parser.PARSE_GENERAL);
  };

  // Entry-Python uses different names than the block values for some dropdowns
  // (e.g. python "mouse_pointer" == block "mouse", python "edge" == block "wall").
  // Writing the block value in python yields an invalid block value; fix it via Entry.CodeMap.
  const DYN_SPECIAL = new Set(['mouse', 'self', 'wall', 'wall_up', 'wall_down', 'wall_left', 'wall_right', 'null', 'next', 'prev']);
  function fixPyValues(blocks, warnings) {
    (blocks || []).forEach(function fix(b) {
      if (!b || typeof b !== 'object') return;
      const schema = Entry.block[b.type];
      const cm = Entry.CodeMap && Entry.CodeMap.Entry && Entry.CodeMap.Entry[b.type];
      (b.params || []).forEach((v, i) => {
        if (v && typeof v === 'object') return fix(v);
        if (typeof v !== 'string' || !schema || !cm || !cm[i]) return;
        const ps = (schema.params || [])[i] || {};
        let valid = true;
        if (ps.type === 'Dropdown') valid = (ps.options || []).some((o) => Array.isArray(o) && String(o[1]) === v);
        else if (ps.type === 'DropdownDynamic') valid = DYN_SPECIAL.has(v) || allObjects().some((o) => o.id === v) || scenes().some((s) => s.id === v);
        if (!valid && cm[i][v] !== undefined) {
          b.params[i] = cm[i][v];
          warnings.push(`${b.type}: 파이썬 값 "${v}"를 블록 값 "${cm[i][v]}"로 자동 보정 (엔트리파이썬에서는 해당 이름 표기를 확인하세요)`);
        }
      });
      (b.statements || []).forEach((s) => (s || []).forEach(fix));
    });
  }

  // ---------------------------------------------------------------- generative-AI watermark
  // Every project touched through this MCP is marked without anything visible on the stage or code board:
  //  1) (removed: visible memo) – old memos are cleaned up when a script is rewritten or the project is saved,
  //  2) a hidden global variable describing the AI involvement (first/last edit date),
  //  3) an invisible pattern: every block / object / variable / list / message / function / picture the MCP
  //     creates gets a 6-char id whose char-code sum % 31 === 7
  //     (Entry's own ids are 4 chars, so they never match; ids survive save/load and moving blocks).
  const WM = { tag: '[생성형 AI 사용 표시]', varName: 'AI_생성_표시', mod: 31, rem: 7 };
  const ID_CH = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const idSum = (id) => [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const isMarkedId = (id) => typeof id === 'string' && id.length === 6 && idSum(id) % WM.mod === WM.rem;
  function markedId() {
    for (;;) {
      let id = '';
      for (let i = 0; i < 6; i++) id += ID_CH[Math.floor(Math.random() * ID_CH.length)];
      if (isMarkedId(id)) return id;
    }
  }
  // give every block (incl. nested value blocks) in thread JSON a watermark id
  function markIds(x) {
    if (Array.isArray(x)) return x.forEach(markIds);
    if (!x || typeof x !== 'object') return;
    if (typeof x.type === 'string' && x.type !== 'comment') x.id = markedId();
    markIds(x.params);
    markIds(x.statements);
  }
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const isMemoThread = (t) => !!(t && t[0] && t[0].type === 'comment' && String(t[0].value || '').includes(WM.tag));
  const isCommentThread = (t) => !!(t && t[0] && t[0].type === 'comment');
  M.ensureWatermarkVar = function () {
    const V = vc();
    let v = V.variables_.find((x) => x.name_ === WM.varName && !x.object_);
    const first = v ? (String(v.getValue ? v.getValue() : v.value_).match(/처음 (\d{4}-\d{2}-\d{2})/) || [])[1] : null;
    const text = `이 작품은 Entry MCP(entry-offline-mcp)를 통해 생성형 AI가 제작·편집에 참여했습니다 · 처음 ${first || today()} · 최근 ${today()}`;
    if (!v) {
      V.appendVariables([{ name: WM.varName, id: hash(), variableType: 'variable', value: text, visible: false, object: null }]);
      try { V.updateList(); } catch (e) {}
    } else if (v.setValue) v.setValue(text);
    return text;
  };
  // remove memos left by older versions of this MCP
  M.removeMemos = function () {
    let removed = 0;
    allObjects().forEach((o) => {
      let json;
      try { json = o.script.toJSON(); } catch (e) { return; }
      const keep = json.filter((t) => !isMemoThread(t));
      if (keep.length !== json.length) { removed += json.length - keep.length; o.script.load(keep); }
    });
    return removed;
  };
  M.watermarkInfo = function () {
    const V = vc();
    let memos = 0, blocks = 0, patternBlocks = 0;
    const walk = (x) => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (!x || typeof x !== 'object') return;
      if (typeof x.type === 'string' && x.type !== 'comment' && x.id) { blocks++; if (isMarkedId(x.id)) patternBlocks++; }
      walk(x.params);
      walk(x.statements);
    };
    const codes = allObjects().map((o) => o.script);
    Object.values(V.functions_).forEach((f) => f.content && codes.push(f.content));
    codes.forEach((code) => {
      let json = [];
      try { json = code.toJSON(); } catch (e) {}
      json.forEach((t) => { if (isMemoThread(t)) memos++; else walk(t); });
    });
    const ents = [].concat(allObjects().map((o) => o.id), V.variables_.map((x) => x.id_), V.lists_.map((x) => x.id_), V.messages_.map((x) => x.id), Object.keys(V.functions_));
    allObjects().forEach((o) => (o.pictures || []).forEach((p) => ents.push(p.id)));
    const markedEntities = ents.filter(isMarkedId).length;
    const ratio = blocks ? patternBlocks / blocks : 0;
    const v = V.variables_.find((x) => x.name_ === WM.varName && !x.object_);
    const patternDetected = patternBlocks > 0 || markedEntities > 0;
    return { marked: !!(v || patternDetected), variable: v ? (v.getValue ? v.getValue() : v.value_) : null, patternBlocks, blocks, patternRatio: Math.round(ratio * 100) / 100, markedEntities, patternDetected, oldMemos: memos };
  };

  // ---------------------------------------------------------------- script set
  function layoutThreads(threads) {
    let y = 40;
    threads.forEach((t, i) => {
      if (!t[0]) return;
      if (t[0].x === undefined) t[0].x = 40;
      if (t[0].y === undefined) {
        t[0].y = y;
      }
      y = (t[0].y || y) + 40 + countBlocks(t) * 34;
    });
    return threads;
  }
  function countBlocks(arr) {
    let n = 0;
    (arr || []).forEach((b) => {
      if (!b) return;
      n++;
      (b.statements || []).forEach((s) => (n += countBlocks(s) + 1));
    });
    return n;
  }

  M.ensureStopped = async function () {
    if (Entry.engine.isState('run') || Entry.engine.isState('pause')) {
      Entry.engine.toggleStop();
      for (let i = 0; i < 30 && !Entry.engine.isState('stop'); i++) await sleep(100);
      await sleep(200);
    }
  };

  M.setScript = async function ({ object, blocks, python, mode }) {
    await M.ensureStopped();
    const obj = M.findObject(object);
    Entry.container.selectObject(obj.id);
    await sleep(50);
    const ctx = { object: obj, warnings: [], created: [], count: 0, autoCreateMessages: true, strict: true };
    const dataNames = () => new Set([...vc().variables_.map((v) => '변수:' + v.name_), ...vc().lists_.map((v) => '리스트:' + v.name_), ...vc().messages_.map((m) => '신호:' + m.name), ...Object.values(vc().functions_).map((f) => '함수:' + funcName(f))]);
    const beforeNames = dataNames();
    const beforeVars = beforeNames.size;
    let threads;
    if (python !== undefined && python !== null) {
      // Entry's own parser output is already in Entry's native format – load as-is.
      const V = vc();
      const before = { v: new Set(V.variables_.map((x) => x.id_)), l: new Set(V.lists_.map((x) => x.id_)), f: new Set(Object.keys(V.functions_)) };
      const rollback = () => {
        try {
          V.variables_.filter((x) => !before.v.has(x.id_)).forEach((x) => V.removeVariable(x));
          V.lists_.filter((x) => !before.l.has(x.id_)).forEach((x) => V.removeList(x));
          Object.keys(V.functions_).filter((id) => !before.f.has(id)).forEach((id) => V.removeFunction({ id }));
        } catch (e) {}
      };
      try {
        threads = M.pythonToThreads(python, obj);
        const bad = JSON.stringify(threads).includes('__pythonRuntime');
        // a variable that is only read (never declared) silently becomes a text literal
        const stripped = String(python).replace(/#.*$/gm, '').replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
        const idents = new Set(stripped.match(/[\p{L}_][\p{L}\p{N}_]*/gu) || []);
        const undeclared = new Set();
        (function walk(x) {
          if (Array.isArray(x)) return x.forEach(walk);
          if (!x || typeof x !== 'object') return;
          if (x.type === 'text' && typeof (x.params || [])[0] === 'string' && idents.has(x.params[0]) && !V.variables_.some((v) => v.name_ === x.params[0]) && !V.lists_.some((v) => v.name_ === x.params[0])) undeclared.add(x.params[0]);
          walk(x.params);
          walk(x.statements);
        })(threads);
        if (undeclared.size) fail(`파이썬 변환 오류: 선언되지 않은 변수 ${[...undeclared].map((n) => "'" + n + "'").join(', ')} — 엔트리가 문자열로 바꿔버립니다. 이 코드에서 값을 대입하거나(예: 이름 = 0) entry_data로 먼저 만들거나, 그 변수를 대입하는 오브젝트의 스크립트를 먼저 설정하세요.`);
        if (bad) fail('파이썬 변환 오류: 리스트 리터럴([...])은 엔트리파이썬이 지원하지 않습니다 (변수에 쓰레기 값이 들어감). 리스트는 entry_data {kind:"list", action:"add", items:[...]}로 먼저 만들고, 코드에서는 목록.append(x) / 목록[i] / 목록[i] = x 로 다루세요.');
      } catch (e) {
        rollback();
        throw e;
      }
      threads.forEach((t) => fixPyValues(t, ctx.warnings));
      ctx.count = countBlocks([].concat(...threads.map((t) => t || [])));
    } else {
      threads = M.normalizeThreads(blocks || [], ctx);
    }
    let existing = [];
    if (mode === 'append') existing = obj.script.toJSON().filter((t) => !isMemoThread(t));
    markIds(threads);
    const all = existing.concat(layoutThreads(threads));
    obj.script.load(all);
    M.ensureWatermarkVar();
    // refresh board if this object is shown
    await M.refreshBoard(obj);
    const afterNames = dataNames();
    afterNames.forEach((n) => {
      if (!beforeNames.has(n) && !ctx.created.includes(n)) ctx.created.push(n);
    });
    if (afterNames.size !== beforeVars) {
      vc().updateList();
    }
    return { object: obj.name, threads: threads.length, blocks: ctx.count, totalThreads: obj.script.getThreads().length, warnings: ctx.warnings, created: ctx.created };
  };

  M.refreshBoard = async function (obj) {
    try {
      const ws = Entry.getMainWS();
      if (!ws) return;
      if (Entry.playground.object !== obj) Entry.container.selectObject(obj.id);
      if (ws.getMode && ws.getMode() === Entry.Workspace.MODE_VIMBOARD) {
        // re-render python text
        Entry.playground.injectObject && Entry.playground.injectObject(obj);
        try {
          ws.codeToText(obj.script, ws.mode === undefined ? undefined : { textType: Entry.Vim.TEXT_TYPE_PY, runType: Entry.Vim.WORKSPACE_MODE, boardType: Entry.Workspace.MODE_VIMBOARD });
        } catch (e) {}
      } else {
        ws.changeBoardCode(obj.script);
        await sleep(30);
        try {
          obj.script.view && obj.script.view.reDraw();
          ws.board.alignThreads && ws.board.alignThreads();
        } catch (e) {}
      }
    } catch (e) {}
  };

  // ---------------------------------------------------------------- functions
  M.defineFunction = async function ({ name, params, kind, body, python, returnValue, localVariables, replace }) {
    await M.ensureStopped();
    M.ensureWatermarkVar();
    if (!name) fail('name이 필요합니다.');
    const existing = findFunction(name);
    if (existing) {
      if (replace === false) fail(`함수 "${name}"가 이미 있습니다.`);
      vc().removeFunction({ id: existing.id });
    }
    const funcId = existing ? existing.id : hash();
    const pList = params || [];
    const paramTypes = {};
    // build label chain from the end
    let chain = null;
    const chainParts = [{ kind: 'label', value: name }].concat(
      pList.map((p) => (typeof p === 'string' ? { kind: 'string', name: p } : p.label ? { kind: 'label', value: p.label } : { kind: p.type === 'boolean' ? 'boolean' : 'string', name: p.name }))
    );
    const pblocks = chainParts.map((cp) => {
      if (cp.kind === 'label') return null;
      const t = (cp.kind === 'boolean' ? 'booleanParam_' : 'stringParam_') + hash();
      paramTypes[cp.name] = t;
      return t;
    });
    for (let i = chainParts.length - 1; i >= 0; i--) {
      const cp = chainParts[i];
      if (cp.kind === 'label') chain = { id: hash(), type: 'function_field_label', params: [String(cp.value), chain] };
      else chain = { id: hash(), type: cp.kind === 'boolean' ? 'function_field_boolean' : 'function_field_string', params: [{ id: hash(), type: pblocks[i], params: [] }, chain] };
    }
    const lvs = (localVariables || []).map((lv) => (typeof lv === 'string' ? { name: lv, value: 0 } : lv)).map((lv) => ({ name: lv.name, value: lv.value !== undefined ? lv.value : 0, id: funcId + '_' + hash() }));
    const fctx = { object: Entry.playground.object, warnings: [], created: [], count: 0, autoCreateMessages: true, strict: true, funcParams: paramTypes, func: { localVariables: lvs } };
    // Param schemas don't exist until the function is registered, so register temporarily with empty body first.
    const isValue = kind === 'value';
    const header = isValue
      ? { id: hash(), type: 'function_create_value', params: [chain, null, null, { id: hash(), type: 'text', params: [''] }], statements: [[]], x: 40, y: 40 }
      : { id: hash(), type: 'function_create', params: [chain, null], statements: [[]], x: 40, y: 40 };
    const funcJson = { id: funcId, type: isValue ? 'value' : 'normal', localVariables: lvs, useLocalVariables: lvs.length > 0, content: JSON.stringify([[header]]) };
    vc().appendFunctions([funcJson]);
    // now param block schemas exist -> normalize body
    let bodyThreads;
    if (python) {
      fail('함수 본문은 blocks(JSON)로 지정하세요. (파이썬으로 함수를 만들려면 entry_set_script의 python 코드 안에 def 함수를 작성하면 자동 생성됩니다)');
    }
    bodyThreads = (body || []).map((b) => M.normalizeBlock(b, fctx));
    header.statements = [bodyThreads];
    if (isValue) {
      const rv = returnValue === undefined ? '' : returnValue;
      header.params[3] = typeof rv === 'object' && rv !== null ? M.normalizeBlock(rv, fctx) : literalBlock(rv, { type: 'text' });
      if (!header.params[3].id) header.params[3] = M.normalizeBlock(header.params[3], fctx);
    }
    vc().removeFunction({ id: funcId });
    funcJson.content = JSON.stringify([[header]]);
    vc().appendFunctions([funcJson]);
    vc().updateList();
    try {
      Entry.playground.blockMenu && Entry.playground.blockMenu.deleteRendered && Entry.playground.blockMenu.deleteRendered('func');
      Entry.playground.reloadPlayground();
    } catch (e) {}
    return { id: funcId, name, kind: isValue ? 'value' : 'normal', blockType: 'func_' + funcId, params: Object.keys(paramTypes), blocks: fctx.count, warnings: fctx.warnings };
  };

  M.functionInfo = function (f, withBody) {
    const chain = funcLabelChain(f);
    const info = { id: f.id, name: funcName(f), kind: f.type || 'normal', blockType: 'func_' + f.id, signature: chain.map((c) => (c.kind === 'label' ? c.value : '(' + c.kind + ')')).join(' '), localVariables: (f.localVariables || []).map((x) => x.name) };
    if (withBody) {
      try {
        const def = f.content.getEventMap('funcDef')[0];
        const js = def.toJSON();
        const paramNames = {};
        let idx = 0;
        let cur = js.params[0];
        while (cur) {
          if (cur.type !== 'function_field_label' && cur.params[0]) paramNames[cur.params[0].type] = 'param' + ++idx;
          cur = cur.params[1];
        }
        const ctx = { paramNames, func: f, object: Entry.playground.object };
        info.body = (js.statements[0] || []).map((b) => M.compactBlock(b, ctx));
        if (js.type === 'function_create_value') info.returnValue = M.compactBlock(js.params[3], ctx);
      } catch (e) {
        info.bodyError = e.message;
      }
    }
    return info;
  };

  // ---------------------------------------------------------------- summary
  M.objectInfo = function (o, opts) {
    const e = o.entity;
    const info = {
      id: o.id,
      name: o.name,
      type: o.objectType,
      scene: o.scene && o.scene.name,
      x: round(e.getX()),
      y: round(e.getY()),
      size: round(e.getSize()),
      rotation: round(e.getRotation()),
      direction: round(e.getDirection()),
      visible: e.getVisible(),
      rotateMethod: o.getRotateMethod(),
      locked: o.getLock ? o.getLock() : undefined,
      layer: Entry.container.getCurrentObjects().indexOf(o),
    };
    if (o.objectType === 'textBox') {
      info.text = e.getText();
      info.font = e.getFont && e.getFont();
      info.color = e.getColour();
      info.bgColor = e.getBGColour();
    } else {
      info.pictures = o.pictures.map((p) => p.name);
      info.currentPicture = o.selectedPicture && o.selectedPicture.name;
      info.width = round(e.getWidth() * e.getScaleX());
      info.height = round(e.getHeight() * e.getScaleY());
    }
    info.sounds = o.sounds.map((s) => s.name);
    const threads = o.script.getThreads ? o.script.getThreads() : [];
    info.scriptThreads = threads.length;
    info.scriptBlocks = o.script.getBlockList ? o.script.getBlockList().length : undefined;
    if (opts && opts.scripts === 'blocks') info.script = M.compactScript(o);
    if (opts && opts.scripts === 'python') {
      try {
        info.python = M.threadsToPython(o);
      } catch (err) {
        info.python = '# (파이썬 변환 불가: ' + err.message + ')';
      }
    }
    return info;
  };
  function round(n) {
    return typeof n === 'number' ? Math.round(n * 100) / 100 : n;
  }

  M.summary = function (opts) {
    opts = opts || {};
    const ws = M.ws();
    const mws = Entry.getMainWS();
    const sel = Entry.playground.object;
    const res = {
      projectName: ws && ws._getProjectName ? ws._getProjectName() : undefined,
      codingMode: mws && mws.getMode && mws.getMode() === Entry.Workspace.MODE_VIMBOARD ? 'python' : 'block',
      engine: Entry.engine.state,
      selectedObject: sel ? sel.name : null,
      currentScene: Entry.scene.selectedScene && Entry.scene.selectedScene.name,
      stage: { width: 480, height: 270, xRange: [-240, 240], yRange: [-135, 135] },
      scenes: scenes().map((s) => ({ id: s.id, name: s.name, objects: Entry.container.getSceneObjects(s).map((o) => (opts.brief ? o.name : M.objectInfo(o, opts))) })),
      variables: vc().variables_.map((v) => ({ name: v.name_, id: v.id_, type: v.type, scope: v.object_ ? 'local:' + ((M.findObject(v.object_, { optional: true }) || {}).name || v.object_) : 'global', value: v.getValue ? v.getValue() : v.value_, visible: v.isVisible ? v.isVisible() : v.visible_ })),
      lists: vc().lists_.map((v) => ({ name: v.name_, id: v.id_, scope: v.object_ ? 'local:' + ((M.findObject(v.object_, { optional: true }) || {}).name || v.object_) : 'global', items: (v.array_ || []).map((x) => x.data).slice(0, 50), length: (v.array_ || []).length, visible: v.isVisible ? v.isVisible() : v.visible_ })),
      messages: vc().messages_.map((m) => ({ name: m.name, id: m.id })),
      functions: Object.values(vc().functions_).map((f) => M.functionInfo(f, opts.scripts === 'blocks')),
      aiWatermark: M.watermarkInfo(),
    };
    if (sel && Entry.playground.object !== sel) {
      try {
        Entry.container.selectObject(sel.id);
      } catch (e) {}
    }
    return res;
  };

  // ---------------------------------------------------------------- objects
  M.applyObjectProps = async function (o, p) {
    const e = o.entity;
    if (p.name !== undefined) o.setName(String(p.name));
    if (p.picture !== undefined && o.objectType !== 'textBox') {
      const pic = o.pictures.find((x) => x.id === p.picture || x.name === p.picture) || (typeof p.picture === 'number' ? o.pictures[p.picture] : null);
      if (!pic) fail(`모양 "${p.picture}"가 없습니다. 있는 모양: ${o.pictures.map((x) => x.name).join(', ')}`);
      o.selectPicture(pic.id);
      Entry.playground.object === o && Entry.playground.selectPicture && Entry.playground.selectPicture(pic);
    }
    if (p.x !== undefined) e.setX(Number(p.x));
    if (p.y !== undefined) e.setY(Number(p.y));
    if (p.size !== undefined) e.setSize(Number(p.size));
    if (p.scale !== undefined) {
      e.setScaleX(Number(p.scale));
      e.setScaleY(Number(p.scale));
    }
    if (p.scaleX !== undefined) e.setScaleX(Number(p.scaleX));
    if (p.scaleY !== undefined) e.setScaleY(Number(p.scaleY));
    if (p.width !== undefined && o.objectType === 'textBox') e.setWidth(Number(p.width));
    if (p.height !== undefined && o.objectType === 'textBox') e.setHeight(Number(p.height));
    if (p.rotation !== undefined) e.setRotation(Number(p.rotation));
    if (p.direction !== undefined) e.setDirection(Number(p.direction));
    if (p.visible !== undefined) e.setVisible(!!p.visible);
    if (p.rotateMethod !== undefined) {
      const rm = { free: 'free', all: 'free', vertical: 'vertical', horizontal: 'vertical', leftright: 'vertical', none: 'none' }[String(p.rotateMethod).toLowerCase()] || p.rotateMethod;
      o.setRotateMethod(rm);
    }
    if (p.locked !== undefined) o.setLock(!!p.locked);
    if (o.objectType === 'textBox') {
      if (p.text !== undefined) {
        e.setText(String(p.text));
        o.setText && o.setText(String(p.text));
      }
      if (p.fontSize !== undefined) e.setFontSize(Number(p.fontSize));
      if (p.fontFamily !== undefined) e.setFontType(String(p.fontFamily));
      if (p.bold !== undefined) e.setFontBold(!!p.bold);
      if (p.italic !== undefined) e.setFontItalic(!!p.italic);
      if (p.underline !== undefined) e.setUnderLine(!!p.underline);
      if (p.strike !== undefined) e.setStrike(!!p.strike);
      if (p.color !== undefined) e.setColour(String(p.color));
      if (p.bgColor !== undefined) e.setBGColour(String(p.bgColor));
      if (p.lineBreak !== undefined) e.setLineBreak(!!p.lineBreak);
      // Entry's own constants: TEXT_ALIGN_CENTER = 0, TEXT_ALIGN_LEFT = 1, TEXT_ALIGN_RIGHT = 2
      if (p.textAlign !== undefined) {
        const alignMap = { left: 1, center: 0, right: 2 };
        e.setTextAlign(alignMap[p.textAlign] !== undefined ? alignMap[p.textAlign] : Number(p.textAlign));
      }
    }
    if (p.layer !== undefined) M.setLayer(o, p.layer);
    try {
      o.updateCoordinateView && o.updateCoordinateView();
      o.updateRotationView && o.updateRotationView();
      o.updateThumbnailView && o.updateThumbnailView();
      Entry.playground.object === o && Entry.playground.injectObject && Entry.playground.injectObject(o);
    } catch (err) {}
    Entry.stage.updateObject && Entry.stage.updateObject();
    Entry.stage.update();
    Entry.requestUpdate = true;
  };

  M.updateObject = async function (ref, props) {
    await M.ensureStopped();
    const o = M.findObject(ref);
    await M.applyObjectProps(o, props || {});
    return M.objectInfo(o);
  };

  M.getScript = function (ref, format) {
    const o = M.findObject(ref);
    if (format === 'raw') return JSON.stringify(o.script.toJSON());
    if (format === 'python') return M.threadsToPython(o);
    return M.compactScript(o);
  };

  M.setLayer = function (o, layer) {
    const cur = Entry.container.getCurrentObjects();
    const from = cur.indexOf(o);
    if (from < 0) return;
    let to;
    if (layer === 'front' || layer === 'top') to = 0;
    else if (layer === 'back' || layer === 'bottom') to = cur.length - 1;
    else if (layer === 'forward') to = Math.max(0, from - 1);
    else if (layer === 'backward') to = Math.min(cur.length - 1, from + 1);
    else to = Math.max(0, Math.min(cur.length - 1, Number(layer)));
    if (to === from) return;
    Entry.container.moveElement(to, from);
    Entry.container.updateObjectsOrder && Entry.container.updateObjectsOrder();
  };

  M.addObjectModel = async function (model, props, sceneRef) {
    await M.ensureStopped();
    if (sceneRef !== undefined && sceneRef !== null && sceneRef !== '') {
      const sc = M.findScene(sceneRef);
      if (Entry.scene.selectedScene !== sc) Entry.scene.selectScene(sc);
      await sleep(100);
    }
    const before = new Set(allObjects().map((o) => o.id));
    model.id = model.id || hash();
    Entry.container.addObject(model, 0);
    await sleep(150);
    const o = allObjects().find((x) => !before.has(x.id)) || M.findObject(model.id);
    if (props) await M.applyObjectProps(o, props);
    return M.objectInfo(o);
  };

  M.addLibrarySprite = async function (sprite, props, scene) {
    const [s] = await window.ipcInvoke('importObjectsFromResource', [sprite]);
    const model = { id: hash(), objectType: 'sprite', sprite: s };
    return M.addObjectModel(model, props, scene);
  };

  M.addImageObject = async function (paths, name, props, scene) {
    const pics = await window.ipcInvoke('importPictures', paths);
    if (!pics || !pics.length) fail('이미지를 가져오지 못했습니다: ' + paths.join(', '));
    pics.forEach((p) => {
      p.id = hash();
      if (p.fileurl) p.fileurl = p.fileurl.replace(/\\/g, '/');
    });
    const model = { id: hash(), objectType: 'sprite', sprite: { name: name || pics[0].name, pictures: pics, sounds: [], category: {} } };
    return M.addObjectModel(model, props, scene);
  };

  M.addTextBox = async function (t, props, scene) {
    const text = t.text !== undefined ? String(t.text) : '텍스트';
    const model = {
      id: hash(),
      name: t.name || text.slice(0, 20) || '글상자',
      text,
      options: {
        font: t.font || `${t.fontSize || 20}px ${t.fontFamily || 'NanumGothic'}`,
        bold: !!t.bold,
        underLine: !!t.underline,
        italic: !!t.italic,
        strike: !!t.strike,
        colour: t.color || '#000000',
        background: t.bgColor || '#ffffff',
        lineBreak: !!t.lineBreak,
      },
      objectType: 'textBox',
      sprite: { sounds: [], pictures: [] },
    };
    return M.addObjectModel(model, props, scene);
  };

  M.addEmptyObject = async function (name, props, scene) {
    const model = {
      id: hash(),
      objectType: 'sprite',
      sprite: { name: name || '새 오브젝트', pictures: [{ id: hash(), dimension: { width: 960, height: 540 }, fileurl: Entry.mediaFilePath + '_1x1.png', name: '새 모양', type: '_system_' }], sounds: [], category: { main: 'new' } },
    };
    return M.addObjectModel(model, props, scene);
  };

  M.addPictures = async function (object, { library, files }) {
    await M.ensureStopped();
    const o = M.findObject(object);
    Entry.container.selectObject(o.id);
    await sleep(50);
    const prevPic = o.selectedPicture && o.selectedPicture.id;
    const added = [];
    if (library && library.length) {
      const pics = await window.ipcInvoke('importPicturesFromResource', library);
      pics.forEach((p) => {
        p.id = hash();
        Entry.playground.addPicture(p, true);
        added.push(p.name);
      });
    }
    if (files && files.length) {
      const pics = await window.ipcInvoke('importPictures', files);
      pics.forEach((p) => {
        p.id = hash();
        if (p.fileurl) p.fileurl = p.fileurl.replace(/\\/g, '/');
        Entry.playground.addPicture(p, true);
        added.push(p.name);
      });
    }
    await sleep(100);
    if (prevPic && o.selectedPicture && o.selectedPicture.id !== prevPic) {
      try {
        o.selectPicture(prevPic);
        Entry.playground.injectObject(o);
      } catch (e) {}
    }
    return { object: o.name, added, pictures: o.pictures.map((p) => p.name), currentPicture: o.selectedPicture && o.selectedPicture.name };
  };

  M.addSounds = async function (object, { library, files }) {
    await M.ensureStopped();
    const o = M.findObject(object);
    Entry.container.selectObject(o.id);
    await sleep(50);
    const added = [];
    let sounds = [];
    if (library && library.length) sounds = sounds.concat(await window.ipcInvoke('importSoundsFromResource', library));
    if (files && files.length) sounds = sounds.concat(await window.ipcInvoke('importSounds', files));
    for (const s of sounds) {
      s.id = hash();
      if (s.fileurl) s.fileurl = s.fileurl.replace(/\\/g, '/');
      try {
        // preload into createjs (same as the app's own sound popup)
        const path = s.fileurl || Entry.defaultPath + '/uploads/' + s.filename + (s.ext || '.mp3');
        createjs.Sound.registerSound(path, s.id, 1);
      } catch (e) {}
      Entry.playground.addSound(s, true);
      added.push(s.name);
    }
    await sleep(100);
    return { object: o.name, added, sounds: o.sounds.map((p) => p.name) };
  };

  M.removeAsset = async function (object, kind, ref) {
    await M.ensureStopped();
    const o = M.findObject(object);
    const arr = kind === 'sound' ? o.sounds : o.pictures;
    const it = arr.find((x) => x.id === ref || x.name === ref);
    if (!it) fail(`${kind === 'sound' ? '소리' : '모양'} "${ref}"가 없습니다.`);
    if (kind === 'sound') o.removeSound(it.id);
    else {
      if (o.pictures.length <= 1) fail('마지막 모양은 삭제할 수 없습니다.');
      o.removePicture(it.id);
    }
    Entry.playground.object === o && Entry.playground.injectObject(o);
    return { object: o.name, pictures: o.pictures.map((p) => p.name), sounds: o.sounds.map((s) => s.name) };
  };

  M.renameAsset = function (object, kind, ref, newName) {
    const o = M.findObject(object);
    const arr = kind === 'sound' ? o.sounds : o.pictures;
    const it = arr.find((x) => x.id === ref || x.name === ref);
    if (!it) fail(`${kind === 'sound' ? '소리' : '모양'} "${ref}"가 없습니다.`);
    it.name = String(newName);
    Entry.playground.object === o && Entry.playground.injectObject(o);
    return { object: o.name, pictures: o.pictures.map((p) => p.name), sounds: o.sounds.map((s) => s.name) };
  };

  M.removeObject = async function (ref) {
    await M.ensureStopped();
    const o = M.findObject(ref);
    Entry.container.removeObject(o);
    return { removed: o.name };
  };

  M.cloneObject = async function (ref, newName) {
    await M.ensureStopped();
    const o = M.findObject(ref);
    const json = o.toJSON();
    json.id = hash();
    json.name = newName || o.name;
    if (json.sprite) {
      json.sprite.pictures = (json.sprite.pictures || []).map((p) => Object.assign({}, p, { id: hash() }));
      json.sprite.sounds = (json.sprite.sounds || []).map((p) => Object.assign({}, p, { id: hash() }));
    }
    // remap picture/sound ids inside script
    let script = typeof json.script === 'string' ? json.script : JSON.stringify(json.script);
    (o.pictures || []).forEach((p, i) => (script = script.split(p.id).join(json.sprite.pictures[i].id)));
    (o.sounds || []).forEach((s, i) => (script = script.split(s.id).join(json.sprite.sounds[i].id)));
    json.script = script;
    const pid = json.selectedPictureId;
    const pidx = o.pictures.findIndex((p) => p.id === pid);
    if (pidx >= 0) json.selectedPictureId = json.sprite.pictures[pidx].id;
    return M.addObjectModel(json, null, o.scene && o.scene.id);
  };

  // ---------------------------------------------------------------- scenes
  M.sceneOp = async function ({ action, scene, name, index }) {
    await M.ensureStopped();
    if (action === 'add') {
      const s = Entry.scene.addScene(undefined, index);
      if (name) renameScene(s, name);
      return { id: s.id, name: s.name, scenes: scenes().map((x) => x.name) };
    }
    const s = M.findScene(scene);
    if (action === 'rename') {
      renameScene(s, name);
      return { id: s.id, name: s.name };
    }
    if (action === 'select') {
      Entry.scene.selectScene(s);
      return { selected: s.name };
    }
    if (action === 'delete') {
      Entry.scene.removeScene(s);
      return { scenes: scenes().map((x) => x.name) };
    }
    if (action === 'move') {
      const arr = scenes();
      const from = arr.indexOf(s);
      Entry.scene.moveScene ? Entry.scene.moveScene(from, index) : null;
      return { scenes: scenes().map((x) => x.name) };
    }
    fail('알 수 없는 action: ' + action);
  };
  function renameScene(s, name) {
    s.name = String(name);
    try {
      if (s.inputWrapper) s.inputWrapper.value = s.name;
      if (s.view) {
        const inp = s.view.querySelector && s.view.querySelector('input');
        if (inp) inp.value = s.name;
      }
      Entry.scene.updateView && Entry.scene.updateView();
    } catch (e) {}
  }

  // ---------------------------------------------------------------- data (variables / lists / messages)
  M.dataOp = async function ({ action, kind, name, newName, value, items, scope, visible, x, y, width, height, isCloud }) {
    await M.ensureStopped();
    const V = vc();
    if (kind === 'message') {
      if (action === 'add') {
        const ex = findMessage(name);
        if (ex) return { exists: true, name: ex.name, id: ex.id };
        const m = { id: hash(), name: String(name) };
        V.appendMessages([m]);
        V.updateList();
        return { name: m.name, id: m.id };
      }
      const m = findMessage(name);
      if (!m) fail(`신호 "${name}"가 없습니다.`);
      if (action === 'rename') {
        V.changeMessageName(m, String(newName));
        return { name: m.name };
      }
      if (action === 'delete') {
        V.removeMessage(m);
        return { deleted: name };
      }
      fail('message에 지원하지 않는 action: ' + action);
    }
    const isList = kind === 'list';
    let objectId = null;
    if (scope && scope !== 'global') {
      const o = M.findObject(scope);
      objectId = o.id;
    }
    if (action === 'add') {
      const exist = findVariable(name, isList ? 'list' : 'variable', objectId ? M.findObject(objectId) : null);
      if (exist && (exist.object_ || null) === objectId) {
        // update instead of duplicate
        return M.dataOp({ action: 'set', kind, name, value, items, scope, visible, x, y, width, height });
      }
      const model = { name: String(name), id: hash(), variableType: isList ? 'list' : kind === 'slide' ? 'slide' : 'variable', value: value !== undefined ? value : 0, visible: visible !== undefined ? !!visible : true, object: objectId, isCloud: !!isCloud };
      if (x !== undefined) model.x = x;
      if (y !== undefined) model.y = y;
      if (isList) {
        model.array = (items || []).map((d) => ({ data: d }));
        if (width !== undefined) model.width = width;
        if (height !== undefined) model.height = height;
      }
      V.appendVariables([model]);
      V.updateList();
      try {
        Entry.playground.reloadPlayground();
      } catch (e) {}
      const v = findVariable(model.id, isList ? 'list' : 'variable');
      if (v && v.updateView) v.updateView();
      return { name: model.name, id: model.id, kind: model.variableType, scope: objectId ? 'local' : 'global' };
    }
    const v = findVariable(name, isList ? 'list' : 'variable', objectId ? M.findObject(objectId) : null);
    if (!v) fail(`${isList ? '리스트' : '변수'} "${name}"가 없습니다.`);
    if (action === 'set') {
      if (value !== undefined && !isList) v.setValue(value);
      if (items !== undefined && isList) {
        v.array_ = items.map((d) => ({ data: d }));
        v.updateView && v.updateView();
      }
      if (visible !== undefined) v.setVisible(!!visible);
      if (x !== undefined) v.setX(Number(x));
      if (y !== undefined) v.setY(Number(y));
      if (isList && width !== undefined) v.setWidth(Number(width));
      if (isList && height !== undefined) v.setHeight(Number(height));
      v.updateView && v.updateView();
      Entry.stage.update();
      return { name: v.name_, value: isList ? (v.array_ || []).map((d) => d.data) : v.getValue(), visible: v.isVisible() };
    }
    if (action === 'rename') {
      if (isList) V.changeListName(v, String(newName));
      else V.changeVariableName(v, String(newName));
      return { name: v.name_ };
    }
    if (action === 'delete') {
      if (isList) V.removeList(v);
      else V.removeVariable(v);
      return { deleted: name };
    }
    fail('알 수 없는 action: ' + action);
  };

  // ---------------------------------------------------------------- block reference
  const CATEGORY_KO = { start: '시작', flow: '흐름', moving: '움직임', looks: '생김새', brush: '붓', text: '글상자', sound: '소리', judgement: '판단', calc: '계산', variable: '자료', func: '함수', analysis: '데이터분석', ai_utilize: '인공지능', expansion: '확장', arduino: '하드웨어' };
  M.blockSpec = function (type, detail) {
    const b = Entry.block[type];
    if (!b) return null;
    const sp = b.params || [];
    const defP = (b.def && b.def.params) || [];
    const keyMap = b.paramsKeyMap || {};
    const rev = {};
    Object.keys(keyMap).forEach((k) => (rev[keyMap[k]] = k));
    const args = [];
    sp.forEach((p, i) => {
      if (NO_INPUT.has(p.type)) return;
      const a = { key: rev[i] || 'P' + i, kind: p.type };
      if (p.type === 'Block') {
        a.accept = p.accept;
        const d = defP[i];
        if (d && d.type) a.default = LITERAL_TYPES.has(d.type) ? d.params && d.params[0] : d.type === 'True' || d.type === 'False' ? d.type === 'True' : { block: d.type, params: d.params && d.params.filter((x) => x !== null && typeof x !== 'object') };
      } else if (p.type === 'Dropdown' || p.type === 'Keyboard') {
        if (p.type === 'Keyboard') a.options = 'key name: a-z, 0-9, space, enter, left, right, up, down, shift, ctrl, alt, esc, tab (or key code)';
        else a.options = (p.options || []).map((o) => (Array.isArray(o) ? (o[0] === o[1] ? String(o[1]) : `${o[1]}=${o[0]}`) : o)).slice(0, detail ? 200 : 40);
        a.default = defP[i] !== undefined && defP[i] !== null ? defP[i] : p.value;
      } else if (p.type === 'DropdownDynamic') {
        a.menu = typeof p.menuName === 'string' ? p.menuName : 'dynamic';
        a.note = 'use the name (변수/리스트/신호/오브젝트/모양/소리/장면 이름) – resolved to id automatically';
        a.default = defP[i];
      } else if (p.type === 'Color') {
        a.note = 'hex color like #ff0000';
        a.default = defP[i];
      } else {
        a.default = defP[i];
      }
      args.push(a);
    });
    let tmpl = (Lang.template && Lang.template[type]) || b.template || '';
    // replace %n by arg keys (skip indicators)
    let k = 0;
    const idxToArg = {};
    sp.forEach((p, i) => {
      if (!NO_INPUT.has(p.type)) idxToArg[i + 1] = args[k++].key;
    });
    tmpl = String(tmpl).replace(/%(\d+)/g, (m, d) => (idxToArg[d] ? `[${idxToArg[d]}]` : ''));
    const py = b.syntax && b.syntax.py;
    let pySyntax;
    if (py && py.length) {
      pySyntax = py.map((s) => (typeof s === 'string' ? s : s.syntax)).filter(Boolean).slice(0, detail ? 10 : 2);
    }
    const out = { type, category: EntryStatic.getCategoryByBlock ? EntryStatic.getCategoryByBlock(type) || b.category : b.category, text: tmpl.replace(/\s+/g, ' ').trim(), shape: b.skeleton, args };
    const ns = (b.statements || []).length;
    if (ns) out.statements = ns;
    if (pySyntax && pySyntax.length && pySyntax[0] !== '') out.python = pySyntax;
    return out;
  };

  M.blockReference = function ({ query, category, types, includeHidden, detail, limit }) {
    const cats = EntryStatic.getAllBlocks();
    if (types && types.length) return { blocks: types.map((t) => M.blockSpec(t, true) || { type: t, error: '없는 블록' }) };
    if (!query && !category) {
      return {
        categories: cats
          .filter((c) => c.category !== 'arduino')
          .map((c) => ({ category: c.category, name: CATEGORY_KO[c.category] || c.category, count: c.blocks.filter((t) => Entry.block[t] && !/AddButton|Button$/.test(t)).length })),
        hint: 'category 또는 query로 검색하세요. 하드웨어/확장 블록은 category="arduino"/"expansion"/"ai_utilize".',
      };
    }
    let pool;
    if (category) {
      const c = cats.find((c) => c.category === category || CATEGORY_KO[c.category] === category);
      if (!c) fail('없는 카테고리: ' + category + ' (가능: ' + cats.map((c) => c.category).join(', ') + ')');
      pool = c.blocks;
    } else {
      pool = includeHidden ? Object.keys(Entry.block) : cats.filter((c) => c.category !== 'arduino').flatMap((c) => c.blocks);
    }
    pool = pool.filter((t) => Entry.block[t] && !/AddButton|Button$/.test(t));
    if (query) {
      const q = String(query).toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      pool = pool.filter((t) => {
        const b = Entry.block[t];
        const text = (t + ' ' + ((Lang.template && Lang.template[t]) || b.template || '') + ' ' + JSON.stringify((b.syntax && b.syntax.py) || '')).toLowerCase();
        return words.every((w) => text.includes(w));
      });
    }
    const total = pool.length;
    const lim = limit || 60;
    return { total, shown: Math.min(total, lim), blocks: pool.slice(0, lim).map((t) => M.blockSpec(t, detail)) };
  };

  // ---------------------------------------------------------------- runtime
  M.runtimeState = function (opts) {
    opts = opts || {};
    const st = {
      engine: Entry.engine.state,
      scene: Entry.scene.selectedScene && Entry.scene.selectedScene.name,
      timer: Entry.engine.projectTimer ? Entry.engine.projectTimer.getValue && Entry.engine.projectTimer.getValue() : undefined,
      variables: {},
      lists: {},
      objects: [],
    };
    vc().variables_.forEach((v) => {
      const key = v.object_ ? `${(M.findObject(v.object_, { optional: true }) || {}).name}.${v.name_}` : v.name_;
      st.variables[key] = v.getValue();
    });
    vc().lists_.forEach((v) => {
      const key = v.object_ ? `${(M.findObject(v.object_, { optional: true }) || {}).name}.${v.name_}` : v.name_;
      st.lists[key] = (v.array_ || []).map((d) => d.data).slice(0, 100);
    });
    Entry.container.getCurrentObjects().forEach((o) => {
      const e = o.entity;
      const clones = o.clonedEntities ? o.clonedEntities.length : 0;
      const r = { name: o.name, x: round(e.getX()), y: round(e.getY()), size: round(e.getSize()), direction: round(e.getDirection()), rotation: round(e.getRotation()), visible: e.getVisible(), clones };
      if (o.objectType === 'textBox') r.text = e.getText();
      else r.picture = (o.pictures.find((p) => p.id === (e.picture && e.picture.id)) || {}).name;
      try {
        if (e.dialog && e.dialog.message_) r.saying = String(e.dialog.message_);
      } catch (err) {}
      st.objects.push(r);
    });
    try {
      const ans = Entry.container.inputValue;
      if (ans && ans.getValue) st.answer = ans.getValue();
      st.waitingForAnswer = !!(Entry.stage.inputField && Entry.stage.inputField._isHidden === false);
    } catch (e) {}
    return st;
  };

  M.run = async function () {
    if (Entry.engine.isState('run')) return { engine: 'run', note: 'already running' };
    Entry.engine.toggleRun();
    await sleep(100);
    return { engine: Entry.engine.state };
  };
  M.stop = async function () {
    await M.ensureStopped();
    return { engine: Entry.engine.state };
  };

  // Force-render the stage and read the canvas pixels directly.
  // Entry only redraws on requestAnimationFrame, which pauses while the window is hidden/occluded,
  // so a compositor screenshot can show an old frame even though the program keeps running.
  M.forceRender = function () {
    try {
      if (Entry.stage && Entry.stage.updateForce) Entry.stage.updateForce();
      else if (Entry.stage && Entry.stage.update) {
        Entry.requestUpdate = true;
        Entry.stage.update();
      }
      return true;
    } catch (e) {
      return false;
    }
  };
  M.captureStage = function () {
    const c = document.getElementById('entryCanvas') || document.querySelector('canvas#entryCanvas, .entryCanvasWorkspace canvas');
    if (!c) return null;
    M.forceRender();
    try {
      return c.toDataURL('image/png').split(',')[1];
    } catch (e) {
      return null; // e.g. tainted canvas → caller falls back to a compositor screenshot
    }
  };

  M.stageRect = function () {
    const c = document.getElementById('entryCanvas') || document.querySelector('canvas#entryCanvas, .entryCanvasWorkspace canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height, dpr: window.devicePixelRatio || 1 };
  };

  // ---------------------------------------------------------------- project level
  M.newProject = async function (name, empty) {
    await M.ensureStopped();
    const ws = M.ws();
    await ws.loadProject();
    for (let i = 0; i < 50 && !(Entry.container && Entry.container.getAllObjects); i++) await sleep(100);
    await sleep(500);
    if (empty) {
      allObjects().slice().forEach((o) => Entry.container.removeObject(o, true));
    }
    if (name) M.setProjectName(name);
    return M.summary({ brief: true });
  };
  M.setProjectName = function (name) {
    const ws = M.ws();
    if (name !== undefined && name !== null && name !== '') {
      try {
        ws.props.CommonActions.changeProjectName(String(name));
      } catch (e) {}
    }
    return ws._getProjectName();
  };
  M.loadProjectJson = async function (project) {
    await M.ensureStopped();
    const ws = M.ws();
    if (typeof project === 'string') project = JSON.parse(project);
    await ws.loadProject(project);
    await sleep(800);
    return M.summary({ brief: true });
  };
  M.openEnt = async function (path) {
    await M.ensureStopped();
    const project = await window.ipcInvoke('loadProject', path);
    project.savedPath = path;
    return M.loadProjectJson(project);
  };
  M.saveEnt = async function (path, name) {
    await M.ensureStopped();
    if (name) M.setProjectName(name);
    const ws = M.ws();
    try {
      Entry.stage.handle && Entry.stage.handle.setVisible(false);
      Entry.stage.update();
    } catch (e) {}
    M.ensureWatermarkVar();
    M.removeMemos();
    const p = Entry.exportProject();
    p.name = ws._getProjectName();
    await window.ipcInvoke('saveProject', p, path);
    try {
      ws.projectSavedPath = path;
      Entry.stateManager && Entry.stateManager.addStamp();
    } catch (e) {}
    return { saved: path, name: p.name };
  };
  // Entry's block→Python converter bug: user-function calls can come out without the function's "def" and with
  // arguments renamed to "param1"… Switching back to blocks then fails and Entry empties that object's code.
  // Detect it before switching so no code is lost.
  M.pythonModeIssues = function () {
    const prev = Entry.playground.object;
    const names = Object.values(vc().functions_).map((f) => funcName(f)).filter(Boolean);
    const issues = [];
    allObjects().forEach((o) => {
      let py = '';
      try { py = M.threadsToPython(o) || ''; } catch (e) { issues.push(`${o.name}: 파이썬 변환 실패 (${e.message})`); return; }
      const body = py.split('\n').filter((l) => !/^\s*def\s/.test(l)).join('\n');
      names.forEach((n) => {
        if (body.includes(n + '(') && !py.includes('def ' + n + '(')) issues.push(`${o.name}: 함수 "${n}"의 정의가 빠짐`);
      });
      if (/\bparam\d+\b/.test(body)) issues.push(`${o.name}: 함수 호출 인자가 param 이름으로 바뀜`);
    });
    if (prev) try { Entry.container.selectObject(prev.id); } catch (e) {}
    return [...new Set(issues)];
  };

  M.setCodingMode = async function (mode) {
    await M.ensureStopped();
    if (mode === 'python') {
      const issues = M.pythonModeIssues();
      if (issues.length) fail('엔트리파이썬 모드로 바꾸면 코드가 사라질 수 있어 전환하지 않았습니다 (엔트리 자체 변환기 버그: 사용자 함수 호출이 잘못 변환됨). 블록 모드를 유지하세요.\n- ' + issues.join('\n- '));
    }
    const ws = M.ws();
    ws.handleProgramLanguageModeChanged(mode === 'python' ? 'python' : 'block');
    await sleep(700);
    const mws = Entry.getMainWS();
    const now = mws.getMode() === Entry.Workspace.MODE_VIMBOARD ? 'python' : 'block';
    const alert = M.dismissAlert();
    if (now !== mode) fail(`모드 전환 실패(현재 ${now})` + (alert ? ': ' + alert : ''));
    return { codingMode: now, alert: alert || undefined };
  };

  M.selectObject = function (ref) {
    const o = M.findObject(ref);
    if (o.scene && Entry.scene.selectedScene !== o.scene) Entry.scene.selectScene(o.scene);
    Entry.container.selectObject(o.id);
    return { selected: o.name };
  };

  M.call = async function (fn, args) {
    try {
      const r = await M[fn].apply(M, args || []);
      return { ok: true, result: r };
    } catch (e) {
      return { ok: false, error: e.message, stack: String(e.stack || '').split('\n').slice(0, 4).join('\n') };
    }
  };

  // ---------------------------------------------------------------- keep the id watermark through Python mode
  // Switching Python → blocks makes Entry rebuild every block with fresh ids. We hook Workspace.textToCode,
  // match the rebuilt blocks against the previous ones (type + literal values, LCS) and give a watermark id
  // only to blocks that were watermarked before and are unchanged. Code typed by a person stays unmarked.
  // signature = type + literal params; empty slots (null/undefined) differ between parser output and saved blocks, so skip them
  const blockSig = (b) => b.type + '|' + (b.params || []).filter((p) => p !== null && p !== undefined && typeof p !== 'object').map((p) => String(p)).join(',');
  function flattenBlocks(threads) {
    const out = [];
    (function walk(x) {
      if (Array.isArray(x)) return x.forEach(walk);
      if (!x || typeof x !== 'object') return;
      if (typeof x.type === 'string' && x.type !== 'comment') out.push(x);
      walk(x.params);
      walk(x.statements);
    })(threads);
    return out;
  }
  M.remarkIds = function (oldThreads, newThreads) {
    const a = flattenBlocks(oldThreads), b = flattenBlocks(newThreads);
    if (!a.some((x) => isMarkedId(x.id))) return 0;
    const sa = a.map(blockSig), sb = b.map(blockSig);
    const pairs = [];
    let i0 = 0;
    while (i0 < sa.length && i0 < sb.length && sa[i0] === sb[i0]) { pairs.push([i0, i0]); i0++; }
    let ea = sa.length, eb = sb.length;
    while (ea > i0 && eb > i0 && sa[ea - 1] === sb[eb - 1]) { ea--; eb--; pairs.push([ea, eb]); }
    const n = ea - i0, m = eb - i0;
    if (n > 0 && m > 0 && n * m <= 4e6) {
      // LCS on the changed middle part
      const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = sa[i0 + i] === sb[i0 + j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (sa[i0 + i] === sb[i0 + j]) { pairs.push([i0 + i, i0 + j]); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
      }
    }
    let n2 = 0;
    pairs.forEach(([ia, ib]) => {
      if (!isMarkedId(a[ia].id)) return;
      const nb = b[ib], id = markedId();
      // the parser returns a mix of plain JSON and Entry.Block model instances
      if (typeof nb.set === 'function') nb.set({ id });
      else nb.id = id;
      n2++;
    });
    return n2;
  };
  try {
    const WP = Entry.Workspace && Entry.Workspace.prototype;
    if (WP && WP.textToCode && !WP.__mcpWatermarkHook) {
      WP.__mcpWatermarkHook = true;
      WP.textToCode = function (mode, oldTextType) {
        if (!this.vimBoard || mode !== Entry.Workspace.MODE_VIMBOARD) return;
        const board = this.board;
        const code = board && board.code;
        let before = [];
        try { before = code ? code.toJSON() : []; } catch (e) {}
        const changedCode = this.vimBoard.textToCode(oldTextType);
        if (!code) return;
        try { if (window.__entryMcp && window.__entryMcp.remarkIds) window.__entryMcp.remarkIds(before, changedCode); } catch (e) {}
        code.load(changedCode);
        this.changeBoardCode(code);
        const self = this;
        setTimeout(function () {
          if (code.view) {
            code.view.reDraw();
            self.board.alignThreads();
          }
        }, 0);
      };
    }
  } catch (e) {}

  window.__entryMcp = M;
})();
