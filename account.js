// Account: profile picture, devices (register / remove / revocation) and the Settings screen.
import {
  S, $, $$, esc, store, session, BUCKET, glyphFor, DEVICE, refreshDevice, timeAgo, toast, toastErr, friendly,
  modal, confirmBox, settings, setSetting, emit, on, pwInput, wirePasswordReveal, isPhone, getConfigHost, isApp,
} from './core.js?v=1793470528';
import { icon, claudeLogo } from './icons.js?v=1793470528';

// ---------------------------------------------------------------- profile picture
// Display priority (same as the desktop app):
//  1) user_metadata.avatar_path (cached by avatar_v)  2) the standard <uid>/profile/avatar.jpg
//  3) user_metadata.avatar_url from OAuth             4) the email initial in a gradient circle
const avatarPathFor = (uid) => `${uid}/profile/avatar.jpg`;
let avatarCache = { key: null, url: null };
let avatarLoading = null;

async function downloadObject(path) {
  const { data, error } = await S.client.storage.from(BUCKET).download(path);
  if (error) throw error;
  return URL.createObjectURL(data);
}

export async function avatarUrl() {
  const u = S.user; if (!u) return null;
  const md = u.user_metadata || {};
  const key = md.avatar_path ? `meta:${md.avatar_path}@${md.avatar_v || 0}` : `std:${u.id}|${md.avatar_url || md.picture || ''}`;
  if (avatarCache.key === key) return avatarCache.url;
  if (avatarLoading?.key === key) return avatarLoading.p;
  const p = (async () => {
    let url = null;
    if (md.avatar_path) { try { url = await downloadObject(md.avatar_path); } catch {} }
    if (!url && !md.avatar_path) { try { url = await downloadObject(avatarPathFor(u.id)); } catch { /* not found means none */ } }
    if (!url) { const pic = md.avatar_url || md.picture; if (pic && /^https:\/\//.test(pic)) url = pic; }
    if (avatarCache.url?.startsWith('blob:') && avatarCache.url !== url) URL.revokeObjectURL(avatarCache.url);
    avatarCache = { key, url };
    return url;
  })();
  avatarLoading = { key, p };
  try { return await p; } finally { if (avatarLoading?.p === p) avatarLoading = null; }
}

export const initialOf = (u) => (u?.email || u?.user_metadata?.name || '?').trim().charAt(0).toUpperCase();

// Paint every element with [data-avatar] (header, settings…)
export async function paintAvatars(root = document) {
  const els = $$('[data-avatar]', root);
  if (!els.length || !S.user) return;
  for (const el of els) { if (!el.querySelector('img')) el.textContent = initialOf(S.user); }
  const url = await avatarUrl();
  for (const el of $$('[data-avatar]', root)) {
    el.textContent = initialOf(S.user);
    if (!url) continue;
    const img = new Image(); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.decoding = 'async'; img.src = url;
    img.onload = () => { el.textContent = ''; el.appendChild(img); };
  }
}

async function cropTo256(file) {
  let source;
  try { source = await createImageBitmap(file); } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image(); const u = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('That image format isn’t supported. Use a PNG or JPEG.')); };
      img.src = u;
    });
  }
  const w = source.width, h = source.height, side = Math.min(w, h);
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, Math.floor((w - side) / 2), Math.floor((h - side) / 2), side, side, 0, 0, 256, 256);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process that image.'))), 'image/jpeg', 0.88));
}

export function changePicture() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0]; if (!file) return;
    const t = toast('Updating your picture…', '', { sticky: true, spin: true });
    try {
      const blob = await cropTo256(file);
      const path = avatarPathFor(S.user.id);
      const { error } = await S.client.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (error) throw error;
      const { data, error: uErr } = await S.client.auth.updateUser({ data: { avatar_path: path, avatar_v: Date.now() } });
      if (uErr) throw uErr;
      if (data?.user) S.user = data.user;
      await paintAvatars();
      t.done('Picture updated');
    } catch (e) { t.done(friendly(e), 'err'); }
  };
  input.click();
}

// ---------------------------------------------------------------- devices

export async function registerDevice() {
  refreshDevice();
  const { error } = await S.client.from('vc_devices').upsert({
    user_id: S.user.id, id: DEVICE.id, name: DEVICE.name, os: DEVICE.os, last_seen: new Date().toISOString(),
  });
  if (error) console.warn('Could not register device:', error.message);
}

export async function loadDevices() {
  const { data, error } = await S.client.from('vc_devices').select('*').order('last_seen', { ascending: false });
  if (!error) S.devices = data || [];
  return S.devices;
}

const revokedList = (u = S.user) => (Array.isArray(u?.user_metadata?.revoked_devices) ? u.user_metadata.revoked_devices : []);
export const isRevoked = (u = S.user) => revokedList(u).includes(DEVICE.id);

// A fresh sign-in on this device clears it from the revocation list (before registering).
export async function unrevokeSelf() {
  if (!isRevoked()) return;
  const next = revokedList().filter((x) => x !== DEVICE.id);
  const { data, error } = await S.client.auth.updateUser({ data: { revoked_devices: next } });
  if (error) console.warn('Could not clear revocation:', error.message);
  else if (data?.user) S.user = data.user;
}

export async function revokedSignOut(msg = 'This device was removed from your account. Sign in again to use it.') {
  if (S.signingOut) return;
  S.signingOut = true;
  S.signoutMsg = msg;
  try { await S.client.auth.signOut({ scope: 'local' }); } catch {}
  S.signingOut = false;
}

export function checkRevoked() {
  if (S.user && !S.removingSelf && isRevoked()) { revokedSignOut(); return true; }
  return false;
}

const providersOf = (u) => {
  const list = [...(u?.app_metadata?.providers || []), u?.app_metadata?.provider, ...(u?.identities || []).map((i) => i.provider)].filter(Boolean);
  return [...new Set(list)];
};
const PROVIDER_NAMES = { google: 'Google', github: 'GitHub', discord: 'Discord', apple: 'Apple', azure: 'Microsoft', gitlab: 'GitLab' };

// Remove a device: verify the user, delete its row and add its id to user_metadata.revoked_devices.
export async function removeDevice(id) {
  const d = S.devices.find((x) => x.id === id);
  const self = id === DEVICE.id;
  const name = d?.name || 'this device';
  const u = S.user;
  const provs = providersOf(u);
  const oauthProvs = provs.filter((p) => p !== 'email');
  const hasPassword = provs.includes('email') || !oauthProvs.length;
  if (hasPassword) {
    const pw = await modal({
      title: `Remove ${name}?`,
      text: `${self ? 'This device will be signed out. ' : 'It will be signed out the next time it opens Velaryn. '}Enter your password to confirm.`,
      input: { type: 'password', placeholder: 'Password' },
      actions: [{ label: 'Cancel', value: null }, { label: 'Remove', primary: true }],
      validate: async (password) => {
        if (!password) return 'Enter your password.';
        const { error } = await S.client.auth.signInWithPassword({ email: u.email, password });
        return error ? (/invalid/i.test(error.message) ? 'Wrong password' : friendly(error)) : null;
      },
    });
    if (pw == null) return false;
    return finishRemoval(id);
  }
  const prov = oauthProvs[0];
  const pname = PROVIDER_NAMES[prov] || prov;
  const ok = await modal({
    title: `Remove ${name}?`,
    text: `To remove a device, confirm it's you by signing in with ${pname} again. You'll come straight back here and the device is removed.`,
    actions: [{ label: 'Cancel', value: false }, { label: `Verify with ${pname}`, value: true, primary: true }],
  });
  if (!ok) return false;
  session.set('vc_pending_remove', id);
  S.hooks.oauth(prov, { reverify: true });
  return false;
}

export async function finishRemoval(id) {
  const self = id === DEVICE.id;
  const t = toast('Removing device…', '', { sticky: true, spin: true });
  try {
    if (self) S.removingSelf = true;
    const { error } = await S.client.from('vc_devices').delete().eq('id', id);
    if (error) throw error;
    // read-modify-write the revocation list with the freshest metadata
    const { data: fresh } = await S.client.auth.getUser();
    const current = revokedList(fresh?.user || S.user);
    const { data, error: uErr } = await S.client.auth.updateUser({ data: { revoked_devices: [...new Set([...current, id])] } });
    if (uErr) throw uErr;
    if (data?.user && !self) S.user = data.user;
    S.devices = S.devices.filter((x) => x.id !== id);
    t.done('Device removed');
    emit('devices');
    if (self) await revokedSignOut('This device was removed from your account. Sign in again to use it.');
    return true;
  } catch (e) {
    t.done(friendly(e), 'err');
    return false;
  } finally {
    S.removingSelf = false;
  }
}

export function devicesHtml() {
  if (!S.devices.length) return '<div class="empty">No devices yet.</div>';
  return `<div class="list">${S.devices.map((d) => `<div class="list-row">
      <span class="glyph" aria-hidden="true">${esc(glyphFor(d.os))}</span>
      <div class="main"><div class="t">${esc(d.name || d.os || 'Device')}${d.id === DEVICE.id ? '<span class="tag">This device</span>' : ''}</div><div class="s">${esc(d.os || '')} · last seen ${esc(timeAgo(d.last_seen))}</div></div>
      <button class="btn small ghost danger-text" type="button" data-remove-device="${esc(d.id)}">Remove</button>
    </div>`).join('')}</div>`;
}

export function bindDevices(root) {
  $$('[data-remove-device]', root).forEach((b) => b.addEventListener('click', () => removeDevice(b.dataset.removeDevice)));
}

// ---------------------------------------------------------------- sign out

export async function signOut() {
  const dirty = S.hooks.dirtyCount?.() || 0;
  if (dirty && !(await confirmBox('Discard unsaved changes?', `You have ${dirty} file${dirty > 1 ? 's' : ''} with edits that are not saved to the cloud.`, 'Sign out', true))) return;
  S.hooks.discardAll?.();
  await S.client.auth.signOut().catch(() => {});
  history.replaceState(null, '', location.pathname + location.search);
}

// ---------------------------------------------------------------- settings screen

export const claudeKey = () => store.get('vc_claude_key') || '';
export function setClaudeKey(k) { if (k) store.set('vc_claude_key', k); else store.del('vc_claude_key'); emit('claude-key'); }

export const CLAUDE_MODELS = [['claude-opus-5-5', 'Opus 5.5'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-haiku-5-5', 'Haiku 5.5']];
const THEMES = [['velaryn-dark', 'Velaryn Dark'], ['vs-dark', 'Dark (Visual Studio)'], ['hc-black', 'High Contrast Dark']];

const sw = (k) => `<button class="switch${settings()[k] ? ' on' : ''}" type="button" role="switch" aria-checked="${!!settings()[k]}" data-sw="${k}"></button>`;
const sel = (k, opts) => `<select data-sel="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(settings()[k]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

export function claudeKeyHtml() {
  const key = claudeKey();
  if (key) {
    return `<div class="set-row"><div><div>${claudeLogo(16)} Connected</div><div class="d">Key ending in <code>${esc(key.slice(-4))}</code>, stored only on this device.</div></div>
      <button class="btn small danger" type="button" data-claude-key="remove">Remove</button></div>`;
  }
  return `<div class="set-block">
      <p class="d">Connect your Claude account: create an API key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> (sign in with your Claude account) and paste it here.</p>
      <div class="key-row">${pwInput('class="text" data-claude-key-input placeholder="sk-ant-…" autocomplete="off" autocapitalize="off" spellcheck="false"')}
        <button class="btn small primary" type="button" data-claude-key="save">Save</button></div>
      <p class="d tiny">The key is saved only in this browser's storage on this device and is sent only to Anthropic. Phones can't run Claude Code, so Claude here talks to the Anthropic API directly and usage is billed to that key.</p>
    </div>`;
}

export function bindClaudeKey(root, after) {
  wirePasswordReveal(root);
  const input = $('[data-claude-key-input]', root);
  const save = () => {
    const v = (input?.value || '').trim();
    if (!/^sk-ant-/.test(v) || v.length < 20) return toast('That doesn’t look like an Anthropic API key (it starts with sk-ant-).', 'warn', { ms: 5000 });
    setClaudeKey(v);
    toast('Claude connected on this device', 'ok');
    after?.();
  };
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  $$('[data-claude-key]', root).forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.claudeKey === 'save') return save();
    if (await confirmBox('Remove the Claude API key?', 'Claude stops working on this device until you add a key again.', 'Remove', true)) { setClaudeKey(''); after?.(); }
  }));
}

export function renderSettings(el, { onClose = null } = {}) {
  const u = S.user;
  if (!u) return;
  const s = settings();
  const provs = providersOf(u).map((p) => (p === 'email' ? 'Email' : PROVIDER_NAMES[p] || p)).join(', ');
  el.innerHTML = `
    <div class="settings">
      <div class="settings-head"><h2>Settings</h2>${onClose ? `<button class="btn icon small ghost" type="button" data-close aria-label="Close settings">${icon('close', 16)}</button>` : ''}</div>
      <section class="set-group">
        <h3>Account</h3>
        <div class="set-card">
          <div class="account-row">
            <span class="avatar big" data-avatar></span>
            <div class="who"><div class="email">${esc(u.email || u.user_metadata?.name || '')}</div><div class="d">${esc(provs || 'Signed in')}</div></div>
          </div>
          <div class="set-actions">
            <button class="btn small" type="button" data-act="picture">${icon('camera', 15)} Change picture</button>
            <button class="btn small" type="button" data-act="signout">${icon('logout', 15)} Sign out</button>
          </div>
        </div>
      </section>
      ${isApp() ? `<section class="set-group">
        <h3>Editor</h3>
        <div class="set-card">
          <div class="set-row"><div><div>Font size</div></div>
            <div class="stepper"><button type="button" class="btn small icon" data-font="-1" aria-label="Smaller">${icon('minus', 14)}</button><span class="val">${s.fontSize}</span><button type="button" class="btn small icon" data-font="1" aria-label="Bigger">${icon('plus', 14)}</button></div></div>
          <div class="set-row"><div><div>Word wrap</div><div class="d">Wrap long lines to the screen width.</div></div>${sw('wordWrap')}</div>
          <div class="set-row"><div><div>Tab size</div></div>${sel('tabSize', [[2, '2 spaces'], [4, '4 spaces'], [8, '8 spaces']])}</div>
          <div class="set-row"><div><div>Color theme</div></div>${sel('theme', THEMES)}</div>
          <div class="set-row"><div><div>Auto save</div><div class="d">Save to the cloud a moment after you stop typing.</div></div>${sw('autoSave')}</div>
          ${isPhone() ? '' : `<div class="set-row"><div><div>Minimap</div></div>${sw('minimap')}</div>`}
        </div>
      </section>
      <section class="set-group">
        <h3>${claudeLogo(15)} Claude</h3>
        <div class="set-card" data-claude-settings>${claudeKeyHtml()}
          <div class="set-row"><div><div>Model</div></div>${sel('claudeModel', CLAUDE_MODELS)}</div></div>
      </section>` : ''}
      <section class="set-group">
        <h3>Devices</h3>
        <div data-devices>${devicesHtml()}</div>
      </section>
      ${isApp() ? '' : `<section class="set-group">
        <h3>Get the apps</h3>
        <div class="set-card"><div class="set-block">
          <p>Edit your code with the Velaryn Code apps: the desktop app for Mac, and the iPhone, iPad and Android apps with the full editor and Claude.</p>
          <p class="d">This website is for managing your projects, files and devices from any browser.</p>
        </div></div>
      </section>`}
      <section class="set-group">
        <h3>About</h3>
        <div class="set-card">
          <div class="set-row"><div><div>This device</div><div class="d">${esc(DEVICE.name)}</div></div></div>
          <div class="set-row"><div><div>Cloud</div><div class="d">${esc(getConfigHost())}</div></div></div>
        </div>
      </section>
    </div>`;
  paintAvatars(el);
  bindDevices(el);
  bindClaudeKey(el, () => renderSettings(el, { onClose }));
  $('[data-close]', el)?.addEventListener('click', onClose);
  $('[data-act=picture]', el).addEventListener('click', changePicture);
  $('[data-act=signout]', el).addEventListener('click', signOut);
  $$('[data-sw]', el).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.sw; const v = !settings()[k];
    setSetting({ [k]: v });
    b.classList.toggle('on', v); b.setAttribute('aria-checked', String(v));
  }));
  $$('[data-sel]', el).forEach((sl) => sl.addEventListener('change', () => {
    const k = sl.dataset.sel;
    setSetting({ [k]: k === 'tabSize' ? Number(sl.value) : sl.value });
  }));
  $$('[data-font]', el).forEach((b) => b.addEventListener('click', () => {
    const v = Math.max(9, Math.min(28, settings().fontSize + Number(b.dataset.font)));
    setSetting({ fontSize: v });
    $('.stepper .val', el).textContent = v;
  }));
  const offDev = on('devices', () => { const d = $('[data-devices]', el); if (d && el.isConnected) { d.innerHTML = devicesHtml(); bindDevices(d); } else offDev(); });
  loadDevices().then(() => emit('devices')).catch(() => {});
}

export { toastErr };
