// Offline asset library (sprites / pictures / sounds) read directly from Entry's app.asar.
'use strict';
const path = require('path');
const asar = require('@electron/asar');

class AssetLibrary {
  constructor(asarPath) {
    this.asarPath = asarPath;
    this.loaded = false;
  }

  _read(rel) {
    return asar.extractFile(this.asarPath, rel.split('/').join(path.sep));
  }

  load() {
    if (this.loaded) return;
    const j = (f) => JSON.parse(this._read('src/renderer/resources/db/' + f).toString('utf8'));
    this.sprites = j('sprites.json');
    this.pictures = j('pictures.json');
    this.sounds = j('sounds.json');
    const cats = j('categories.json');
    this.catLabel = {};
    for (const c of cats) {
      if (c.value) this.catLabel[c.value] = (c.label && (c.label.ko || c.label.en)) || c.name;
      if (c.name && !this.catLabel[c.name]) this.catLabel[c.name] = c.name;
    }
    this.loaded = true;
  }

  static label(x) {
    return (x.label && (x.label.ko || x.label.en)) || x.name;
  }

  _catOf(x) {
    const c = x.category || {};
    const main = c.main || '';
    const sub = c.sub || '';
    return { main, sub, text: [this.catLabel[main] || main, this.catLabel[sub] || sub].filter(Boolean).join('/') };
  }

  categories(kind) {
    this.load();
    const list = kind === 'sound' ? this.sounds : kind === 'picture' ? this.pictures : this.sprites;
    const m = new Map();
    for (const x of list) {
      const c = this._catOf(x);
      const key = c.main + (c.sub ? '/' + c.sub : '');
      const cur = m.get(key) || { category: key, label: c.text, count: 0 };
      cur.count++;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }

  search(kind, query, category, limit = 30, offset = 0) {
    this.load();
    const list = kind === 'sound' ? this.sounds : kind === 'picture' ? this.pictures : kind === 'background' ? this.sprites.filter((s) => (s.category || {}).main === 'background') : this.sprites;
    const words = String(query || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const scored = [];
    for (const x of list) {
      const c = this._catOf(x);
      if (category) {
        const cat = String(category).toLowerCase();
        if (!(c.main.toLowerCase() === cat || c.sub.toLowerCase() === cat || c.text.toLowerCase().includes(cat) || (c.main + '/' + c.sub).toLowerCase() === cat)) continue;
      }
      const hay = [x.name, x.label && x.label.ko, x.label && x.label.en, c.text, c.main, c.sub, ...(kind !== 'sound' && x.pictures ? x.pictures.map((p) => p.name) : [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (words.length && !words.every((w) => hay.includes(w))) continue;
      let score = 0;
      const nm = String(AssetLibrary.label(x)).toLowerCase();
      for (const w of words) {
        if (nm === w) score += 10;
        else if (nm.startsWith(w)) score += 5;
        else if (nm.includes(w)) score += 3;
        else score += 1;
      }
      scored.push({ x, score, c });
    }
    scored.sort((a, b) => b.score - a.score);
    const total = scored.length;
    const items = scored.slice(offset, offset + limit).map(({ x, c }) => this._brief(kind, x, c));
    return { total, offset, shown: items.length, items };
  }

  _brief(kind, x, c) {
    const base = { id: x._id, name: AssetLibrary.label(x), en: x.label && x.label.en, category: c.text };
    if (kind === 'sound') return Object.assign(base, { duration: x.duration });
    if (kind === 'picture') return Object.assign(base, { size: x.dimension && `${x.dimension.width}x${x.dimension.height}` });
    return Object.assign(base, {
      pictures: (x.pictures || []).map((p) => AssetLibrary.label(p)),
      sounds: (x.sounds || []).map((s) => AssetLibrary.label(s)),
      size: x.pictures && x.pictures[0] && x.pictures[0].dimension ? `${x.pictures[0].dimension.width}x${x.pictures[0].dimension.height}` : undefined,
      isBackground: (x.category || {}).main === 'background' || undefined,
    });
  }

  _find(kind, idOrName) {
    this.load();
    const list = kind === 'sound' ? this.sounds : kind === 'picture' ? this.pictures : this.sprites;
    return list.find((x) => x._id === idOrName) || list.find((x) => AssetLibrary.label(x) === idOrName || x.name === idOrName);
  }

  // Deep-copied resource entry, with Korean labels applied as names (same as the app does).
  get(kind, idOrName) {
    const x = this._find(kind, idOrName);
    if (!x) return null;
    const c = JSON.parse(JSON.stringify(x));
    const lab = (o) => {
      o.name = AssetLibrary.label(o);
      return o;
    };
    lab(c);
    if (c.pictures) c.pictures.forEach(lab);
    if (c.sounds) c.sounds.forEach(lab);
    return c;
  }

  // For a sprite: all pictures; for a picture: itself.
  thumbnail(kind, idOrName) {
    const x = this._find(kind, idOrName);
    if (!x) return null;
    const pics = kind === 'picture' ? [x] : (x.pictures || []).slice(0, 1);
    const out = [];
    for (const p of pics) {
      const fn = p.filename;
      const ext = p.ext || '.png';
      const dir = `src/renderer/resources/uploads/${fn.slice(0, 2)}/${fn.slice(2, 4)}`;
      for (const rel of [`${dir}/thumb/${fn}${ext}`, `${dir}/thumb/${fn}.png`, `${dir}/image/${fn}${ext}`, `${dir}/image/${fn}.png`]) {
        try {
          const buf = this._read(rel);
          out.push({ name: AssetLibrary.label(x), data: buf.toString('base64'), mime: rel.endsWith('.svg') ? 'image/svg+xml' : 'image/png' });
          break;
        } catch {}
      }
    }
    return out;
  }
}

module.exports = { AssetLibrary };
