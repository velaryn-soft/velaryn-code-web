// Shared state, helpers, cloud data access and UI primitives for the Velaryn Code website.
// Data model is the same as the desktop app (main/sync.js):
//  - file contents are content-addressed blobs in the private 'velaryn' bucket at <user id>/blobs/<sha256>
//  - vc_files rows point at the hash; every write goes through rpc('vc_commit') with base_version,
//    which raises VC_CONFLICT when another device changed the file first.
import { icon } from './icons.js?v=1793470528';

export const BUCKET = 'velaryn';
export const LOOSE = '~files';                    // the "Single files" project
export const MAX_SIZE = 2 * 1024 * 1024 * 1024;   // same limit as the desktop app (2 GB)
export const CHUNK = 40 * 1024 * 1024;            // files bigger than this are stored in 40 MiB parts
export const EDIT_MAX = 5 * 1024 * 1024;          // bigger files are download-only here
export const SEARCH_MAX = 1024 * 1024;            // search skips files over 1 MB
export const MONACO_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';
export const IGNORE = new Set(['.git', 'node_modules', '.DS_Store', '.venv', 'venv', '__pycache__', '.next', '.nuxt',
  '.cache', '.parcel-cache', 'Pods', 'DerivedData', '.gradle', '.idea', 'Thumbs.db']);
export const GLYPH = { Mac: '', iOS: '📱', iPadOS: '📱', Android: '🤖', Windows: '⊞', Linux: '🐧', Web: '🌐' };
export const CFG = window.VELARYN_CONFIG || {};
export const glyphFor = (os) => GLYPH[os] || (os === 'Web' || !os ? GLYPH.Web : '💻');  // same fallback as the desktop app

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const keyOf = (project, path) => `${project}\u0000${path}`;
export const projectLabel = (name) => (name === LOOSE ? 'Single files' : name);
export const baseName = (p) => String(p).split('/').pop();
export const dirName = (p) => (String(p).includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
export const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  del(k) { try { sessionStorage.removeItem(k); } catch {} },
};

export const S = {
  client: null, user: null, channel: null,
  rows: new Map(), projectMeta: [], devices: [],
  loaded: false, loadError: null,
};

// tiny event bus: 'rows' (cloud rows changed), 'remote' (realtime row), 'settings', 'user', 'avatar'
const handlers = new Map();
export function on(evt, fn) { if (!handlers.has(evt)) handlers.set(evt, new Set()); handlers.get(evt).add(fn); return () => handlers.get(evt).delete(fn); }
export function emit(evt, ...args) { for (const fn of handlers.get(evt) || []) { try { fn(...args); } catch (e) { console.error(e); } } }

export const getConfigHost = () => S.configHost || '';
// App mode = running inside the Capacitor iOS/Android app: the full editor workspace.
// Everywhere else (any browser) the site is a file manager. Tests can force app mode with
// localStorage.vcForceApp = '1' or ?app=1 (read once at load; not exposed in the UI).
const APP_MODE = (() => {
  const C = window.Capacitor;
  let native = false;
  try {
    if (C) native = typeof C.isNativePlatform === 'function' ? !!C.isNativePlatform() : (C.getPlatform?.() || 'web') !== 'web';
  } catch {}
  let forced = false;
  try { forced = localStorage.getItem('vcForceApp') === '1' || new URLSearchParams(location.search).get('app') === '1'; } catch {}
  return native || forced;
})();
export const isApp = () => APP_MODE;

export const isPhone = () => window.matchMedia('(max-width: 899px)').matches;
export const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

// ---------------------------------------------------------------- utilities

export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60; if (h < 24) return `${Math.round(h)} h ago`;
  const d = h / 24; if (d < 30) return `${Math.round(d)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function deviceHtml(os, name, iso) {
  if (!name && !iso) return '';
  const g = glyphFor(os);
  return `<span class="dev"><span aria-hidden="true">${esc(g)}</span> ${esc(name || os || 'Unknown device')}${iso ? ` · ${esc(timeAgo(iso))}` : ''}</span>`;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function sha256(bytes) {
  if (!crypto.subtle) throw new Error('This page must be served over HTTPS to hash files.');
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function friendly(e) {
  const msg = e?.message || String(e || 'Something went wrong');
  if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    return 'No connection. Check your network and try again.';
  }
  return msg;
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function cleanPath(p) {
  const parts = String(p || '').replace(/\\/g, '/').split('/').map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..');
  return parts.join('/');
}

// ---------------------------------------------------------------- device identity

const isNativeApp = () => {
  const C = window.Capacitor;
  if (!C) return false;
  try { return typeof C.isNativePlatform === 'function' ? !!C.isNativePlatform() : true; } catch { return true; }
};

export const DEVICE = { id: '', name: '', os: 'Web', app: false };
export function refreshDevice() {
  const ua = navigator.userAgent || '';
  const touchMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1; // iPadOS "desktop mode"
  let os = 'Web', label = 'Web';
  if (/iPad/.test(ua) || touchMac) { os = 'iPadOS'; label = 'iPad'; }
  else if (/iPhone|iPod/.test(ua)) { os = 'iOS'; label = /iPod/.test(ua) ? 'iPod' : 'iPhone'; }
  else if (/Android/.test(ua)) { os = 'Android'; label = 'Android'; }
  else if (/Macintosh|Mac OS X/.test(ua)) { os = 'Mac'; label = 'Mac'; }
  else if (/Windows/.test(ua)) { os = 'Windows'; label = 'Windows'; }
  else if (/CrOS/.test(ua)) { os = 'Linux'; label = 'ChromeOS'; }
  else if (/Linux|X11/.test(ua)) { os = 'Linux'; label = 'Linux'; }
  let id = store.get('vc_device_id');
  if (!id) { id = uuid(); store.set('vc_device_id', id); }
  const app = isNativeApp();
  if (app) {
    // Inside the Capacitor wrapper: register as the app, not as a browser.
    let plat = '';
    try { plat = window.Capacitor.getPlatform?.() || ''; } catch {}
    if (plat === 'android' || (!plat && os === 'Android')) { os = 'Android'; label = 'Android'; }
    else if (os !== 'iPadOS') { os = 'iOS'; label = 'iPhone'; }
    Object.assign(DEVICE, { id, name: `${label} · Velaryn app`, os, app: true });
    return DEVICE;
  }
  let browser = 'Browser';
  if (/Edg[A-Za-z]*\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS|Chromium/.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  Object.assign(DEVICE, { id, name: `${label} · ${browser}`, os, app: false });
  return DEVICE;
}
refreshDevice();

// ---------------------------------------------------------------- toasts

export function toast(msg, type = '', { sticky = false, spin = false, ms = 3200, actions = [] } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${spin ? '<div class="spinner"></div>' : ''}<span class="tmsg"></span>${actions.length ? '<span class="tact"></span>' : ''}`;
  $('.tmsg', el).textContent = msg;
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn small'; b.textContent = a.label;
    b.onclick = () => { api.close(); a.run(); };
    $('.tact', el).appendChild(b);
  });
  $('#toasts').appendChild(el);
  let timer;
  const api = {
    update(m) { $('.tmsg', el).textContent = m; return api; },
    close(after = 0) { clearTimeout(timer); timer = setTimeout(() => el.remove(), after); },
    done(m, t = 'ok') { el.className = `toast ${t}`; $('.spinner', el)?.remove(); api.update(m); api.close(2600); },
  };
  if (!sticky) api.close(ms);
  return api;
}
export const toastErr = (e) => toast(friendly(e), 'err', { ms: 5500 });

// ---------------------------------------------------------------- hold-to-show password fields

export function pwInput(attrs = '') {
  return `<span class="pw-wrap"><input type="password" ${attrs}><button type="button" class="pw-eye" aria-label="Hold to show password" tabindex="0">${icon('eye', 17)}</button></span>`;
}

// Press and hold the eye to reveal; release, leave or cancel hides it. Keeps focus and caret.
export function wirePasswordReveal(root = document) {
  $$('.pw-eye', root).forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    const input = btn.parentElement.querySelector('input');
    let active = false, selStart = null, selEnd = null, hadFocus = false;
    const show = () => {
      if (active) return;
      active = true;
      hadFocus = document.activeElement === input;
      try { selStart = input.selectionStart; selEnd = input.selectionEnd; } catch {}
      input.type = 'text';
      btn.classList.add('on');
      if (hadFocus) restore();
    };
    const hide = () => {
      if (!active) return;
      active = false;
      input.type = 'password';
      btn.classList.remove('on');
      if (hadFocus) restore();
    };
    const restore = () => { input.focus({ preventScroll: true }); try { if (selStart != null) input.setSelectionRange(selStart, selEnd); } catch {} };
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // don't steal focus from the input
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); show(); }, { passive: false });
    btn.addEventListener('touchend', (e) => { e.preventDefault(); hide(); });
    btn.addEventListener('touchcancel', hide);
    btn.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') show(); });
    btn.addEventListener('pointerup', hide);
    btn.addEventListener('pointerleave', hide);
    btn.addEventListener('pointercancel', hide);
    btn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); hadFocus = false; show(); } });
    btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); hide(); } });
    btn.addEventListener('blur', hide);
    btn.addEventListener('click', (e) => e.preventDefault());
  });
}

// ---------------------------------------------------------------- modal

// input: { type: 'text'|'password'|'textarea'|'number', placeholder, value, rows }
// validate(value) may return an error string (or a promise of one) to keep the modal open.
export function modal({ title, text = '', html = '', input = null, actions = [{ label: 'OK', value: true, primary: true }], validate = null }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const attrs = `autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${esc(input?.placeholder || '')}"`;
    let field = '';
    if (input?.type === 'textarea') field = `<textarea class="m-in" rows="${input.rows || 8}" ${attrs}>${esc(input.value || '')}</textarea>`;
    else if (input?.type === 'password') field = pwInput(`class="m-in" ${attrs} autocomplete="current-password"`);
    else if (input) field = `<input class="m-in" type="${input.type === 'number' ? 'number' : 'text'}" ${input.type === 'number' ? 'inputmode="numeric"' : ''} ${attrs} value="${esc(input.value || '')}">`;
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${html}
      ${field}
      <div class="form-err" hidden></div>
      <div class="btns">${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}" data-i="${i}" type="button">${esc(a.label)}</button>`).join('')}</div>
    </div>`;
    const inp = $('.m-in', back);
    const errEl = $('.form-err', back);
    let busy = false;
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const choose = async (a) => {
      if (busy) return;
      const v = input ? (a.value === null || a.value === false ? null : (input.type === 'password' ? inp.value : inp.value.trim())) : a.value;
      if (validate && v !== null && v !== false && v !== undefined) {
        busy = true; $$('button', back).forEach((b) => (b.disabled = true));
        let err = null;
        try { err = await validate(v); } catch (e) { err = friendly(e); }
        busy = false; $$('button', back).forEach((b) => (b.disabled = false));
        if (err) { errEl.hidden = false; errEl.textContent = err; inp?.focus(); inp?.select?.(); return; }
      }
      close(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && input && input.type !== 'textarea' && e.target === inp) { const a = actions.find((x) => x.primary); if (a) { e.preventDefault(); choose(a); } }
      if (e.key === 'Enter' && input?.type === 'textarea' && (e.metaKey || e.ctrlKey)) { const a = actions.find((x) => x.primary); if (a) { e.preventDefault(); choose(a); } }
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => {
      if (e.target === back) return close(null);
      const b = e.target.closest('button[data-i]');
      if (b) choose(actions[+b.dataset.i]);
    });
    $('#modal-root').appendChild(back);
    wirePasswordReveal(back);
    (inp || $('.btn.primary', back) || $('.btn', back))?.focus();
    if (inp && input?.value && inp.select && input.type !== 'textarea') {
      // select the stem of a file name, like VS Code's rename box
      const dot = inp.value.lastIndexOf('.'), slash = inp.value.lastIndexOf('/');
      try { inp.setSelectionRange(slash + 1, dot > slash + 1 ? dot : inp.value.length); } catch {}
    }
  });
}
export const confirmBox = (title, text, label = 'OK', danger = false) => modal({
  title, text, actions: [{ label: 'Cancel', value: false }, { label, value: true, primary: !danger, danger }],
});

// Context menu: popup near the pointer on desktop, bottom sheet on phones.
// items: [{ id, label, icon, danger, key } | '-']
export function menu(items, at = null, title = '') {
  return new Promise((resolve) => {
    document.querySelector('.menu-back')?.remove();
    const back = document.createElement('div');
    const sheet = isPhone() || !at;
    back.className = `menu-back${sheet ? ' sheet' : ''}`;
    back.innerHTML = `<div class="menu" role="menu">${sheet && title ? `<div class="menu-title">${esc(title)}</div>` : ''}${items.map((it, i) => (it === '-' ? '<div class="msep"></div>'
      : `<button class="mi${it.danger ? ' danger' : ''}" role="menuitem" type="button" data-i="${i}">${it.icon ? icon(it.icon, 16) : ''}<span class="ml">${esc(it.label)}</span>${it.key ? `<span class="k">${esc(it.key)}</span>` : ''}</button>`)).join('')}
      ${sheet ? '<button class="mi cancel" type="button" data-cancel>Cancel</button>' : ''}</div>`;
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) return close(items[+b.dataset.i].id);
      if (e.target === back || e.target.closest('[data-cancel]')) close(null);
    });
    back.addEventListener('contextmenu', (e) => { e.preventDefault(); close(null); });
    document.body.appendChild(back);
    if (!sheet) {
      const m = $('.menu', back);
      const r = m.getBoundingClientRect();
      const x = Math.min(at.x, window.innerWidth - r.width - 8), y = Math.min(at.y, window.innerHeight - r.height - 8);
      m.style.left = `${Math.max(8, x)}px`; m.style.top = `${Math.max(8, y)}px`;
    }
  });
}

// ---------------------------------------------------------------- settings (this device only)

const DEFAULTS = () => ({
  fontSize: 14, wordWrap: isPhone(), tabSize: 2, theme: 'velaryn-dark', autoSave: false,
  minimap: !isPhone(), claudeModel: 'claude-opus-5-5',
});
let settingsCache = null;
export function settings() {
  if (!settingsCache) {
    let saved = {};
    try { saved = JSON.parse(store.get('vc_settings') || '{}') || {}; } catch {}
    settingsCache = { ...DEFAULTS(), ...saved };
  }
  return settingsCache;
}
export function setSetting(patch) {
  const s = settings();
  Object.assign(s, patch);
  const saved = {};
  try { Object.assign(saved, JSON.parse(store.get('vc_settings') || '{}')); } catch {}
  Object.assign(saved, patch);
  store.set('vc_settings', JSON.stringify(saved));
  emit('settings', s, patch);
}

// ---------------------------------------------------------------- cloud data

export async function fetchRows(project) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = S.client.from('vc_files').select('*').order('path').range(from, from + 999);
    if (project) q = q.eq('project', project);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

export async function fetchRow(project, path) {
  const { data, error } = await S.client.from('vc_files').select('*').eq('project', project).eq('path', path).maybeSingle();
  if (error) throw error;
  if (data) S.rows.set(keyOf(project, path), data);
  return data;
}

export const liveFiles = (project) => [...S.rows.values()].filter((r) => r.project === project && !r.deleted);
export const liveRow = (project, path) => { const r = S.rows.get(keyOf(project, path)); return r && !r.deleted ? r : null; };

export async function ensureProject(name, kind) {
  const existing = S.projectMeta.find((p) => p.name === name);
  if (existing && existing.kind !== 'deleted') return;
  const row = { user_id: S.user.id, name, kind, device_name: DEVICE.name, device_os: DEVICE.os, updated_at: new Date().toISOString() };
  // Plain upsert (not ignoreDuplicates) so a project deleted earlier comes back to life.
  const { error } = await S.client.from('vc_projects').upsert(row, { onConflict: 'user_id,name' });
  if (error) throw error;
  if (existing) Object.assign(existing, row); else S.projectMeta.push(row);
}

const blobKey = (hash) => `${S.user.id}/blobs/${hash}`;

export async function uploadBlob(bytes, hash) {
  const { error } = await S.client.storage.from(BUCKET)
    .upload(blobKey(hash), new Blob([bytes], { type: 'application/octet-stream' }), { upsert: false, contentType: 'application/octet-stream' });
  if (error && !/exists|duplicate/i.test(error.message) && String(error.statusCode) !== '409' && error.status !== 409) throw error;
}

// Blobs are immutable (named by their hash), so a small in-memory cache is always correct.
const blobCache = new Map(); let blobCacheBytes = 0;
export async function downloadBlob(hash) {
  if (blobCache.has(hash)) { const b = blobCache.get(hash); blobCache.delete(hash); blobCache.set(hash, b); return b; }
  const { data, error } = await S.client.storage.from(BUCKET).download(blobKey(hash));
  if (error) throw error;
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.length <= 2 * 1024 * 1024) {
    blobCache.set(hash, bytes); blobCacheBytes += bytes.length;
    for (const [k, v] of blobCache) { if (blobCacheBytes <= 40 * 1024 * 1024) break; blobCache.delete(k); blobCacheBytes -= v.length; }
  }
  return bytes;
}

export class ConflictError extends Error {}

export async function commit(project, path, { hash, size, deleted }, baseVersion, force = false) {
  const { data, error } = await S.client.rpc('vc_commit', {
    p_project: project, p_path: path, p_hash: hash || '', p_size: size || 0,
    p_base_version: baseVersion || 0, p_deleted: !!deleted,
    p_device_id: DEVICE.id, p_device_name: DEVICE.name, p_device_os: DEVICE.os, p_force: force,
  });
  if (error) {
    if (/VC_CONFLICT/.test(error.message)) throw new ConflictError('Changed on another device');
    throw error;
  }
  S.rows.set(keyOf(project, path), data);
  emit('rows');
  return data;
}

// Same format as the desktop app: files up to CHUNK are one blob named by their sha256. Bigger files
// are stored as 40 MiB slices (each named by its own sha256) plus a manifest '<sha256 of file>.parts'.
// The vc_files row always carries the hash and size of the whole file.
export async function putBytes(project, path, bytes, baseVersion, force = false, onProgress = null) {
  if (bytes.length > MAX_SIZE) throw new Error(`${baseName(path)} is over 2 GB, which is the most Velaryn can sync.`);
  let hash;
  try { hash = await sha256(bytes); } catch (e) {
    if (bytes.length > CHUNK) throw new Error(`${baseName(path)} is too big for this device to process. Try from a computer.`);
    throw e;
  }
  if (bytes.length <= CHUNK) {
    await uploadBlob(bytes, hash);
  } else {
    const n = Math.ceil(bytes.length / CHUNK);
    const chunks = [];
    for (let i = 0; i < n; i++) {
      onProgress?.(`Uploading ${i + 1} of ${n}`, i, n);
      const slice = bytes.subarray(i * CHUNK, Math.min(bytes.length, (i + 1) * CHUNK));
      const h = await sha256(slice);
      await uploadBlob(slice, h);
      chunks.push({ hash: h, size: slice.length });
    }
    const manifest = JSON.stringify({ v: 1, size: bytes.length, chunks });
    const { error } = await S.client.storage.from(BUCKET)
      .upload(`${blobKey(hash)}.parts`, new Blob([manifest], { type: 'application/json' }), { upsert: false, contentType: 'application/json' });
    if (error && !/exists|duplicate/i.test(error.message) && String(error.statusCode) !== '409' && error.status !== 409) throw error;
  }
  return commit(project, path, { hash, size: bytes.length, deleted: false }, baseVersion, force);
}

// Read a file row's bytes (handles chunked files; verifies the reassembled hash).
export async function readRow(row, onProgress = null) {
  if (Number(row.size) <= CHUNK) return downloadBlob(row.hash);
  const { data, error } = await S.client.storage.from(BUCKET).download(`${blobKey(row.hash)}.parts`);
  if (error) throw error;
  const manifest = JSON.parse(await data.text());
  const total = Number(manifest.size) || manifest.chunks.reduce((a, c) => a + c.size, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (let i = 0; i < manifest.chunks.length; i++) {
    onProgress?.(`Downloading ${i + 1} of ${manifest.chunks.length}`, i, manifest.chunks.length);
    const part = await downloadBlob(manifest.chunks[i].hash);
    out.set(part, off); off += part.length;
  }
  if (off !== total || (await sha256(out)) !== row.hash) throw new Error(`${baseName(row.path)} didn't download correctly. Try again.`);
  return out;
}

// ---------------------------------------------------------------- upload / download

export function pickFiles(folder, project, prefix = '') {
  const input = folder ? $('#pick-folder') : $('#pick-files');
  input.value = '';
  input.onchange = () => { const list = [...input.files]; input.value = ''; if (list.length) uploadFiles(list, project, prefix); };
  input.click();
}

export async function uploadFiles(files, project, prefix = '') {
  const loose = project === LOOSE;
  files = files.filter((f) => !cleanPath(f.webkitRelativePath || f.name).split('/').some((s) => IGNORE.has(s)));
  if (!files.length) { toast('Nothing to upload.', 'warn'); return 0; }
  const t = toast(`Uploading 0 / ${files.length}…`, '', { sticky: true, spin: true });
  let done = 0, failed = 0, conflicts = 0, tooBig = 0;
  try {
    await ensureProject(project, loose ? 'files' : 'folder');
    const taken = new Set(liveFiles(project).map((r) => r.path));
    for (const file of files) {
      try {
        if (file.size > MAX_SIZE) { tooBig++; continue; }
        const at = done + failed + conflicts + tooBig + 1;
        let path = cleanPath(loose ? file.name : `${prefix ? `${prefix}/` : ''}${file.webkitRelativePath || file.name}`);
        if (!path) { failed++; continue; }
        if (loose) {  // same naming as the desktop app: "name (2).ext"
          const dot = path.lastIndexOf('.');
          const stem = dot > 0 ? path.slice(0, dot) : path, ext = dot > 0 ? path.slice(dot) : '';
          for (let i = 2; taken.has(path); i++) path = `${stem} (${i})${ext}`;
          taken.add(path);
        }
        const existing = S.rows.get(keyOf(project, path));
        await putBytes(project, path, new Uint8Array(await file.arrayBuffer()), existing?.version || 0, false,
          (msg) => t.update(`${baseName(path)}: ${msg} (file ${at} / ${files.length})…`));
        done++;
      } catch (e) {
        if (e instanceof ConflictError) conflicts++; else { failed++; console.warn(e); if (!navigator.onLine) throw e; }
      }
      t.update(`Uploading ${done + failed + conflicts + tooBig} / ${files.length}…`);
    }
    const extra = [tooBig && `${tooBig} over 2 GB skipped`, conflicts && `${conflicts} changed on another device`, failed && `${failed} failed`].filter(Boolean).join(', ');
    t.done(`Uploaded ${done} file${done === 1 ? '' : 's'}${extra ? ` (${extra})` : ''}`, failed || conflicts || tooBig ? 'warn' : 'ok');
  } catch (e) {
    t.done(friendly(e), 'err');
  }
  emit('rows');
  emit('uploaded', project, done);
  return done;
}

export async function downloadFile(project, path) {
  const row = liveRow(project, path);
  if (!row) return toast('That file is no longer in the cloud.', 'warn');
  const t = toast('Downloading…', '', { sticky: true, spin: true });
  try {
    const bytes = await readRow(row, (m) => t.update(`${m}…`));
    saveBlob(new Blob([bytes]), baseName(path));
    t.close();
  } catch (e) { t.done(friendly(e), 'err'); }
}

export async function downloadZip(project, prefix = '') {
  if (!window.JSZip) return toast('The zip library did not load. Check your connection and reload.', 'err');
  const files = liveFiles(project).filter((f) => !prefix || f.path.startsWith(`${prefix}/`));
  if (!files.length) return toast('Nothing to download.', 'warn');
  const t = toast(`Preparing 0 / ${files.length}…`, '', { sticky: true, spin: true });
  try {
    const zip = new window.JSZip();
    let n = 0, i = 0;
    const worker = async () => {
      while (i < files.length) {
        const f = files[i++];
        zip.file(prefix ? f.path.slice(prefix.length + 1) : f.path, await readRow(f));
        t.update(`Preparing ${++n} / ${files.length}…`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
    t.update('Zipping…');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    saveBlob(blob, `${(prefix ? baseName(prefix) : projectLabel(project)).replace(/[/\\:]/g, '-')}.zip`);
    t.done('Download ready');
  } catch (e) { t.done(friendly(e), 'err'); }
}

// ---------------------------------------------------------------- monaco

let monacoP;
export function loadMonaco() {
  if (monacoP) return monacoP;
  monacoP = new Promise((resolve, reject) => {
    const fail = () => { monacoP = null; reject(new Error('The editor could not load. Check your connection and reload.')); };
    // Monaco's AMD loader is injected only when the editor is needed (app mode), never on the website.
    if (!window.require?.config) {
      const sc = document.createElement('script');
      sc.src = `${MONACO_BASE}/vs/loader.js`;
      sc.onload = () => (window.require?.config ? start() : fail());
      sc.onerror = fail;
      document.head.appendChild(sc);
    } else start();
    function start() {
    const req = window.require;
    window.MonacoEnvironment = {
      getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(
        `self.MonacoEnvironment={baseUrl:'${MONACO_BASE}/'};importScripts('${MONACO_BASE}/vs/base/worker/workerMain.js');`)}`,
    };
    req.config({ paths: { vs: `${MONACO_BASE}/vs` } });
    req(['vs/editor/editor.main'], () => { defineTheme(window.monaco); resolve(window.monaco); }, (e) => { monacoP = null; reject(e); });
    }
  });
  return monacoP;
}

function defineTheme(monaco) {
  // Same palette as the desktop app (renderer/app.js defineThemes)
  monaco.editor.defineTheme('velaryn-dark', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '5d6a86', fontStyle: 'italic' },
      { token: 'keyword', foreground: '5aa8ff' },
      { token: 'string', foreground: '8fe1c0' },
      { token: 'number', foreground: 'f5b97a' },
      { token: 'type', foreground: '6fd3ff' },
      { token: 'type.identifier', foreground: '6fd3ff' },
      { token: 'delimiter', foreground: '9aa4bd' },
      { token: 'tag', foreground: '5aa8ff' },
      { token: 'attribute.name', foreground: '9cc7ff' },
      { token: 'attribute.value', foreground: '8fe1c0' },
      { token: 'variable', foreground: 'd6dcea' },
      { token: 'regexp', foreground: 'f28fad' },
    ],
    colors: {
      'editor.background': '#0b0e17',
      'editor.foreground': '#d6dcea',
      'editorLineNumber.foreground': '#3a4460',
      'editorLineNumber.activeForeground': '#9fb3dd',
      'editor.lineHighlightBackground': '#121829',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#2453b366',
      'editor.inactiveSelectionBackground': '#2453b333',
      'editorCursor.foreground': '#3fc3ff',
      'editorIndentGuide.background1': '#1a2135',
      'editorIndentGuide.activeBackground1': '#2e3a5c',
      'editorWidget.background': '#141a2b',
      'editorWidget.border': '#263152',
      'editorSuggestWidget.background': '#141a2b',
      'editorSuggestWidget.selectedBackground': '#1b2a4d',
      'editorHoverWidget.background': '#141a2b',
      'minimap.background': '#0b0e17',
      'scrollbarSlider.background': '#7890be22',
      'scrollbarSlider.hoverBackground': '#7890be44',
      'editorGutter.background': '#0b0e17',
    },
  });
}

const LANGS = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  json: 'json', jsonc: 'json', webmanifest: 'json', html: 'html', htm: 'html', xml: 'xml', svg: 'xml', plist: 'xml', css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown', py: 'python', pyw: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', m: 'objective-c', mm: 'objective-c', cs: 'csharp', fs: 'fsharp',
  php: 'php', sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'powershell', psm1: 'powershell', bat: 'bat', cmd: 'bat', sql: 'sql', yml: 'yaml', yaml: 'yaml',
  toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'ini', lua: 'lua', r: 'r', dart: 'dart', scala: 'scala', pl: 'perl', pm: 'perl', ex: 'elixir', exs: 'elixir',
  clj: 'clojure', coffee: 'coffeescript', graphql: 'graphql', gql: 'graphql', vue: 'html', svelte: 'html', hbs: 'handlebars', pug: 'pug', sol: 'sol', tf: 'hcl', hcl: 'hcl',
  proto: 'proto', dockerfile: 'dockerfile', jl: 'julia', vb: 'vb', tcl: 'tcl', twig: 'twig', liquid: 'liquid', rst: 'restructuredtext', txt: 'plaintext',
};
export function guessLang(path) {
  const n = baseName(path).toLowerCase();
  if (n === 'dockerfile' || n.startsWith('dockerfile.')) return 'dockerfile';
  if (n === 'makefile') return 'shell';
  if (/^\.(bashrc|zshrc|profile|bash_profile)$/.test(n)) return 'shell';
  if (/^\.env(\..*)?$/.test(n)) return 'ini';
  if (/^\.(gitignore|npmrc|editorconfig)$/.test(n)) return 'ini';
  return LANGS[n.includes('.') ? n.split('.').pop() : ''] || 'plaintext';
}

export const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|heic|tiff?|psd|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|class|so|dylib|dll|exe|bin|o|a|wasm|woff2?|ttf|otf|eot|mp3|mp4|m4a|mov|avi|mkv|webm|wav|flac|ogg|sqlite|db|pyc|dmg|iso|apk|ipa|aab)$/i;
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|svg)$/i;

export function decodeText(bytes) {
  const head = bytes.subarray(0, 8000);
  if (head.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return null; }
}
