// Launch / detect the Entry offline app (Electron) with a remote-debugging port.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findEntryExe() {
  const cands = [process.env.ENTRY_PATH, 'C:\\entry\\Entry.exe', 'C:\\Program Files\\Entry\\Entry.exe', 'C:\\Program Files (x86)\\Entry\\Entry.exe', path.join(process.env.LOCALAPPDATA || '', 'Programs', 'entry', 'Entry.exe')].filter(Boolean);
  for (const c of cands) {
    const p = c.toLowerCase().endsWith('.exe') ? c : path.join(c, 'Entry.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function isEntryProcessRunning() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    execFile('tasklist', ['/FI', 'IMAGENAME eq Entry.exe', '/NH', '/FO', 'CSV'], { windowsHide: true }, (err, out) => {
      if (err) return resolve(false);
      resolve(/"Entry\.exe"/i.test(out));
    });
  });
}

function killEntry() {
  return new Promise((resolve) => {
    execFile('taskkill', ['/IM', 'Entry.exe', '/F', '/T'], { windowsHide: true }, () => resolve());
  });
}

function startEntry(exe, port, file) {
  const args = [`--remote-debugging-port=${port}`, '--remote-allow-origins=*'];
  if (file) args.push(file);
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', cwd: path.dirname(exe), windowsHide: false });
  child.unref();
  return child.pid;
}

module.exports = { findEntryExe, isEntryProcessRunning, killEntry, startEntry, sleep };
