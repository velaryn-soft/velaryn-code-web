// Velaryn Code web companion: entry point (sign-in, home, routing, realtime).
// In the phone apps (isApp) a project opens the editor workspace (workspace.js, Claude in claude.js),
// loaded on demand. On the website a project opens the file manager (files.js); no editor is loaded.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import {
  S, $, $$, esc, store, session, keyOf, projectLabel, LOOSE, CFG, DEVICE, fmtSize, deviceHtml, friendly,
  toast, toastErr, modal, confirmBox, fetchRows, ensureProject, pickFiles, emit, on, wirePasswordReveal, isApp,
} from './core.js?v=1793470528';
import { icon } from './icons.js?v=1793470528';
import {
  paintAvatars, registerDevice, loadDevices, unrevokeSelf, isRevoked, checkRevoked, revokedSignOut, finishRemoval,
  devicesHtml, bindDevices, renderSettings, signOut,
} from './account.js?v=1793470528';
import { renderProject, refreshProject, closeProject } from './files.js?v=1793470528';

// The editor workspace module is only fetched in app mode.
let WS = null, wsP = null;
const loadWs = () => (wsP ||= import('./workspace.js?v=1793470528').then((m) => (WS = m)));
const wsProject = () => WS?.wsProject() || null;
const dirtyCount = () => WS?.dirtyCount() || 0;
const discardAll = () => WS?.discardAll();
const leaveWorkspace = () => WS?.leaveWorkspace();

const PROVIDERS = { google: 'Google', github: 'GitHub', discord: 'Discord', apple: 'Apple', azure: 'Microsoft', gitlab: 'GitLab' };
// Captured before Supabase cleans the URL: did we just come back from an OAuth redirect?
const BOOT_HAD_CODE = new URLSearchParams(location.search).has('code');

S.hooks = { oauth, dirtyCount, discardAll, reload: () => loadAll({ quiet: true }) };

// ---------------------------------------------------------------- config & client

// The desktop app shares a link like #connect=<base64 {"u": url, "k": anon key}> so a phone
// can connect in one tap. The anon key is public by design (row-level security protects data).
(function connectFromHash() {
  const m = /[#&]connect=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (!m) return;
  try {
    const { u, k } = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(u) && k) { store.set('vc_supabase_url', u); store.set('vc_supabase_key', k); }
  } catch {}
  history.replaceState(null, '', location.pathname + location.search);
})();

function getConfig() {
  const fromFile = !!(CFG.supabaseUrl && CFG.supabaseKey);
  const url = (fromFile ? CFG.supabaseUrl : store.get('vc_supabase_url') || '').trim().replace(/\/+$/, '');
  const key = (fromFile ? CFG.supabaseKey : store.get('vc_supabase_key') || '').trim();
  return { url, key, fromFile };
}

function showOnly(id) {
  for (const x of ['setup', 'auth', 'boot']) $(`#${x}`).hidden = x !== id;
}

function showLanding() {
  leaveWorkspace();
  $('#landing').hidden = false; $('#dash').hidden = true;
}

function showSetup(err) {
  showLanding();
  showOnly('setup');
  const f = $('#setup');
  f.url.value = store.get('vc_supabase_url') || '';
  f.key.value = store.get('vc_supabase_key') || '';
  const e = $('.form-err', f); e.hidden = !err; e.textContent = err || '';
}

function setupForms() {
  if (CFG.downloadUrl) { const a = $('#download-mac'); a.href = CFG.downloadUrl; a.hidden = false; }
  wirePasswordReveal(document);

  $('#setup').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const url = f.url.value.trim().replace(/\/+$/, '');
    const key = f.key.value.trim();
    const err = $('.form-err', f);
    if (!/^https:\/\/[^/]+$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
      err.hidden = false; err.textContent = 'The Project URL should look like https://xxxx.supabase.co'; return;
    }
    if (key.length < 20) { err.hidden = false; err.textContent = 'That key looks too short. Copy the anon (public) key.'; return; }
    store.set('vc_supabase_url', url); store.set('vc_supabase_key', key);
    location.reload();
  });

  $$('.prov').forEach((b) => b.addEventListener('click', () => oauth(b.dataset.provider)));

  const ef = $('#email-form');
  let mode = 'signin';
  $$('button[type=submit]', ef).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; }));
  ef.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!S.client) return;
    const email = ef.email.value.trim(), password = ef.password.value;
    authMsg('', '');
    const btns = $$('button', ef); btns.forEach((b) => (b.disabled = true));
    S.freshSignIn = true;  // the user typed credentials on this device
    try {
      if (mode === 'signup') {
        const { data, error } = await S.client.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          authMsg('An account with that email already exists. Sign in instead.');
        } else if (!data.session) {
          authMsg('', 'Account created. Check your email for a confirmation link, then sign in.');
        }
      } else {
        const { error } = await S.client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) {
      S.freshSignIn = false;
      authMsg(/Invalid login/i.test(e.message) ? 'Wrong email or password.' : friendly(e));
    } finally {
      btns.forEach((b) => (b.disabled = false));
    }
  });

  $('#sign-out').addEventListener('click', signOut);
}

function authMsg(err, ok) {
  const e = $('#auth .form-err'), o = $('#auth .form-ok');
  e.hidden = !err; e.textContent = err || '';
  o.hidden = !ok; o.textContent = ok || '';
}

function providerError(provider, msg) {
  const name = PROVIDERS[provider] || provider;
  if (/not enabled|unsupported provider|provider is disabled/i.test(msg || '')) {
    return `${name} sign-in isn't turned on for this Supabase project. Enable it under Authentication → Sign In / Providers (see the README), or use another option.`;
  }
  return `${name} sign-in failed: ${msg}`;
}

// In the phone apps, sign-in opens in a secure in-app browser and comes back through
// app-callback.html on the website, which hands the code to the app via com.velaryn.code://auth.
const APP_CALLBACK = 'https://velaryn-soft.github.io/velaryn-code-web/app-callback.html';
const capPlugin = (name) => window.Capacitor?.Plugins?.[name];

function listenForAppSignIn() {
  const App = capPlugin('App');
  if (!App) return;
  App.addListener('appUrlOpen', async ({ url }) => {
    if (!url?.startsWith('com.velaryn.code://auth')) return;
    capPlugin('Browser')?.close().catch(() => {});
    const q = new URL(url.replace('com.velaryn.code://', 'https://app.invalid/')).searchParams;
    const err = q.get('error_description') || q.get('error');
    if (err) { session.del('vc_pending_remove'); authMsg(err.replace(/\+/g, ' ')); toast(err.replace(/\+/g, ' '), 'err', { ms: 6000 }); return; }
    const code = q.get('code');
    if (!code || !S.client) return;
    const { error } = await S.client.auth.exchangeCodeForSession(code);
    if (error) { authMsg(friendly(error)); toast(friendly(error), 'err', { ms: 6000 }); return; }
    session.set('vc_app_fresh', '1');   // enterApp treats the next start as a fresh sign-in
    location.reload();
  });
}

// The app's code is bundled inside it, so tell the user when a newer app build is published.
async function checkAppUpdate() {
  try {
    const [mine, latest] = await Promise.all([
      fetch('app-version.json').then((r) => r.json()),
      fetch(`https://velaryn-soft.github.io/velaryn-code-web/app-version.json?t=${Date.now()}`).then((r) => r.json()),
    ]);
    if (latest.version && latest.version !== mine.version) {
      toast(`A new version of the app (${latest.version}) is available. Install it from the Velaryn Code App folder in your cloud.`, '', { ms: 10000 });
    }
  } catch {}
}

async function oauth(provider, { reverify = false } = {}) {
  if (!S.client) return;
  if (!reverify) authMsg('', '');
  $$('.prov').forEach((b) => (b.disabled = true));
  try {
    const { data, error } = await S.client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: isApp() ? APP_CALLBACK : location.origin + location.pathname,
        skipBrowserRedirect: true,
        ...(provider === 'azure' ? { scopes: 'email' } : {}),
      },
    });
    if (error) throw error;
    // Probe the authorize URL first: when a provider is disabled Supabase answers with a JSON
    // error instead of a redirect, which would otherwise strand the user on a raw error page.
    try {
      const r = await fetch(data.url, { redirect: 'manual', credentials: 'omit' });
      if (r.type !== 'opaqueredirect' && r.status >= 400) {
        const j = await r.json().catch(() => ({}));
        throw new Error(providerError(provider, j.msg || j.error_description || j.message || `HTTP ${r.status}`));
      }
    } catch (probe) {
      if (/sign-in/.test(probe.message)) throw probe;  // our own error; other failures: just try the redirect
    }
    session.set('vc_oauth_pending', '1');
    if (reverify) session.set('vc_return_hash', location.hash);
    const Browser = isApp() && capPlugin('Browser');
    if (Browser) { await Browser.open({ url: data.url, presentationStyle: 'popover' }); $$('.prov').forEach((b) => (b.disabled = false)); }
    else location.assign(data.url);
  } catch (e) {
    const msg = e.message?.includes('sign-in') ? e.message : providerError(provider, friendly(e));
    if (reverify) { session.del('vc_pending_remove'); toast(msg, 'err', { ms: 6000 }); } else authMsg(msg);
    $$('.prov').forEach((b) => (b.disabled = false));
  }
}

function readUrlError() {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const desc = q.get('error_description') || h.get('error_description') || q.get('error') || h.get('error');
  return desc ? desc.replace(/\+/g, ' ') : '';
}

function cleanUrl() {
  const q = new URLSearchParams(location.search);
  let changed = false;
  for (const k of ['code', 'error', 'error_code', 'error_description', 'state']) if (q.has(k)) { q.delete(k); changed = true; }
  let hash = location.hash;
  if (/error_description|access_token/.test(hash)) { hash = ''; changed = true; }
  if (changed) history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + hash);
}

async function boot() {
  setupForms();
  if (isApp()) { listenForAppSignIn(); checkAppUpdate(); }
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', () => { $('#offline').hidden = false; emit('online'); });
  $('#offline').hidden = navigator.onLine;

  const { url, key, fromFile } = getConfig();
  if (!url || !key) return showSetup();
  S.configHost = url.replace(/^https?:\/\//, '');
  if (!fromFile) {
    const line = $('#project-line');
    line.hidden = false;
    line.innerHTML = `Connected to ${esc(S.configHost)} · <button type="button">Change</button>`;
    $('button', line).addEventListener('click', () => {
      store.del('vc_supabase_url'); store.del('vc_supabase_key'); S.client?.auth.signOut().catch(() => {}); showSetup();
    });
  }
  try {
    S.client = createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
  } catch (e) {
    return showSetup(`Could not connect: ${e.message}`);
  }
  const urlErr = readUrlError();
  S.client.auth.onAuthStateChange((event, sess) => {
    // Supabase warns against awaiting its own calls inside this callback.
    setTimeout(() => onAuth(event, sess), 0);
  });
  const { data, error } = await S.client.auth.getSession().catch((e) => ({ data: {}, error: e }));
  cleanUrl();
  if (!data?.session) {
    session.del('vc_oauth_pending');
    showOnly('auth');
    if (urlErr) {
      authMsg(/not enabled|unsupported provider/i.test(urlErr)
        ? "That sign-in method isn't turned on for this Supabase project. Enable it under Authentication → Sign In / Providers (see the README)."
        : `Sign-in failed: ${urlErr}`);
    } else if (error) authMsg(friendly(error));
  }
  window.addEventListener('focus', recheckUser);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') recheckUser(); });
}

async function onAuth(event, sess) {
  const u = sess?.user || null;
  if (!u) {
    teardownRealtime();
    S.user = null; S.loaded = false; S.rows.clear();
    showLanding();
    document.title = 'Velaryn Code';
    showOnly('auth');
    authMsg(S.signoutMsg || '', '');
    S.signoutMsg = '';
    return;
  }
  const same = S.user?.id === u.id;
  S.user = u;
  emit('user');
  if (same) {
    if (event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') checkRevoked();
    return;
  }
  enterApp(sess);
}

let lastCheck = 0;
async function recheckUser() {
  if (!S.user || !S.client || Date.now() - lastCheck < 20000) return;
  lastCheck = Date.now();
  try {
    const { data } = await S.client.auth.getUser();
    if (data?.user && S.user) { S.user = data.user; checkRevoked(); }
  } catch {}
}

async function enterApp(sess) {
  const u = S.user;
  const recent = u.last_sign_in_at && Date.now() - Date.parse(u.last_sign_in_at) < 10 * 60 * 1000;
  const fresh = !!S.freshSignIn || !!(BOOT_HAD_CODE && session.get('vc_oauth_pending') && recent) || !!session.get('vc_app_fresh');
  S.freshSignIn = false;
  session.del('vc_app_fresh');
  session.del('vc_oauth_pending');
  const pendingRemove = session.get('vc_pending_remove');
  session.del('vc_pending_remove');
  const returnHash = session.get('vc_return_hash');
  session.del('vc_return_hash');

  if (fresh) {
    await unrevokeSelf();          // signing in again on a removed device makes it usable
  } else {
    if (isRevoked()) return revokedSignOut();
    S.client.auth.getUser().then(({ data }) => { if (data?.user && S.user?.id === data.user.id) { S.user = data.user; checkRevoked(); } }).catch(() => {});
  }
  if (!S.user) return;
  if (returnHash && fresh) history.replaceState(null, '', location.pathname + location.search + returnHash);

  $('#landing').hidden = true;
  $('#me-email').textContent = u.email || u.user_metadata?.full_name || u.user_metadata?.name || '';
  paintAvatars();
  try { S.client.realtime.setAuth(sess.access_token); } catch {}
  await registerDevice();
  setupRealtime();
  renderRoute();
  await loadAll();
  if (pendingRemove) {
    if (fresh) await finishRemoval(pendingRemove);
    else toast('The device was not removed because sign-in was not completed.', 'warn', { ms: 6000 });
  }
}

// ---------------------------------------------------------------- data

async function loadAll({ quiet = false } = {}) {
  try {
    const [p, rows] = await Promise.all([S.client.from('vc_projects').select('*'), fetchRows(null), loadDevices()]);
    if (p.error) throw p.error;
    S.projectMeta = p.data || [];
    S.rows = new Map(rows.map((r) => [keyOf(r.project, r.path), r]));
    S.loaded = true; S.loadError = null;
  } catch (e) {
    S.loadError = friendly(e);
    if (quiet) toastErr(e);
  }
  emit('rows');
  refreshView();
}

function projects() {
  const by = new Map();
  for (const r of S.rows.values()) {
    if (r.deleted) continue;
    if (!by.has(r.project)) by.set(r.project, []);
    by.get(r.project).push(r);
  }
  // kind 'deleted' is a tombstone left when a project is deleted from the cloud
  const tomb = new Set(S.projectMeta.filter((p) => p.kind === 'deleted').map((p) => p.name));
  const names = new Set([...S.projectMeta.filter((p) => !tomb.has(p.name)).map((p) => p.name), ...[...by.keys()].filter((n) => !tomb.has(n))]);
  const list = [...names].map((name) => {
    const meta = S.projectMeta.find((p) => p.name === name) || { name, kind: name === LOOSE ? 'files' : 'folder' };
    const files = by.get(name) || [];
    const latest = files.reduce((a, b) => (!a || b.updated_at > a.updated_at ? b : a), null);
    return { ...meta, files, latest, size: files.reduce((s, f) => s + Number(f.size || 0), 0) };
  });
  list.sort((a, b) => (b.latest?.updated_at || b.updated_at || '').localeCompare(a.latest?.updated_at || a.updated_at || ''));
  return list;
}

// ---------------------------------------------------------------- realtime

function setupRealtime() {
  teardownRealtime();
  // Live updates are a nice-to-have: never let a realtime failure stop the app from loading.
  try {
    S.channel = S.client
      .channel(`vc-files-web-${S.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vc_files', filter: `user_id=eq.${S.user.id}` }, onRemote)
      .subscribe();
  } catch (e) {
    console.warn('Realtime unavailable:', e.message);
    S.channel = null;
  }
}

function teardownRealtime() {
  try { if (S.channel) S.client?.removeChannel(S.channel); } catch {}
  S.channel = null;
}

let refreshTimer;
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { emit('rows'); refreshView(); }, 150); }

function onRemote(payload) {
  if (payload.eventType === 'DELETE') {
    const o = payload.old;
    if (o?.project != null && o?.path != null) S.rows.delete(keyOf(o.project, o.path));
    else return loadAll({ quiet: true });
    scheduleRefresh();
    return;
  }
  const row = payload.new;
  if (!row?.path) return;
  const k = keyOf(row.project, row.path);
  const prev = S.rows.get(k);
  if (prev && prev.version > row.version) return;  // stale event
  S.rows.set(k, row);
  scheduleRefresh();
  WS?.wsOnRemote(row);
}

function onOnline() {
  $('#offline').hidden = true;
  emit('online');
  if (S.user) { loadAll({ quiet: true }); if (!S.channel) setupRealtime(); }
}

on('uploaded', (project, done) => { if (route().view === 'home' && project === LOOSE && done) location.hash = projHref(LOOSE); });
on('devices', () => { if (route().view === 'home') refreshView(); });
on('rows', () => { if (!isApp() && route().view === 'project') refreshProject(); });

// ---------------------------------------------------------------- routing

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/');
  if (parts[0] === 'settings') return { view: 'settings' };
  if (parts[0] === 'p' && parts[1] != null) return { view: 'project', project: decodeURIComponent(parts[1]) };
  if (parts[0] === 'f' && parts.length >= 3) return { view: 'project', project: decodeURIComponent(parts[1]), path: decodeURIComponent(parts.slice(2).join('/')) };
  return { view: 'home' };
}
const projHref = (p) => `#/p/${encodeURIComponent(p)}`;

let lastHash = location.hash;
let skipHash = false;
window.addEventListener('hashchange', async () => {
  if (skipHash) { skipHash = false; lastHash = location.hash; return; }
  const r = route();
  const cur = wsProject();
  if (cur && dirtyCount() && !(r.view === 'project' && r.project === cur)) {
    const n = dirtyCount();
    const ok = await confirmBox('Discard unsaved changes?', `${n} file${n > 1 ? 's have' : ' has'} edits that are not saved to the cloud.`, 'Discard', true);
    if (!ok) { skipHash = true; location.hash = lastHash; return; }
    discardAll();
  }
  lastHash = location.hash;
  renderRoute();
});

function renderRoute() {
  if (!S.user) return;
  const r = route();
  if (r.view === 'project' && isApp()) {
    $('#dash').hidden = true;
    loadWs().then(() => {
      if (route().view !== 'project') return;
      if (wsProject() === r.project) WS.wsRoute(r);
      else WS.enterWorkspace(r.project, r.path);
    }).catch((e) => toast(`The editor could not load: ${friendly(e)}`, 'err'));
    lastHash = location.hash;
    return;
  }
  leaveWorkspace();
  if (r.view !== 'project') closeProject();
  $('#dash').hidden = false;
  document.title = 'Velaryn Code';
  window.scrollTo(0, 0);
  refreshView();
}

function refreshView() {
  if (!S.user) return;
  const r = route();
  if (r.view === 'home') renderHome();
  else if (r.view === 'settings') renderSettingsPage();
  else if (r.view === 'project' && !isApp()) {
    if (!S.loaded) { const v = $('#view'); v.innerHTML = S.loadError ? errorHtml() : loadingHtml(); bindView(); return; }
    renderProject(r.project, r.path);
  }
}

// ---------------------------------------------------------------- views

function loadingHtml(t = 'Loading your files…') { return `<div class="loading"><div class="spinner"></div>${esc(t)}</div>`; }
function errorHtml() {
  return `<div class="empty"><div class="big-ic">⚠︎</div><strong>Couldn't load your files</strong><p>${esc(S.loadError)}</p>
    <p><button class="btn small" data-act="retry" type="button">Try again</button></p></div>`;
}

function renderHome() {
  const v = $('#view');
  if (!S.loaded) { v.innerHTML = S.loadError ? errorHtml() : loadingHtml(); bindView(); return; }
  const list = projects();
  const cards = list.map((p) => {
    const latest = p.latest;
    const dev = latest ? deviceHtml(latest.device_os, latest.device_name, latest.updated_at) : deviceHtml(p.device_os, p.device_name, p.updated_at);
    return `<a class="proj" href="${projHref(p.name)}">
      <div class="proj-name"><span class="proj-ic">${icon(p.name === LOOSE ? 'files' : 'folder', 16)}</span><span class="nm">${esc(projectLabel(p.name))}</span><span class="go">${icon('chevronRight', 16)}</span></div>
      <div class="proj-meta"><span>${p.files.length} file${p.files.length === 1 ? '' : 's'}</span><span>${fmtSize(p.size)}</span>${dev}</div>
    </a>`;
  }).join('');
  v.innerHTML = `
    <section class="sec">
      <div class="sec-head"><h2>Projects</h2>
        <div class="actions">
          <button class="btn small" data-act="new-project" type="button">${icon('plus', 15)} New project</button>
          <button class="btn small primary" data-act="upload-single" type="button">${icon('upload', 15)} Upload files</button>
        </div>
      </div>
      ${list.length ? `<div class="grid">${cards}</div>` : `<div class="empty"><div class="big-ic">☁︎</div><strong>Nothing synced yet.</strong>
        <p>In Velaryn Code, open a folder and press Sync. Or upload files from this device.</p></div>`}
    </section>
    <section class="sec">
      <div class="sec-head"><h2>Devices</h2></div>
      <div data-devices>${devicesHtml()}</div>
    </section>`;
  bindDevices(v);
  bindView();
}

function renderSettingsPage() {
  const v = $('#view');
  v.innerHTML = '<div class="crumbs"><a href="#/">‹ Projects</a></div><div id="settings-host"></div>';
  renderSettings($('#settings-host'));
}

function bindView() {
  $$('#view [data-act]').forEach((b) => b.addEventListener('click', () => action(b.dataset.act)));
}

async function action(act) {
  try {
    if (act === 'retry') { S.loadError = null; refreshView(); return loadAll(); }
    if (act === 'upload-single') return pickFiles(false, LOOSE);
    if (act === 'new-project') {
      const name = await modal({ title: 'New project', text: 'An empty cloud project. Open it in Velaryn Code later to sync it to a folder.',
        input: { placeholder: 'my-app' }, actions: [{ label: 'Cancel', value: null }, { label: 'Create', primary: true }] });
      if (!name) return;
      if (/[/\\]/.test(name) || name === LOOSE || name.length > 120) return toast('Pick a name without slashes.', 'warn');
      await ensureProject(name, 'folder');
      location.hash = projHref(name);
    }
  } catch (e) {
    toastErr(e);
  }
}

// Refresh "x min ago" labels every minute.
setInterval(() => { if (S.user && route().view === 'home' && !document.querySelector('.modal-back')) refreshView(); }, 60000);

boot().catch((e) => { console.error(e); showSetup(friendly(e)); });
