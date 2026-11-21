// Launch / detect the Entry offline app (Electron) with a remote-debugging port.
// Windows is the tested platform; macOS / Linux support follows the same Electron conventions (not yet verified on a real Mac).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };

// "Foo.app" bundle -> Foo.app/Contents/MacOS/<CFBundleExecutable>
function bundleExecutable(app) {
  const macos = path.join(app, 'Contents', 'MacOS');
  try {
    const plist = fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8');
    const m = plist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/);
    if (m && isFile(path.join(macos, m[1]))) return path.join(macos, m[1]);
  } catch (e) {}
  try {
    const f = fs.readdirSync(macos).find((n) => isFile(path.join(macos, n)));
    if (f) return path.join(macos, f);
  } catch (e) {}
  return null;
}

// ENTRY_PATH may be the executable, its folder, or (macOS) the .app bundle
function resolveCandidate(c, platform) {
  if (!c) return null;
  if (/\.app[\\/]?$/i.test(c) && isDir(c)) return bundleExecutable(c);
  if (isFile(c)) return c;
  if (isDir(c)) {
    const names = platform === 'win32' ? ['Entry.exe'] : platform === 'darwin' ? [] : ['entry', 'Entry'];
    for (const n of names) if (isFile(path.join(c, n))) return path.join(c, n);
    if (platform === 'darwin') {
      const app = fs.readdirSync(c).find((n) => /^entry.*\.app$/i.test(n));
      if (app) return bundleExecutable(path.join(c, app));
    }
  }
  return null;
}

function entryCandidates(platform, home) {
  if (platform === 'win32') {
    return ['C:\\entry\\Entry.exe', 'C:\\Program Files\\Entry\\Entry.exe', 'C:\\Program Files (x86)\\Entry\\Entry.exe', path.join(process.env.LOCALAPPDATA || '', 'Programs', 'entry', 'Entry.exe')];
  }
  if (platform === 'darwin') {
    const names = ['Entry.app', 'entry.app', '엔트리.app', 'Entry Offline.app'];
    return [].concat(names.map((n) => path.join('/Applications', n)), names.map((n) => path.join(home, 'Applications', n)));
  }
  return ['/opt/Entry/entry', '/opt/entry/entry', '/usr/lib/entry/entry', '/usr/bin/entry', path.join(home, 'Entry', 'entry')];
}

function findEntryExe(platform = process.platform, env = process.env, home = os.homedir()) {
  for (const c of [env.ENTRY_PATH].concat(entryCandidates(platform, home))) {
    const exe = resolveCandidate(c, platform);
    if (exe) return exe;
  }
  return null;
}

// root folder of the installation (.app bundle on macOS)
function appRoot(exe) {
  const m = exe && exe.match(/^(.*?\.app)[\\/]Contents[\\/]MacOS[\\/]/i);
  return m ? m[1] : null;
}

// built-in resource DB lives in app.asar
function findEntryAsar(exe, env = process.env) {
  if (env.ENTRY_ASAR) return env.ENTRY_ASAR; // explicit setting wins
  const cands = [];
  if (exe) {
    const app = appRoot(exe);
    if (app) cands.push(path.join(app, 'Contents', 'Resources', 'app.asar'));
    cands.push(path.join(path.dirname(exe), 'resources', 'app.asar'), path.join(path.dirname(exe), 'Resources', 'app.asar'));
  }
  const list = cands.filter(Boolean);
  return list.find((p) => isFile(p)) || list[0] || null;
}

function isEntryProcessRunning(platform = process.platform) {
  return new Promise((resolve) => {
    if (platform === 'win32') {
      execFile('tasklist', ['/FI', 'IMAGENAME eq Entry.exe', '/NH', '/FO', 'CSV'], { windowsHide: true }, (err, out) => resolve(!err && /"Entry\.exe"/i.test(out)));
      return;
    }
    const exe = findEntryExe(platform);
    if (!exe) return resolve(false);
    execFile('pgrep', ['-f', exe], (err, out) => resolve(!err && String(out).trim().length > 0));
  });
}

function killEntry(platform = process.platform) {
  return new Promise((resolve) => {
    if (platform === 'win32') {
      execFile('taskkill', ['/IM', 'Entry.exe', '/F', '/T'], { windowsHide: true }, () => resolve());
      return;
    }
    const exe = findEntryExe(platform);
    if (!exe) return resolve();
    // on macOS the bundle path also matches Electron's helper processes
    execFile('pkill', ['-f', appRoot(exe) || exe], () => resolve());
  });
}

function startEntry(exe, port, file) {
  const args = [`--remote-debugging-port=${port}`, '--remote-allow-origins=*'];
  if (file) args.push(file);
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', cwd: path.dirname(exe), windowsHide: false });
  child.unref();
  return child.pid;
}

module.exports = { findEntryExe, findEntryAsar, appRoot, bundleExecutable, isEntryProcessRunning, killEntry, startEntry, sleep };
