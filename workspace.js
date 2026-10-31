// The project workspace: explorer, tabs, Monaco editor, search, quick open, command palette,
// keyboard accessory bar and the Claude / Settings panes. Mirrors the desktop app, adapted for touch.
import {
  S, $, $$, esc, store, keyOf, projectLabel, baseName, dirName, cmp, LOOSE, EDIT_MAX, SEARCH_MAX, BINARY_EXT, IMAGE_EXT,
  DEVICE, timeAgo, fmtSize, deviceHtml, friendly, toast, toastErr, modal, confirmBox, menu, settings, setSetting, on, emit,
  isPhone, isTouch, liveFiles, liveRow, fetchRow, commit, putBytes, readRow, ConflictError, ensureProject, cleanPath,
  pickFiles, downloadFile, downloadZip, saveBlob, loadMonaco, guessLang, decodeText,
} from './core.js?v=1793470528';
import { icon, fileBadge, claudeLogo } from './icons.js?v=1793470528';
import { renderSettings, paintAvatars } from './account.js?v=1793470528';
import * as Claude from './claude.js?v=1793470528';

const W = {
  project: null, tabs: [], active: null, editor: null, monaco: null, mounted: false,
  openDirs: new Set(), pendingDirs: new Set(), sel: null,
  side: 'files', drawer: false, sideHidden: false, claude: false, settings: false,
  saving: 0, textCache: new Map(), search: { q: '', case: false, word: false, regex: false, token: 0 },
  maxH: 0, accTimer: null, unsub: [],
};

const active = () => W.tabs.find((t) => t.path === W.active) || null;
const tabFor = (path) => W.tabs.find((t) => t.path === path) || null;
const isDirty = (t) => !!(t?.model && (t.isNew || t.model.getAlternativeVersionId() !== t.savedVid));
export const dirtyCount = () => W.tabs.filter(isDirty).length;
export const wsProject = () => W.project;
const ukey = (k) => `${k}:${S.user?.id || ''}:${W.project}`;

// ---------------------------------------------------------------- DOM

function buildDom() {
  const ws = $('#ws');
  const acc = [
    ['Tab', 'tab', 'Tab'], ['⇧Tab', 'outdent', 'Shift Tab'],
    ...'{ } ( ) [ ] < > " \' ; : = / \\ | & ! _ - `'.split(' ').map((c) => [c, `ch:${c}`, c]),
    ['←', 'cursorLeft', 'Left'], ['↑', 'cursorUp', 'Up'], ['↓', 'cursorDown', 'Down'], ['→', 'cursorRight', 'Right'],
  ];
  ws.innerHTML = `
    <header class="ws-top">
      <a class="btn icon ghost ws-back" href="#/" aria-label="Back to projects">${icon('chevronLeft', 20)}</a>
      <button class="ws-title" type="button" data-cmd="quickOpen" aria-label="Go to file"><span class="nm"></span><span class="sub"></span></button>
      <button class="cloud-pill" id="ws-cloud" type="button"></button>
      <button class="btn icon ghost" type="button" data-cmd="quickOpen" aria-label="Go to file" title="Go to file (⌘P)">${icon('search', 18)}</button>
      <button class="btn icon ghost" type="button" data-cmd="palette" aria-label="Commands" title="Commands (⇧⌘P)">${icon('more', 20)}</button>
      <button class="avatar ws-me" type="button" data-avatar data-pane="settings" aria-label="Settings"></button>
    </header>
    <div class="ws-body">
      <nav class="ws-activity" aria-label="Views">
        <button class="act" type="button" data-pane="files" title="Explorer">${icon('files', 22)}</button>
        <button class="act" type="button" data-pane="search" title="Search (⇧⌘F)">${icon('search', 22)}</button>
        <button class="act" type="button" data-pane="claude" title="Claude">${claudeLogo(22)}</button>
        <span class="spacer"></span>
        <button class="act" type="button" data-pane="settings" title="Settings">${icon('settings', 22)}</button>
      </nav>
      <aside class="ws-side" id="ws-side" aria-label="Sidebar">
        <div class="side-view" data-view="files">
          <div class="view-head"><span class="view-title">Explorer</span>
            <span class="view-actions">
              <button type="button" data-cmd="newFile" title="New file" aria-label="New file">${icon('newFile', 17)}</button>
              <button type="button" data-cmd="newFolder" title="New folder" aria-label="New folder">${icon('newFolder', 17)}</button>
              <button type="button" data-cmd="upload" title="Upload files" aria-label="Upload files">${icon('upload', 17)}</button>
              <button type="button" data-cmd="explorerMore" title="More" aria-label="More explorer actions">${icon('more', 17)}</button>
              <button type="button" class="drawer-x" data-pane="editor" aria-label="Close">${icon('close', 17)}</button>
            </span></div>
          <div class="tree-root"><span class="nm"></span><span class="synced"></span></div>
          <div id="ws-tree" class="ws-tree" role="tree"></div>
        </div>
        <div class="side-view" data-view="search">
          <div class="view-head"><span class="view-title">Search</span>
            <span class="view-actions"><button type="button" class="drawer-x" data-pane="editor" aria-label="Close">${icon('close', 17)}</button></span></div>
          <div class="search-box">
            <div class="input-wrap"><input id="ws-q" type="search" placeholder="Search in project" enterkeyhint="search" autocapitalize="off" autocorrect="off" spellcheck="false">
              <button class="toggle" type="button" data-opt="case" title="Match case" aria-label="Match case">Aa</button>
              <button class="toggle" type="button" data-opt="word" title="Whole word" aria-label="Whole word"><u>ab</u></button>
              <button class="toggle" type="button" data-opt="regex" title="Regular expression" aria-label="Regular expression">.*</button></div>
          </div>
          <div id="ws-sum" class="search-sum"></div>
          <div id="ws-results" class="search-results"></div>
        </div>
      </aside>
      <div class="ws-scrim" data-pane="editor"></div>
      <main class="ws-center">
        <div class="tabs-row"><div class="tabs" id="ws-tabs" role="tablist"></div>
          <div class="tab-actions"><button type="button" class="problems" id="ws-problems" hidden></button>
            <button type="button" data-cmd="save" class="tab-save" title="Save (⌘S)" aria-label="Save">${icon('save', 17)}</button></div></div>
        <div class="banner" id="ws-banner" hidden></div>
        <div class="editor-area"><div id="ws-editor" class="editor"></div><div id="ws-ph" class="ws-ph"></div></div>
        <div class="accessory" id="ws-acc" hidden>
          <div class="acc-scroll">${acc.map(([l, a, n]) => `<button type="button" data-acc="${esc(a)}" aria-label="${esc(n)}">${esc(l)}</button>`).join('')}
            <button type="button" data-acc="undo" aria-label="Undo">${icon('undo', 17)}</button>
            <button type="button" data-acc="redo" aria-label="Redo">${icon('redo', 17)}</button>
            <button type="button" data-acc="find" aria-label="Find">${icon('search', 17)}</button>
            <button type="button" data-acc="save" class="acc-save" aria-label="Save">${icon('save', 17)}</button></div>
          <button type="button" class="acc-hide" data-acc="hide" aria-label="Hide keyboard">${icon('chevronDown', 18)}</button>
        </div>
      </main>
      <aside class="ws-claude" id="ws-claude" aria-label="Claude"></aside>
      <section class="ws-page" id="ws-settings" aria-label="Settings"></section>
    </div>
    <footer class="ws-status">
      <div class="left"><button type="button" id="sb-cloud"></button><button type="button" id="sb-problems"></button></div>
      <div class="right"><button type="button" id="sb-pos" data-cmd="gotoLine"></button><button type="button" id="sb-tab"></button><button type="button" id="sb-lang"></button></div>
    </footer>
    <nav class="ws-nav" aria-label="Views">
      <button type="button" data-pane="files">${icon('files', 22)}<span>Files</span></button>
      <button type="button" data-pane="search">${icon('search', 22)}<span>Search</span></button>
      <button type="button" data-pane="editor">${icon('code', 22)}<span>Editor</span></button>
      <button type="button" data-pane="claude">${claudeLogo(22)}<span>Claude</span></button>
      <button type="button" data-pane="settings">${icon('settings', 22)}<span>Settings</span></button>
    </nav>`;

  ws.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pane]');
    if (p) { e.preventDefault(); return setPane(p.dataset.pane, true); }
    const c = e.target.closest('[data-cmd]');
    if (c) { e.preventDefault(); return runCommand(c.dataset.cmd, e); }
  });
  $('#ws-cloud').addEventListener('click', cloudMenu);
  $('#sb-cloud').addEventListener('click', cloudMenu);
  $('#ws-problems').addEventListener('click', problemsMenu);
  $('#sb-problems').addEventListener('click', problemsMenu);
  $('#sb-tab').addEventListener('click', () => runCommand('tabSize'));
  bindTree();
  bindTabs();
  bindSearch();
  bindAccessory();
  window.addEventListener('resize', () => { applyPanes(); onViewport(); });
  window.visualViewport?.addEventListener('resize', onViewport);
  window.visualViewport?.addEventListener('scroll', onViewport);
  window.addEventListener('orientationchange', () => { W.maxH = 0; setTimeout(onViewport, 300); });
  W.mounted = true;
}

// ---------------------------------------------------------------- viewport / keyboard

function onViewport() {
  if (!W.project) return;
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  const top = vv ? Math.max(0, vv.offsetTop) : 0;
  W.maxH = Math.max(W.maxH, window.innerHeight, h);
  const root = document.documentElement.style;
  root.setProperty('--vvh', `${Math.round(h)}px`);
  root.setProperty('--vvtop', `${Math.round(top)}px`);
  const kb = isTouch() && (W.maxH - h > 120);
  document.body.classList.toggle('kb-open', kb);
  if (kb && W.editor?.hasTextFocus()) setTimeout(() => W.editor?.revealPosition(W.editor.getPosition()), 50);
}

// ---------------------------------------------------------------- panes

function setPane(p, fromUser = false) {
  const phone = isPhone();
  if (p === 'editor') { W.drawer = false; W.claude = phone ? false : W.claude; W.settings = false; }
  else if (p === 'files' || p === 'search') {
    if (phone) {
      const same = W.drawer && W.side === p && !W.claude && !W.settings;
      W.side = p; W.drawer = !same; W.claude = false; W.settings = false;
    } else {
      if (!W.sideHidden && W.side === p && fromUser && !W.settings) W.sideHidden = true;
      else { W.sideHidden = false; W.side = p; }
      W.settings = false;
    }
    if (p === 'search' && (W.drawer || !W.sideHidden)) setTimeout(() => { const q = $('#ws-q'); q.focus(); q.select(); }, phone ? 260 : 0);
  } else if (p === 'claude') {
    if (phone) { W.claude = true; W.drawer = false; W.settings = false; }
    else W.claude = !W.claude;
    if (W.claude) Claude.onShow();
  } else if (p === 'settings') {
    W.settings = phone ? true : !W.settings;
    W.drawer = false;
    if (phone) W.claude = false;
    if (W.settings) renderSettings($('#ws-settings'), { onClose: () => setPane('editor') });
  }
  applyPanes();
  if (W.drawer || W.claude || W.settings) W.editor?.getContainerDomNode()?.querySelector('textarea')?.blur();
}

function applyPanes() {
  const ws = $('#ws'); if (!ws) return;
  const phone = isPhone();
  ws.classList.toggle('drawer-open', phone && W.drawer);
  ws.classList.toggle('side-hidden', !phone && W.sideHidden);
  ws.classList.toggle('claude-open', W.claude);
  ws.classList.toggle('settings-open', W.settings);
  ws.dataset.side = W.side;
  const front = W.settings ? 'settings' : W.claude && phone ? 'claude' : phone && W.drawer ? W.side : 'editor';
  $$('.ws-nav [data-pane]', ws).forEach((b) => b.classList.toggle('on', b.dataset.pane === front));
  $$('.ws-activity [data-pane]', ws).forEach((b) => {
    const k = b.dataset.pane;
    b.classList.toggle('on', k === 'claude' ? W.claude : k === 'settings' ? W.settings : !W.sideHidden && W.side === k && !phone);
  });
  $$('.side-view', ws).forEach((v) => v.classList.toggle('on', v.dataset.view === W.side));
  W.editor?.layout();
}

// ---------------------------------------------------------------- enter / leave

export async function enterWorkspace(project, path) {
  if (!W.mounted) buildDom();
  document.body.classList.add('in-ws');
  $('#ws').hidden = false;
  if (W.project !== project) {
    resetProject();
    W.project = project;
    try {
      const saved = JSON.parse(store.get(ukey('vc_ws')) || '{}');
      W.openDirs = new Set(saved.open || []);
      W.pendingDirs = new Set(JSON.parse(store.get(ukey('vc_dirs')) || '[]'));
      W.restore = { tabs: (saved.tabs || []).slice(0, 12), active: saved.active };
    } catch { W.openDirs = new Set(); W.pendingDirs = new Set(); W.restore = null; }
    const phone = isPhone();
    W.drawer = phone && !path && !(W.restore?.tabs?.length);
    W.claude = false; W.settings = false; W.sideHidden = false; W.side = 'files';
    Claude.init(claudeApi(), $('#ws-claude'));
    W.unsub.push(on('rows', scheduleRefresh), on('settings', applySettings), on('online', updateCloud));
  }
  $('.ws-title .nm').textContent = projectLabel(project);
  $('.tree-root .nm').textContent = projectLabel(project);
  paintAvatars($('#ws'));
  applyPanes();
  onViewport();
  renderTree();
  renderTabs();
  updateTitle();
  updateCloud();
  if (!W.editor) await initEditor().catch((e) => showPh('error', friendly(e)));
  if (W.restore) {
    const r = W.restore; W.restore = null;
    if (S.loaded || !path) for (const p of r.tabs) if (p !== path) addTabStub(p);
    if (!path && r.active) path = r.active;
  }
  if (path) await openFile(path, { focus: false });
  else if (!W.tabs.length) showPh('welcome');
  else activate(W.tabs[W.tabs.length - 1]);
}

function addTabStub(path) { if (!tabFor(path)) W.tabs.push({ path, kind: 'stub' }); }

export function wsRoute(r) {
  if (r.path) openFile(r.path, { focus: false });
}

function resetProject() {
  W.unsub.forEach((f) => f()); W.unsub = [];
  for (const t of W.tabs) { t.model?.dispose(); if (t.imgUrl) URL.revokeObjectURL(t.imgUrl); clearTimeout(t.autoTimer); }
  W.tabs = []; W.active = null; W.sel = null;
  W.editor?.setModel(null);
  W.textCache.clear();
  W.search.token++;
  $('#ws-results') && ($('#ws-results').innerHTML = '', $('#ws-sum').textContent = '', $('#ws-q').value = '');
  Claude.reset?.();
}

export function leaveWorkspace() {
  if (!W.project) return;
  resetProject();
  W.project = null;
  $('#ws').hidden = true;
  document.body.classList.remove('in-ws', 'kb-open');
}

export function discardAll() { for (const t of W.tabs) { if (t.model) t.savedVid = t.model.getAlternativeVersionId(); t.isNew = false; } }

function persist() {
  if (!W.project || !S.user) return;
  store.set(ukey('vc_ws'), JSON.stringify({ open: [...W.openDirs], tabs: W.tabs.filter((t) => !t.isNew).map((t) => t.path), active: W.active }));
  store.set(ukey('vc_dirs'), JSON.stringify([...W.pendingDirs]));
}

// ---------------------------------------------------------------- editor

function editorOptions() {
  const s = settings(), phone = isPhone();
  return {
    theme: s.theme, fontSize: s.fontSize, wordWrap: s.wordWrap ? 'on' : 'off',
    minimap: { enabled: !!s.minimap && !phone }, lineNumbers: 'on', lineNumbersMinChars: phone ? 3 : 4,
    glyphMargin: false, folding: !phone, lineDecorationsWidth: phone ? 6 : 10,
    fontFamily: "'SF Mono', Menlo, Monaco, Consolas, 'Roboto Mono', monospace",
    automaticLayout: true, scrollBeyondLastLine: false, smoothScrolling: true, renderLineHighlight: 'all',
    bracketPairColorization: { enabled: true }, padding: { top: 8, bottom: 8 }, fixedOverflowWidgets: true,
    contextmenu: !isTouch(), mouseWheelZoom: false, dragAndDrop: !isTouch(),
    scrollbar: { verticalScrollbarSize: phone ? 6 : 10, horizontalScrollbarSize: phone ? 6 : 10, alwaysConsumeMouseWheel: false },
    overviewRulerLanes: phone ? 0 : 3, hideCursorInOverviewRuler: phone, stickyScroll: { enabled: !phone },
    unicodeHighlight: { ambiguousCharacters: false },
  };
}

async function initEditor() {
  const monaco = W.monaco = await loadMonaco();
  if (W.editor) return;
  const ed = W.editor = monaco.editor.create($('#ws-editor'), { ...editorOptions(), model: null });
  const K = monaco.KeyMod, C = monaco.KeyCode;
  ed.addCommand(K.CtrlCmd | C.KeyS, () => save(active()));
  ed.addCommand(K.CtrlCmd | K.Alt | C.KeyS, () => saveAll());
  ed.addCommand(K.CtrlCmd | C.KeyP, () => openQuick(''));
  ed.addCommand(K.CtrlCmd | K.Shift | C.KeyP, () => openQuick('>'));
  ed.addCommand(K.Alt | C.KeyZ, () => runCommand('wrap'));
  ed.onDidChangeCursorPosition(() => { updateStatus(); Claude.onContext(); });
  ed.onDidChangeCursorSelection(() => Claude.onContext());
  ed.onDidFocusEditorText(() => { clearTimeout(W.accTimer); if (isTouch()) showAccessory(true); });
  ed.onDidBlurEditorText(() => { clearTimeout(W.accTimer); W.accTimer = setTimeout(() => showAccessory(false), 180); });
  monaco.editor.onDidChangeMarkers(() => updateProblems());
  registerFixActions(monaco);
}

function applySettings(s, patch = {}) {
  if (!W.editor) return;
  W.editor.updateOptions(editorOptions());
  if ('theme' in patch) W.monaco.editor.setTheme(s.theme);
  if ('tabSize' in patch) for (const t of W.tabs) t.model?.updateOptions({ tabSize: s.tabSize, indentSize: s.tabSize });
  updateStatus();
}

function modelUri(path) { return W.monaco.Uri.from({ scheme: 'file', path: `/${W.project === LOOSE ? '~files' : W.project}/${path}` }); }

function makeModel(t, text) {
  const uri = modelUri(t.path);
  W.monaco.editor.getModel(uri)?.dispose();
  const m = W.monaco.editor.createModel(text, guessLang(t.path), uri);
  m.updateOptions({ tabSize: settings().tabSize, indentSize: settings().tabSize, insertSpaces: true });
  t.model = m;
  t.savedVid = m.getAlternativeVersionId();
  m.onDidChangeContent(() => onEdit(t));
  return m;
}

let renderTabsTimer;
function onEdit(t) {
  clearTimeout(renderTabsTimer);
  renderTabsTimer = setTimeout(() => { renderTabs(); renderTreeDirty(); updateCloud(); }, 60);
  if (settings().autoSave && !t.conflictRow) {
    clearTimeout(t.autoTimer);
    t.autoTimer = setTimeout(() => { if (isDirty(t) && !t.conflictRow) save(t); }, 1500);
  }
}

// open (or focus) a file tab. opts: { line, col, len, focus }
export async function openFile(path, opts = {}) {
  path = cleanPath(path);
  if (!path || !W.project) return null;
  let t = tabFor(path);
  if (!t) { t = { path, kind: 'stub' }; W.tabs.push(t); }
  activate(t, opts);
  if (t.kind === 'stub' || t.kind === 'error') await loadTab(t);
  if (W.active === t.path) activate(t, opts);
  return t;
}

async function loadTab(t) {
  t.kind = 'loading';
  if (W.active === t.path) showPh('loading');
  try {
    if (!S.loaded) await waitLoaded();
    if (!W.monaco) await initEditor();
    let row = liveRow(W.project, t.path);
    if (!row) row = await fetchRow(W.project, t.path).catch(() => null);
    if (!tabFor(t.path)) return;
    if (!row || row.deleted) { t.kind = 'missing'; t.row = row; return; }
    t.row = row;
    if (IMAGE_EXT.test(t.path) && !/\.svg$/i.test(t.path) && Number(row.size) <= 20 * 1024 * 1024) {
      const bytes = await readRow(row);
      t.imgUrl = URL.createObjectURL(new Blob([bytes], { type: `image/${t.path.split('.').pop().toLowerCase().replace('jpg', 'jpeg')}` }));
      t.kind = 'image'; return;
    }
    if (Number(row.size) > EDIT_MAX) { t.kind = 'large'; return; }
    if (BINARY_EXT.test(t.path)) { t.kind = 'binary'; return; }
    const bytes = await readRow(row);
    if (!tabFor(t.path)) return;
    const text = decodeText(bytes);
    if (text == null) { t.kind = 'binary'; return; }
    makeModel(t, text);
    t.kind = 'text';
  } catch (e) {
    t.kind = 'error'; t.msg = friendly(e);
  } finally {
    renderTabs();
    if (W.active === t.path) activate(t);
  }
}

function waitLoaded() {
  return new Promise((resolve, reject) => {
    const tm = setInterval(() => {
      if (S.loaded) { clearInterval(tm); resolve(); } else if (S.loadError) { clearInterval(tm); reject(new Error(S.loadError)); }
    }, 100);
  });
}

function activate(t, opts = {}) {
  const prev = active();
  if (prev && prev !== t && prev.model && W.editor?.getModel() === prev.model) prev.viewState = W.editor.saveViewState();
  W.active = t.path;
  W.sel = t.path;
  renderTabs();
  renderTreeSel();
  updateTitle();
  renderBanner();
  updateProblems();
  if (t.kind === 'text' && t.model && W.editor) {
    $('#ws-ph').hidden = true;
    $('#ws-editor').hidden = false;
    if (W.editor.getModel() !== t.model) {
      W.editor.setModel(t.model);
      if (t.viewState) W.editor.restoreViewState(t.viewState);
    }
    if (opts.line) {
      const m = W.monaco;
      const col = opts.col || 1;
      W.editor.setSelection(new m.Selection(opts.line, col, opts.line, col + (opts.len || 0)));
      W.editor.revealLineInCenter(opts.line);
    }
    if (opts.focus) W.editor.focus();
    W.editor.layout();
  } else {
    if (W.editor && W.editor.getModel()) W.editor.setModel(null);
    $('#ws-editor').hidden = true;
    showPh(t.kind, t);
  }
  updateStatus();
  history.replaceState(null, '', `#/f/${encodeURIComponent(W.project)}/${encodeURIComponent(t.path)}`);
  persist();
  Claude.onContext();
}

function showPh(kind, t) {
  const ph = $('#ws-ph'); if (!ph) return;
  ph.hidden = false;
  $('#ws-editor').hidden = true;
  const dl = t ? `<button class="btn primary" type="button" data-ph="download">${icon('download', 16)} Download</button>` : '';
  const name = t ? esc(baseName(t.path)) : '';
  if (kind === 'loading' || kind === 'stub') ph.innerHTML = '<div class="loading"><div class="spinner"></div>Opening…</div>';
  else if (kind === 'welcome') {
    ph.innerHTML = `<div class="welcome"><img src="logo.png" alt="" width="56" height="56"><h2>${esc(projectLabel(W.project))}</h2>
      <p>Open a file from the explorer, or start something new.</p>
      <div class="welcome-actions">
        <button class="btn" type="button" data-pane="files">${icon('files', 16)} Browse files</button>
        <button class="btn" type="button" data-cmd="quickOpen">${icon('search', 16)} Go to file</button>
        <button class="btn" type="button" data-cmd="newFile">${icon('newFile', 16)} New file</button>
        <button class="btn" type="button" data-pane="claude">${claudeLogo(16)} Ask Claude</button>
      </div></div>`;
  } else if (kind === 'image') {
    ph.innerHTML = `<div class="preview-media"><img src="${t.imgUrl}" alt="${name}"></div><div class="ph-bar">${dl}</div>`;
  } else if (kind === 'large') ph.innerHTML = `<div class="empty"><div class="big-ic">${icon('files', 30)}</div><strong>${name}</strong><p>${esc(fmtSize(t.row?.size))} is too large to edit in the browser.</p><p>${dl}</p></div>`;
  else if (kind === 'binary') ph.innerHTML = `<div class="empty"><div class="big-ic">${icon('files', 30)}</div><strong>${name}</strong><p>This looks like a binary file, so it can't be edited here.</p><p>${dl}</p></div>`;
  else if (kind === 'missing') ph.innerHTML = `<div class="empty"><strong>${name}</strong><p>This file is no longer in the cloud. It may have been deleted on another device.</p><p><button class="btn" type="button" data-ph="close">Close tab</button></p></div>`;
  else if (kind === 'error') ph.innerHTML = `<div class="empty"><strong>Couldn't open ${name}</strong><p>${esc(t?.msg || '')}</p><p><button class="btn" type="button" data-ph="retry">Try again</button></p></div>`;
  $$('[data-ph]', ph).forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.ph, tab = active(); if (!tab) return;
    if (a === 'download') downloadFile(W.project, tab.path);
    if (a === 'close') closeTab(tab, true);
    if (a === 'retry') { tab.kind = 'stub'; openFile(tab.path); }
  }));
}

function updateTitle() {
  const t = active();
  const sub = $('.ws-title .sub'); if (!sub) return;
  sub.textContent = t ? t.path : '';
  document.title = t ? `${baseName(t.path)} · ${projectLabel(W.project)} · Velaryn Code` : `${projectLabel(W.project)} · Velaryn Code`;
}

function updateStatus() {
  const t = active();
  const pos = W.editor?.getPosition();
  const txt = t?.kind === 'text' && pos;
  $('#sb-pos').textContent = txt ? `Ln ${pos.lineNumber}, Col ${pos.column}` : '';
  $('#sb-tab').textContent = txt ? `Spaces: ${settings().tabSize}` : '';
  $('#sb-lang').textContent = txt ? (W.monaco?.languages.getLanguages().find((l) => l.id === t.model.getLanguageId())?.aliases?.[0] || t.model.getLanguageId()) : '';
  $('.tab-save').disabled = !isDirty(t);
}

// ---------------------------------------------------------------- tabs

function renderTabs() {
  const el = $('#ws-tabs'); if (!el) return;
  el.innerHTML = W.tabs.map((t) => {
    const dirty = isDirty(t);
    const dup = W.tabs.filter((x) => baseName(x.path) === baseName(t.path)).length > 1;
    return `<div class="tab${t.path === W.active ? ' on' : ''}${dirty ? ' dirty' : ''}${t.conflictRow ? ' conflict' : ''}" role="tab" aria-selected="${t.path === W.active}" data-tab="${esc(t.path)}" title="${esc(t.path)}">
      ${fileBadge(baseName(t.path))}<span class="name">${esc(baseName(t.path))}</span>${dup && dirName(t.path) ? `<span class="hint">${esc(baseName(dirName(t.path)))}</span>` : ''}
      <button class="x" type="button" data-x aria-label="Close ${esc(baseName(t.path))}${dirty ? ' (unsaved)' : ''}">${icon('close', 13)}</button></div>`;
  }).join('');
  const on = $('.tab.on', el);
  if (on) {
    const l = on.offsetLeft, r = l + on.offsetWidth;
    if (l < el.scrollLeft) el.scrollLeft = l - 8; else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 8;
  }
  $('.tab-save') && ($('.tab-save').disabled = !isDirty(active()));
  $('.ws-nav [data-pane=editor]')?.classList.toggle('dot', dirtyCount() > 0);
}

function bindTabs() {
  const el = $('#ws-tabs');
  el.addEventListener('click', (e) => {
    const tabEl = e.target.closest('[data-tab]'); if (!tabEl) return;
    const t = tabFor(tabEl.dataset.tab); if (!t) return;
    if (e.target.closest('[data-x]')) return closeTab(t);
    if (W.active !== t.path) activate(t);
  });
  el.addEventListener('auxclick', (e) => { if (e.button === 1) { const t = tabFor(e.target.closest('[data-tab]')?.dataset.tab); if (t) closeTab(t); } });
  longPress(el, '[data-tab]', (tabEl, at) => tabMenu(tabFor(tabEl.dataset.tab), at));
}

async function tabMenu(t, at) {
  if (!t) return;
  const id = await menu([
    { id: 'save', label: 'Save', icon: 'save' }, { id: 'close', label: 'Close', icon: 'close' },
    { id: 'others', label: 'Close others' }, { id: 'saved', label: 'Close saved' }, '-',
    { id: 'reveal', label: 'Reveal in explorer', icon: 'files' }, { id: 'copy', label: 'Copy path', icon: 'copy' },
  ], at, baseName(t.path));
  if (id === 'save') save(t);
  if (id === 'close') closeTab(t);
  if (id === 'others') for (const x of [...W.tabs]) if (x !== t) await closeTab(x);
  if (id === 'saved') for (const x of [...W.tabs]) if (!isDirty(x)) await closeTab(x);
  if (id === 'reveal') revealInTree(t.path);
  if (id === 'copy') copyText(t.path);
}

export async function closeTab(t, force = false) {
  if (!t) return false;
  if (!force && isDirty(t)) {
    const r = await modal({ title: `Save changes to ${baseName(t.path)}?`, text: 'Your edits are lost if you close without saving.',
      actions: [{ label: 'Cancel', value: null }, { label: 'Discard', value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }] });
    if (!r) return false;
    if (r === 'save') { await save(t); if (isDirty(t)) return false; }
  }
  const i = W.tabs.indexOf(t);
  if (i < 0) return true;
  W.tabs.splice(i, 1);
  clearTimeout(t.autoTimer);
  if (W.editor?.getModel() === t.model) W.editor.setModel(null);
  t.model?.dispose();
  if (t.imgUrl) URL.revokeObjectURL(t.imgUrl);
  if (W.active === t.path) {
    const next = W.tabs[Math.min(i, W.tabs.length - 1)];
    if (next) { if (next.kind === 'stub') openFile(next.path); else activate(next); }
    else { W.active = null; renderTabs(); updateTitle(); renderBanner(); showPh('welcome'); history.replaceState(null, '', `#/p/${encodeURIComponent(W.project)}`); persist(); updateStatus(); updateProblems(); }
  } else renderTabs();
  renderTreeDirty();
  updateCloud();
  return true;
}

// ---------------------------------------------------------------- save

export async function save(t, force = false) {
  if (!t?.model || t.saving) return;
  if (!force && !isDirty(t)) return;
  if (!navigator.onLine) return toast('You\'re offline. Your edits are still here; save again when you reconnect.', 'warn', { ms: 5000 });
  t.saving = true; W.saving++; updateCloud();
  const vid = t.model.getAlternativeVersionId();
  try {
    const bytes = new TextEncoder().encode(t.model.getValue());
    const base = force ? (t.conflictRow?.version ?? t.row?.version) : t.row?.version;
    if (W.project === LOOSE) await ensureProject(LOOSE, 'files');
    else if (t.isNew) await ensureProject(W.project, 'folder');
    const row = await putBytes(W.project, t.path, bytes, base || 0, force);
    t.row = row; t.savedVid = vid; t.conflictRow = null; t.isNew = false;
    dropPendingFor(t.path);
    if (W.active === t.path) renderBanner();
    toast(`Saved ${baseName(t.path)}`, 'ok', { ms: 1600 });
  } catch (e) {
    if (e instanceof ConflictError) {
      t.conflictRow = await fetchRow(W.project, t.path).catch(() => null) || { version: t.row?.version, deleted: true };
      if (W.active === t.path) renderBanner(); else toast(`${baseName(t.path)} changed on another device`, 'warn', { actions: [{ label: 'Show', run: () => activate(t) }] });
    } else toast(friendly(e), 'err', { ms: 5500 });
  } finally {
    t.saving = false; W.saving--;
    renderTabs(); renderTreeDirty(); updateCloud(); updateStatus();
  }
}

export async function saveAll() {
  const list = W.tabs.filter(isDirty);
  if (!list.length) return toast('Nothing to save', '', { ms: 1400 });
  for (const t of list) await save(t);
}

// ---------------------------------------------------------------- conflicts & remote changes

function renderBanner() {
  const b = $('#ws-banner'); if (!b) return;
  const t = active();
  if (!t?.conflictRow) { b.hidden = true; b.innerHTML = ''; return; }
  const r = t.conflictRow;
  const who = `${r.device_name || 'another device'}${r.updated_at ? `, ${timeAgo(r.updated_at)}` : ''}`;
  b.className = 'banner';
  if (r.deleted) {
    b.innerHTML = `<span class="msg"><strong>Deleted on another device</strong> (${esc(who)}).</span>
      <button class="btn small" data-b="close" type="button">Close file</button>
      ${t.model ? '<button class="btn small" data-b="overwrite" type="button">Keep my copy</button>' : ''}`;
  } else {
    b.innerHTML = `<span class="msg"><strong>Changed on another device</strong> (${esc(who)}). Your edits here aren't saved.</span>
      <button class="btn small" data-b="reload" type="button">Reload cloud version</button>
      <button class="btn small danger" data-b="overwrite" type="button">Overwrite with mine</button>`;
  }
  b.hidden = false;
  $$('[data-b]', b).forEach((x) => x.addEventListener('click', () => resolveConflict(t, x.dataset.b)));
}

async function resolveConflict(t, choice) {
  try {
    if (choice === 'close') return closeTab(t, true);
    if (choice === 'overwrite') return save(t, true);
    const row = await fetchRow(W.project, t.path);
    if (!row || row.deleted) { t.conflictRow = row || { deleted: true }; return renderBanner(); }
    await reloadFromRow(t, row);
    toast('Loaded the cloud version');
  } catch (e) { toastErr(e); }
}

async function reloadFromRow(t, row) {
  const bytes = await readRow(row);
  if (!tabFor(t.path)) return;
  const text = decodeText(bytes);
  if (text == null || !t.model) { t.kind = 'stub'; t.model?.dispose(); t.model = null; return openFile(t.path); }
  const isActive = W.editor?.getModel() === t.model;
  const pos = isActive ? W.editor.getPosition() : null;
  const top = isActive ? W.editor.getScrollTop() : null;
  t.model.pushEditOperations([], [{ range: t.model.getFullModelRange(), text }], () => null);
  t.savedVid = t.model.getAlternativeVersionId();
  t.row = row; t.conflictRow = null;
  if (pos) W.editor.setPosition(pos);
  if (top != null) W.editor.setScrollTop(top);
  if (W.active === t.path) renderBanner();
  renderTabs(); updateCloud();
}

export function wsOnRemote(row) {
  if (!W.project || row.project !== W.project) return;
  const t = tabFor(row.path);
  if (!t) return;
  if (!t.row) { if (t.kind === 'missing' && !row.deleted) { t.kind = 'stub'; if (W.active === t.path) openFile(t.path); } return; }
  if (row.version <= t.row.version) return;
  if (row.device_id === DEVICE.id) { t.row = row; return; }
  if (!t.model) { t.row = row; if (t.kind === 'image' || t.kind === 'large' || t.kind === 'binary') { t.kind = 'stub'; if (W.active === t.path) openFile(t.path); } return; }
  if (!isDirty(t)) {
    if (row.deleted) { t.conflictRow = row; if (W.active === t.path) renderBanner(); renderTabs(); updateCloud(); return; }
    reloadFromRow(t, row).then(() => toast(`Updated from ${row.device_name || 'another device'}`)).catch(toastErr);
  } else {
    t.conflictRow = row;
    if (W.active === t.path) renderBanner();
    renderTabs(); updateCloud();
  }
}

// ---------------------------------------------------------------- cloud status

function cloudState() {
  if (!navigator.onLine) return ['err', 'cloudOff', 'Offline'];
  if (W.tabs.some((t) => t.conflictRow)) return ['warn', 'warning', 'Conflict'];
  if (W.saving > 0) return ['', 'sync', 'Saving…'];
  const n = dirtyCount();
  if (n) return ['dim', 'cloudUp', `${n} unsaved`];
  return ['ok', 'cloudCheck', 'Synced'];
}

function updateCloud() {
  const [cls, ic, label] = cloudState();
  for (const el of [$('#ws-cloud'), $('#sb-cloud')]) {
    if (!el) continue;
    el.className = el.id === 'ws-cloud' ? `cloud-pill ${cls}` : cls;
    el.innerHTML = `<span class="${ic === 'sync' ? 'spin' : ''}">${icon(ic, 14)}</span><span class="cl-lbl">${esc(label)}</span>`;
    el.title = `Cloud: ${label}`;
  }
  const r = $('.tree-root .synced');
  if (r) r.innerHTML = `${icon(ic === 'cloudCheck' ? 'cloudCheck' : 'cloud', 13)} ${esc(label)}`;
}

async function cloudMenu(e) {
  const conflict = W.tabs.find((t) => t.conflictRow);
  const n = dirtyCount();
  const items = [];
  if (conflict) items.push({ id: 'conflict', label: `Resolve conflict in ${baseName(conflict.path)}`, icon: 'warning' });
  if (n) items.push({ id: 'saveAll', label: `Save all (${n})`, icon: 'save' });
  items.push({ id: 'refresh', label: 'Refresh from cloud', icon: 'refresh' });
  const id = await menu(items, e?.clientX ? { x: e.clientX, y: e.clientY + 12 } : null, 'Cloud');
  if (id === 'conflict') { activate(conflict); setPane('editor'); }
  if (id === 'saveAll') saveAll();
  if (id === 'refresh') S.hooks.reload?.();
}

// ---------------------------------------------------------------- problems / fix with Claude

function problems(t = active()) {
  if (!t?.model || !W.monaco) return [];
  return W.monaco.editor.getModelMarkers({ resource: t.model.uri }).filter((m) => m.severity >= W.monaco.MarkerSeverity.Warning);
}

function updateProblems() {
  const list = problems();
  const errs = list.filter((m) => m.severity === W.monaco?.MarkerSeverity.Error).length;
  const warns = list.length - errs;
  const btn = $('#ws-problems');
  if (btn) {
    btn.hidden = !list.length;
    btn.className = `problems${errs ? ' err' : ' warn'}`;
    btn.innerHTML = `${icon(errs ? 'error' : 'warning', 14)}<span>${list.length}</span>`;
    btn.setAttribute('aria-label', `${list.length} problem${list.length === 1 ? '' : 's'}. Fix with Claude`);
  }
  const sb = $('#sb-problems');
  if (sb) sb.innerHTML = `${icon('error', 13)} ${errs} ${icon('warning', 13)} ${warns}`;
}

async function problemsMenu(e) {
  const list = problems();
  if (!list.length) return toast('No problems in this file', '', { ms: 1500 });
  const id = await menu([
    { id: 'fix', label: `✨ Fix ${list.length === 1 ? 'this problem' : `all ${list.length} problems`} with Claude` },
    { id: 'next', label: 'Go to next problem', icon: 'chevronDown' },
    '-', ...list.slice(0, 6).map((m, i) => ({ id: `m${i}`, label: `Ln ${m.startLineNumber}: ${m.message.split('\n')[0].slice(0, 80)}`, icon: m.severity === 8 ? 'error' : 'warning' })),
  ], e?.clientX ? { x: e.clientX - 200, y: e.clientY + 12 } : null, 'Problems');
  if (id === 'fix') return fixProblems();
  if (id === 'next') { setPane('editor'); W.editor.focus(); W.editor.trigger('menu', 'editor.action.marker.next'); }
  if (id?.startsWith('m')) { const m = list[+id.slice(1)]; setPane('editor'); activate(active(), { line: m.startLineNumber, col: m.startColumn }); }
}

function fixProblems(markers) {
  const t = active();
  if (!t?.model) return toast('Open a file first.', 'warn');
  setPane('claude');
  Claude.fixMarkers(t.path, markers || problems(t));
}

function registerFixActions(monaco) {
  const cmd = 'velaryn.fixWithClaude';
  monaco.editor.registerCommand(cmd, (_acc, uri, markers) => {
    const t = W.tabs.find((x) => x.model?.uri.toString() === uri);
    if (t) { activate(t); fixProblems(markers); }
  });
  monaco.languages.registerCodeActionProvider('*', {
    provideCodeActions(model, _range, context) {
      const markers = context.markers.filter((m) => m.severity >= monaco.MarkerSeverity.Warning);
      if (!markers.length) return { actions: [], dispose() {} };
      const all = monaco.editor.getModelMarkers({ resource: model.uri }).filter((m) => m.severity >= monaco.MarkerSeverity.Warning);
      const actions = markers.slice(0, 3).map((m) => ({
        title: `✨ Fix with Claude: ${m.message.split('\n')[0].slice(0, 70)}`, kind: 'quickfix', diagnostics: [m], isPreferred: false,
        command: { id: cmd, title: 'Fix with Claude', arguments: [model.uri.toString(), [m]] },
      }));
      if (all.length > 1) actions.push({ title: `✨ Fix all ${all.length} problems in this file with Claude`, kind: 'quickfix', command: { id: cmd, title: 'Fix all', arguments: [model.uri.toString(), all] } });
      return { actions, dispose() {} };
    },
  });
}

// ---------------------------------------------------------------- explorer

function allPaths() {
  const set = new Map();
  for (const r of liveFiles(W.project)) set.set(r.path, r);
  for (const t of W.tabs) if (t.isNew) set.set(t.path, { path: t.path, isNew: true, size: 0 });
  return set;
}

function buildTree() {
  const root = { dirs: new Map(), files: [], path: '' };
  const ensureDir = (path) => {
    let node = root;
    const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) {
      const p = parts.slice(0, i + 1).join('/');
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { name: parts[i], path: p, dirs: new Map(), files: [] });
      node = node.dirs.get(parts[i]);
    }
    return node;
  };
  for (const f of allPaths().values()) {
    const d = dirName(f.path);
    (d ? ensureDir(d) : root).files.push(f);
  }
  for (const d of W.pendingDirs) ensureDir(d);
  return root;
}

let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    renderTree(); updateCloud();
    for (const t of W.tabs) if (t.kind === 'stub' && W.active === t.path && S.loaded) openFile(t.path);
  }, 120);
}

function renderTree() {
  const el = $('#ws-tree'); if (!el || !W.project) return;
  if (!S.loaded) { el.innerHTML = S.loadError ? `<div class="empty-hint">${esc(S.loadError)}</div>` : '<div class="loading"><div class="spinner"></div></div>'; return; }
  const root = buildTree();
  const rows = [];
  const walk = (node, depth) => {
    for (const d of [...node.dirs.values()].sort((a, b) => cmp(a.name, b.name))) {
      const open = W.openDirs.has(d.path);
      rows.push(`<div class="row dir${W.sel === d.path ? ' sel' : ''}" role="treeitem" aria-expanded="${open}" data-path="${esc(d.path)}" data-kind="dir" style="--d:${depth}">
        <span class="tw">${icon(open ? 'chevronDown' : 'chevronRight', 14)}</span><span class="fold">${icon('folder', 16)}</span><span class="label">${esc(d.name)}</span>
        <button class="row-more" type="button" aria-label="Actions for ${esc(d.name)}">${icon('more', 16)}</button></div>`);
      if (open) walk(d, depth + 1);
    }
    for (const f of [...node.files].sort((a, b) => cmp(baseName(a.path), baseName(b.path)))) {
      const t = tabFor(f.path);
      rows.push(`<div class="row file${W.sel === f.path ? ' sel' : ''}${isDirty(t) ? ' dirty' : ''}${f.isNew ? ' new' : ''}" role="treeitem" data-path="${esc(f.path)}" data-kind="file" style="--d:${depth}">
        <span class="tw"></span>${fileBadge(baseName(f.path))}<span class="label">${esc(baseName(f.path))}</span>
        <button class="row-more" type="button" aria-label="Actions for ${esc(baseName(f.path))}">${icon('more', 16)}</button></div>`);
    }
  };
  walk(root, 0);
  el.innerHTML = rows.length ? rows.join('') : `<div class="empty-hint">This project is empty.<br>
      <button class="btn small" type="button" data-cmd="newFile">${icon('newFile', 15)} New file</button>
      <button class="btn small" type="button" data-cmd="upload">${icon('upload', 15)} Upload files</button></div>`;
}

function renderTreeDirty() {
  $$('#ws-tree .row.file').forEach((r) => r.classList.toggle('dirty', isDirty(tabFor(r.dataset.path))));
}
function renderTreeSel() {
  $$('#ws-tree .row').forEach((r) => r.classList.toggle('sel', r.dataset.path === W.sel));
}

function revealInTree(path) {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) W.openDirs.add(parts.slice(0, i).join('/'));
  W.sel = path; persist();
  setPane('files');
  renderTree();
  $(`#ws-tree .row[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'center' });
}

// Long press (touch) or right click opens a context menu.
function longPress(el, sel, fn) {
  let timer = null, start = null, fired = false;
  el.addEventListener('pointerdown', (e) => {
    const target = e.target.closest(sel); if (!target || e.pointerType === 'mouse') return;
    fired = false; start = { x: e.clientX, y: e.clientY };
    clearTimeout(timer);
    timer = setTimeout(() => { fired = true; navigator.vibrate?.(10); fn(target, { x: start.x, y: start.y }); }, 480);
  });
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointermove', (e) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('scroll', cancel, true);
  el.addEventListener('click', (e) => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
  el.addEventListener('contextmenu', (e) => {
    const target = e.target.closest(sel); if (!target) return;
    e.preventDefault();
    if (!fired) fn(target, { x: e.clientX, y: e.clientY });
  });
}

function bindTree() {
  const el = $('#ws-tree');
  el.addEventListener('click', (e) => {
    const row = e.target.closest('.row'); if (!row) return;
    const path = row.dataset.path;
    if (e.target.closest('.row-more')) { const r = e.target.closest('.row-more').getBoundingClientRect(); return rowMenu(row, { x: r.left - 160, y: r.bottom }); }
    W.sel = path;
    if (row.dataset.kind === 'dir') {
      if (W.openDirs.has(path)) W.openDirs.delete(path); else W.openDirs.add(path);
      persist(); renderTree();
    } else {
      renderTreeSel();
      openFile(path, { focus: false });
      if (isPhone()) setPane('editor');
    }
  });
  longPress(el, '.row', (row, at) => rowMenu(row, at));
}

async function rowMenu(row, at) {
  const path = row.dataset.path, dir = row.dataset.kind === 'dir';
  W.sel = path; renderTreeSel();
  const loose = W.project === LOOSE;
  const items = dir ? [
    { id: 'newFile', label: 'New file here…', icon: 'newFile' },
    { id: 'newFolder', label: 'New folder here…', icon: 'newFolder' },
    { id: 'upload', label: 'Upload files here…', icon: 'upload' }, '-',
    { id: 'rename', label: 'Rename / move…', icon: 'edit' },
    { id: 'zip', label: 'Download as .zip', icon: 'download' },
    { id: 'copy', label: 'Copy path', icon: 'copy' }, '-',
    { id: 'delete', label: 'Delete folder…', icon: 'trash', danger: true },
  ] : [
    { id: 'open', label: 'Open', icon: 'files' },
    { id: 'rename', label: loose ? 'Rename…' : 'Rename / move…', icon: 'edit' },
    { id: 'download', label: 'Download', icon: 'download' },
    { id: 'copy', label: 'Copy path', icon: 'copy' },
    ...(Claude.ready() ? [{ id: 'ask', label: 'Ask Claude about this file' }] : []), '-',
    { id: 'delete', label: 'Delete…', icon: 'trash', danger: true },
  ];
  const id = await menu(items, at, path);
  if (!id) return;
  if (id === 'open') { openFile(path); if (isPhone()) setPane('editor'); }
  if (id === 'newFile') newFile(path);
  if (id === 'newFolder') newFolder(path);
  if (id === 'upload') pickFiles(false, W.project, path);
  if (id === 'rename') renamePath(path, dir);
  if (id === 'zip') downloadZip(W.project, path);
  if (id === 'download') { const t = tabFor(path); if (isDirty(t)) saveBlob(new Blob([t.model.getValue()], { type: 'text/plain' }), baseName(path)); else downloadFile(W.project, path); }
  if (id === 'copy') copyText(path);
  if (id === 'ask') { setPane('claude'); Claude.prefill(`About ${path}: `); }
  if (id === 'delete') deletePath(path, dir);
}

function copyText(s) {
  navigator.clipboard?.writeText(s).then(() => toast('Copied', '', { ms: 1200 })).catch(() => toast(s));
}

function selectedDir() {
  const s = W.sel;
  if (!s) return '';
  const isDir = [...allPaths().keys()].some((p) => p.startsWith(`${s}/`)) || W.pendingDirs.has(s);
  return isDir ? s : dirName(s);
}

export async function newFile(dir = selectedDir()) {
  const loose = W.project === LOOSE;
  const raw = await modal({ title: 'New file', text: loose ? 'A file in Single files.' : 'Use slashes for folders, e.g. src/utils.js',
    input: { placeholder: 'notes.md', value: !loose && dir ? `${dir}/` : '' }, actions: [{ label: 'Cancel', value: null }, { label: 'Create', primary: true }] });
  let path = cleanPath(raw || '');
  if (loose) path = baseName(path);
  if (!path) { if (raw) toast('That is not a valid file name.', 'warn'); return; }
  if (liveRow(W.project, path) || tabFor(path)) { openFile(path, { focus: true }); if (isPhone()) setPane('editor'); return; }
  const t = toast('Creating…', '', { sticky: true, spin: true });
  try {
    await ensureProject(W.project, loose ? 'files' : 'folder');
    const existing = S.rows.get(keyOf(W.project, path));
    await putBytes(W.project, path, new Uint8Array(0), existing?.version || 0);
    t.close();
    dropPendingFor(path);
    revealParents(path);
    renderTree();
    await openFile(path, { focus: !isTouch() });
    if (isPhone()) setPane('editor');
  } catch (e) { t.done(friendly(e), 'err'); }
}

export async function newFolder(dir = selectedDir()) {
  if (W.project === LOOSE) return toast('Single files has no folders. Create a project for folders.', 'warn');
  const raw = await modal({ title: 'New folder', text: 'It is saved to the cloud when you add a file to it.',
    input: { placeholder: 'src', value: dir ? `${dir}/` : '' }, actions: [{ label: 'Cancel', value: null }, { label: 'Create', primary: true }] });
  const path = cleanPath(raw || '');
  if (!path) return;
  W.pendingDirs.add(path);
  revealParents(`${path}/x`);
  W.openDirs.add(path);
  W.sel = path;
  persist(); renderTree();
}

function revealParents(path) { const parts = path.split('/'); for (let i = 1; i < parts.length; i++) W.openDirs.add(parts.slice(0, i).join('/')); }
function dropPendingFor(path) {
  let changed = false;
  for (const d of [...W.pendingDirs]) if (path.startsWith(`${d}/`)) { W.pendingDirs.delete(d); changed = true; }
  if (changed) persist();
}

// Rename / move: commit the same blob hash at the new path, then delete the old path.
async function moveFile(from, to) {
  const row = liveRow(W.project, from);
  const t = tabFor(from);
  if (!row) { if (t?.isNew) { retargetTab(t, to); return; } throw new Error(`${from} is not in the cloud.`); }
  const target = S.rows.get(keyOf(W.project, to));
  if (target && !target.deleted) throw new Error(`${to} already exists.`);
  const newRow = await commit(W.project, to, { hash: row.hash, size: row.size, deleted: false }, target?.version || 0);
  await commit(W.project, from, { hash: '', size: 0, deleted: true }, row.version);
  if (t) { retargetTab(t, to); t.row = newRow; t.conflictRow = null; }
}

function retargetTab(t, to) {
  const wasActive = W.active === t.path;
  const old = t.path;
  t.path = to;
  if (t.model) {
    const dirty = isDirty(t), vs = W.editor?.getModel() === t.model ? W.editor.saveViewState() : t.viewState;
    const text = t.model.getValue();
    if (W.editor?.getModel() === t.model) W.editor.setModel(null);
    t.model.dispose();
    makeModel(t, text);
    if (dirty) t.savedVid = -1;
    t.viewState = vs;
  }
  if (wasActive || W.active === old) { W.active = to; activate(t); }
  renderTabs();
}

async function renamePath(path, dir) {
  const loose = W.project === LOOSE;
  const raw = await modal({ title: dir ? 'Rename / move folder' : (loose ? 'Rename file' : 'Rename / move file'),
    text: loose ? '' : 'Edit the full path to move it to another folder.', input: { value: path },
    actions: [{ label: 'Cancel', value: null }, { label: 'Rename', primary: true }] });
  let to = cleanPath(raw || '');
  if (loose) to = baseName(to);
  if (!to || to === path) return;
  const t = toast('Renaming…', '', { sticky: true, spin: true });
  try {
    if (!dir) {
      await moveFile(path, to);
    } else {
      if (to.startsWith(`${path}/`)) throw new Error('A folder can\'t be moved inside itself.');
      const files = [...allPaths().keys()].filter((p) => p.startsWith(`${path}/`));
      let n = 0;
      for (const f of files) { await moveFile(f, `${to}${f.slice(path.length)}`); t.update(`Renaming ${++n} / ${files.length}…`); }
      for (const d of [...W.pendingDirs]) if (d === path || d.startsWith(`${path}/`)) { W.pendingDirs.delete(d); W.pendingDirs.add(`${to}${d.slice(path.length)}`); }
      if (W.openDirs.has(path)) W.openDirs.add(to);
    }
    revealParents(dir ? `${to}/x` : to);
    W.sel = to; persist(); renderTree();
    t.done('Renamed');
  } catch (e) {
    t.done(e instanceof ConflictError ? 'Changed on another device. Refresh and try again.' : friendly(e), 'err');
    renderTree();
  }
}

async function deletePath(path, dir) {
  const files = dir ? [...allPaths().keys()].filter((p) => p.startsWith(`${path}/`)) : [path];
  const dirty = files.some((p) => isDirty(tabFor(p)));
  const ok = await confirmBox(dir ? `Delete ${baseName(path)} and ${files.length} file${files.length === 1 ? '' : 's'}?` : `Delete ${baseName(path)}?`,
    `${dirty ? 'Unsaved edits are lost too. ' : ''}It will be removed from the cloud and from your other devices on their next sync.`, 'Delete', true);
  if (!ok) return;
  const t = toast('Deleting…', '', { sticky: true, spin: true });
  try {
    for (const p of files) {
      const row = liveRow(W.project, p);
      if (row) await commit(W.project, p, { hash: '', size: 0, deleted: true }, row.version, false);
      const tab = tabFor(p);
      if (tab) await closeTab(tab, true);
    }
    if (dir) for (const d of [...W.pendingDirs]) if (d === path || d.startsWith(`${path}/`)) W.pendingDirs.delete(d);
    persist(); renderTree();
    t.done('Deleted');
  } catch (e) {
    t.done(e instanceof ConflictError ? 'Changed on another device. Reload it and try again.' : friendly(e), 'err');
  }
}

// ---------------------------------------------------------------- search

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function buildRegex(q, o) {
  let src = o.regex ? q : escRe(q);
  if (o.word) src = `\\b(?:${src})\\b`;
  return new RegExp(src, o.case ? 'g' : 'gi');
}

async function fileText(path) {
  const t = tabFor(path);
  if (t?.model) return t.model.getValue();
  const row = liveRow(W.project, path);
  if (!row || Number(row.size) > SEARCH_MAX || BINARY_EXT.test(path)) return null;
  if (W.textCache.has(row.hash)) return W.textCache.get(row.hash);
  const bytes = await readRow(row);
  const text = decodeText(bytes);
  W.textCache.set(row.hash, text);
  return text;
}

// Search every text file in the project (downloads lazily, caches by hash). Also used by Claude.
export async function searchProject(query, opts = {}, { limit = 2000, onProgress, token } = {}) {
  const re = buildRegex(query, opts);
  const paths = [...allPaths().keys()].sort(cmp);
  const out = { files: [], total: 0, skipped: 0, scanned: 0, truncated: false };
  let i = 0;
  const results = new Map();
  const worker = async () => {
    while (i < paths.length && !out.truncated) {
      const p = paths[i++];
      if (token != null && token !== W.search.token) return;
      let text = null;
      try { text = await fileText(p); } catch { text = null; }
      out.scanned++;
      if (text == null) { out.skipped++; continue; }
      const matches = [];
      const lines = text.split('\n');
      for (let ln = 0; ln < lines.length && !out.truncated; ln++) {
        const line = lines[ln];
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line))) {
          matches.push({ line: ln + 1, col: m.index + 1, len: m[0].length, text: line });
          if (++out.total >= limit) { out.truncated = true; break; }
          if (!m[0].length) re.lastIndex++;
        }
      }
      if (matches.length) results.set(p, matches);
      onProgress?.(out);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  out.files = paths.filter((p) => results.has(p)).map((p) => ({ path: p, matches: results.get(p) }));
  return out;
}

function bindSearch() {
  const q = $('#ws-q');
  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSearch, 350); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); runSearch(); q.blur(); } });
  $$('[data-opt]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.opt; W.search[k] = !W.search[k]; b.classList.toggle('on', W.search[k]); runSearch();
  }));
  $('#ws-results').addEventListener('click', (e) => {
    const m = e.target.closest('[data-line]');
    const f = e.target.closest('[data-file]');
    if (m) {
      openFile(m.dataset.file, { line: +m.dataset.line, col: +m.dataset.col, len: +m.dataset.len, focus: !isTouch() });
      if (isPhone()) setPane('editor');
    } else if (f) f.parentElement.classList.toggle('collapsed');
  });
}

async function runSearch() {
  const q = $('#ws-q').value;
  const sum = $('#ws-sum'), res = $('#ws-results');
  const token = ++W.search.token;
  W.search.q = q;
  if (!q) { sum.textContent = ''; res.innerHTML = ''; return; }
  try { buildRegex(q, W.search); } catch (e) { sum.textContent = `Invalid regular expression: ${e.message}`; res.innerHTML = ''; return; }
  sum.innerHTML = '<span class="spin-inline"></span> Searching…';
  const out = await searchProject(q, W.search, { token, onProgress: (o) => { if (token === W.search.token) sum.textContent = `Searching… ${o.scanned} files`; } });
  if (token !== W.search.token) return;
  sum.textContent = out.total ? `${out.total}${out.truncated ? '+' : ''} result${out.total === 1 ? '' : 's'} in ${out.files.length} file${out.files.length === 1 ? '' : 's'}${out.skipped ? ` · ${out.skipped} binary or large file${out.skipped === 1 ? '' : 's'} skipped` : ''}`
    : `No results${out.skipped ? ` · ${out.skipped} binary or large file${out.skipped === 1 ? '' : 's'} skipped` : ''}`;
  res.innerHTML = out.files.map((f) => `<div class="sr-group">
      <div class="sr-file" data-file="${esc(f.path)}"><span class="tw">${icon('chevronDown', 14)}</span>${fileBadge(baseName(f.path))}<span class="nm">${esc(baseName(f.path))}</span><span class="dir">${esc(dirName(f.path))}</span><span class="count">${f.matches.length}</span></div>
      ${f.matches.slice(0, 200).map((m) => {
        const start = Math.max(0, m.col - 1 - 30);
        const before = m.text.slice(start, m.col - 1), hit = m.text.slice(m.col - 1, m.col - 1 + m.len), after = m.text.slice(m.col - 1 + m.len, m.col - 1 + m.len + 120);
        return `<div class="sr-match" data-file="${esc(f.path)}" data-line="${m.line}" data-col="${m.col}" data-len="${m.len}"><span class="ln">${m.line}</span>${start ? '…' : ''}${esc(before.trimStart())}<mark>${esc(hit)}</mark>${esc(after)}</div>`;
      }).join('')}</div>`).join('');
}

// ---------------------------------------------------------------- accessory bar (phones)

function showAccessory(show) {
  const acc = $('#ws-acc'); if (!acc) return;
  const want = show && isTouch() && active()?.kind === 'text';
  if (acc.hidden === !want) return;
  acc.hidden = !want;
  document.body.classList.toggle('acc-on', want);
  W.editor?.layout();
}

function bindAccessory() {
  const acc = $('#ws-acc');
  // keep focus (and the keyboard) in the editor while tapping keys
  acc.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  acc.addEventListener('mousedown', (e) => e.preventDefault());
  acc.addEventListener('click', (e) => {
    const b = e.target.closest('[data-acc]'); if (!b) return;
    const ed = W.editor; if (!ed?.getModel()) return;
    const a = b.dataset.acc;
    if (a === 'hide') { ed.getContainerDomNode().querySelector('textarea')?.blur(); document.activeElement?.blur?.(); showAccessory(false); return; }
    if (a.startsWith('ch:')) ed.trigger('accessory', 'type', { text: a.slice(3) });
    else if (a === 'tab') ed.trigger('accessory', 'tab', null);
    else if (a === 'outdent') ed.trigger('accessory', 'outdent', null);
    else if (a === 'undo') ed.trigger('accessory', 'undo', null);
    else if (a === 'redo') ed.trigger('accessory', 'redo', null);
    else if (a === 'find') ed.getAction('actions.find')?.run();
    else if (a === 'save') save(active());
    else ed.trigger('accessory', a, null);
    if (a !== 'find') ed.focus();
  });
}

// ---------------------------------------------------------------- quick open & command palette

function fuzzy(query, text) {
  if (!query) return { score: 0, hits: [] };
  const q = query.toLowerCase(), t = text.toLowerCase();
  let qi = 0, score = 0, last = -2;
  const hits = [];
  const slash = t.lastIndexOf('/');
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += 1 + (last === i - 1 ? 5 : 0) + (i > slash ? 3 : 0) + (i === 0 || '/._- '.includes(t[i - 1]) ? 4 : 0);
      hits.push(i); last = i; qi++;
    }
  }
  if (qi < q.length) return null;
  return { score: score - t.length * 0.05, hits };
}
function hl(text, hits, offset = 0) {
  const set = new Set(hits.map((h) => h - offset));
  return [...text].map((ch, i) => (set.has(i) ? `<b>${esc(ch)}</b>` : esc(ch))).join('');
}

const COMMANDS = [
  { id: 'save', label: 'File: Save', key: '⌘S' },
  { id: 'saveAll', label: 'File: Save All', key: '⌥⌘S' },
  { id: 'newFile', label: 'File: New File…' },
  { id: 'newFolder', label: 'File: New Folder…' },
  { id: 'upload', label: 'File: Upload Files…' },
  { id: 'download', label: 'File: Download' },
  { id: 'closeTab', label: 'View: Close Editor' },
  { id: 'quickOpen', label: 'Go to File…', key: '⌘P' },
  { id: 'gotoLine', label: 'Go to Line…', key: '⌃G' },
  { id: 'find', label: 'Find', key: '⌘F' },
  { id: 'replace', label: 'Replace', key: '⌥⌘F' },
  { id: 'search', label: 'Search in Project', key: '⇧⌘F' },
  { id: 'format', label: 'Format Document', key: '⇧⌥F' },
  { id: 'wrap', label: 'View: Toggle Word Wrap', key: '⌥Z' },
  { id: 'fontUp', label: 'View: Increase Font Size' },
  { id: 'fontDown', label: 'View: Decrease Font Size' },
  { id: 'tabSize', label: 'View: Change Tab Size…' },
  { id: 'files', label: 'View: Explorer' },
  { id: 'claude', label: 'Claude: Open' },
  { id: 'fixFile', label: 'Claude: ✨ Fix Problems in This File' },
  { id: 'fixPaste', label: 'Claude: Paste an Error to Fix…' },
  { id: 'settings', label: 'Preferences: Open Settings' },
  { id: 'projects', label: 'Back to Projects' },
];

let Q = null;
function openQuick(prefix = '') {
  closeQuick();
  const el = document.createElement('div');
  el.className = 'quick';
  el.innerHTML = `<div class="quick-box" role="dialog" aria-label="Quick open"><input class="quick-input" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go"
      placeholder="Go to file  ·  type > for commands  ·  : for a line"><div class="quick-list" role="listbox"></div></div>`;
  document.body.appendChild(el);
  Q = { el, items: [], sel: 0 };
  const input = $('.quick-input', el);
  input.value = prefix;
  input.addEventListener('input', updateQuick);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeQuick(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); Q.sel = Math.min(Q.items.length - 1, Q.sel + 1); paintQuick(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); Q.sel = Math.max(0, Q.sel - 1); paintQuick(); }
    if (e.key === 'Enter') { e.preventDefault(); pickQuick(Q.sel); }
  });
  el.addEventListener('click', (e) => {
    const it = e.target.closest('[data-qi]');
    if (it) return pickQuick(+it.dataset.qi);
    if (e.target === el) closeQuick();
  });
  updateQuick();
  input.focus();
}
function closeQuick() { Q?.el.remove(); Q = null; }

function updateQuick() {
  const v = $('.quick-input', Q.el).value;
  let items = [];
  if (v.startsWith('>')) {
    const q = v.slice(1).trim();
    // every word must match somewhere, in any order ("font inc" finds "Increase Font Size")
    const words = q.split(/\s+/).filter(Boolean);
    for (const c of COMMANDS) {
      let m = { score: 0, hits: [] };
      for (const w of words) {
        const r = fuzzy(w, c.label);
        if (!r) { m = null; break; }
        m.score += r.score; m.hits.push(...r.hits);
      }
      if (m) items.push({ kind: 'cmd', label: c.label, key: c.key, id: c.id, m });
    }
    if (q) items.sort((a, b) => b.m.score - a.m.score);
  } else if (v.startsWith(':')) {
    const n = parseInt(v.slice(1), 10);
    const t = active();
    items = t?.model ? [{ kind: 'line', label: n ? `Go to line ${n}` : `Type a line number (1–${t.model.getLineCount()})`, line: n, m: { hits: [] } }] : [{ kind: 'none', label: 'Open a file first', m: { hits: [] } }];
  } else {
    const recent = W.tabs.map((t) => t.path).reverse();
    for (const p of allPaths().keys()) {
      const m = fuzzy(v, p);
      if (m) items.push({ kind: 'file', label: baseName(p), detail: dirName(p), path: p, m, recent: recent.indexOf(p) });
    }
    if (v) items.sort((a, b) => b.m.score - a.m.score);
    else items.sort((a, b) => ((b.recent >= 0) - (a.recent >= 0)) || (a.recent - b.recent) || cmp(a.path, b.path));
    items = items.slice(0, 200);
  }
  Q.items = items; Q.sel = 0;
  paintQuick();
}

function paintQuick() {
  const list = $('.quick-list', Q.el);
  if (!Q.items.length) { list.innerHTML = '<div class="qi-empty">No matches</div>'; return; }
  list.innerHTML = Q.items.map((it, i) => {
    if (it.kind === 'file') {
      const off = it.path.length - it.label.length;
      return `<div class="qi${i === Q.sel ? ' on' : ''}" role="option" data-qi="${i}">${fileBadge(it.label)}<span class="l">${hl(it.label, it.m.hits.filter((h) => h >= off), off)}</span><span class="d">${esc(it.detail)}</span></div>`;
    }
    return `<div class="qi${i === Q.sel ? ' on' : ''}" role="option" data-qi="${i}"><span class="l">${it.kind === 'cmd' ? hl(it.label, it.m.hits) : esc(it.label)}</span>${it.key ? `<span class="k">${esc(it.key)}</span>` : ''}</div>`;
  }).join('');
  $('.qi.on', list)?.scrollIntoView({ block: 'nearest' });
}

function pickQuick(i) {
  const it = Q?.items[i]; if (!it) return;
  closeQuick();
  if (it.kind === 'file') { openFile(it.path, { focus: !isTouch() }); setPane('editor'); }
  if (it.kind === 'cmd') runCommand(it.id);
  if (it.kind === 'line' && it.line) gotoLine(it.line);
}

function gotoLine(n) {
  const t = active(); if (!t?.model) return;
  const line = Math.max(1, Math.min(t.model.getLineCount(), n));
  setPane('editor');
  activate(t, { line, col: 1 });
  W.editor.focus();
}

function needEditor() {
  if (!active()?.model) { toast('Open a file first.', 'warn', { ms: 1800 }); return null; }
  setPane('editor');
  return W.editor;
}

export async function runCommand(id, ev) {
  const ed = () => needEditor();
  switch (id) {
    case 'quickOpen': return openQuick('');
    case 'palette': return openQuick('>');
    case 'save': return active()?.model ? save(active()) : toast('Nothing to save', '', { ms: 1200 });
    case 'saveAll': return saveAll();
    case 'newFile': return newFile();
    case 'newFolder': return newFolder();
    case 'upload': return pickFiles(false, W.project, selectedDir());
    case 'explorerMore': {
      const id2 = await menu([
        { id: 'uploadFolder', label: 'Upload a folder…', icon: 'upload' },
        { id: 'zip', label: 'Download project as .zip', icon: 'download' },
        { id: 'refresh', label: 'Refresh', icon: 'refresh' },
        { id: 'collapse', label: 'Collapse all folders', icon: 'collapse' },
      ], ev?.clientX ? { x: ev.clientX - 180, y: ev.clientY + 12 } : null, 'Explorer');
      if (id2 === 'uploadFolder') pickFiles(true, W.project, selectedDir());
      if (id2 === 'zip') downloadZip(W.project);
      if (id2 === 'refresh') S.hooks.reload?.();
      if (id2 === 'collapse') { W.openDirs.clear(); persist(); renderTree(); }
      return;
    }
    case 'download': { const t = active(); if (!t) return; if (isDirty(t)) return saveBlob(new Blob([t.model.getValue()], { type: 'text/plain' }), baseName(t.path)); return downloadFile(W.project, t.path); }
    case 'closeTab': return closeTab(active());
    case 'gotoLine': {
      const t = active(); if (!t?.model) return toast('Open a file first.', 'warn');
      const v = await modal({ title: 'Go to line', input: { type: 'number', placeholder: `1–${t.model.getLineCount()}` }, actions: [{ label: 'Cancel', value: null }, { label: 'Go', primary: true }] });
      if (v) gotoLine(parseInt(v, 10) || 1);
      return;
    }
    case 'find': { const e = ed(); if (e) { e.focus(); e.getAction('actions.find').run(); } return; }
    case 'replace': { const e = ed(); if (e) { e.focus(); e.getAction('editor.action.startFindReplaceAction').run(); } return; }
    case 'search': return setPane('search');
    case 'files': return setPane('files');
    case 'format': {
      const e = ed(); if (!e) return;
      const a = e.getAction('editor.action.formatDocument');
      if (!a || !a.isSupported()) return toast('No formatter for this file type.', 'warn');
      return a.run();
    }
    case 'wrap': setSetting({ wordWrap: !settings().wordWrap }); return toast(`Word wrap ${settings().wordWrap ? 'on' : 'off'}`, '', { ms: 1200 });
    case 'fontUp': setSetting({ fontSize: Math.min(28, settings().fontSize + 1) }); return toast(`Font size ${settings().fontSize}`, '', { ms: 1000 });
    case 'fontDown': setSetting({ fontSize: Math.max(9, settings().fontSize - 1) }); return toast(`Font size ${settings().fontSize}`, '', { ms: 1000 });
    case 'tabSize': {
      const v = await menu([{ id: 2, label: '2 spaces' }, { id: 4, label: '4 spaces' }, { id: 8, label: '8 spaces' }], null, 'Tab size');
      if (v) setSetting({ tabSize: v });
      return;
    }
    case 'claude': return setPane('claude');
    case 'fixFile': return fixProblems();
    case 'fixPaste': setPane('claude'); return Claude.pasteError();
    case 'settings': return setPane('settings');
    case 'projects': location.hash = '#/'; return;
    default:
  }
}

// global shortcuts (also outside Monaco)
document.addEventListener('keydown', (e) => {
  if (!W.project || $('#ws').hidden || document.querySelector('.modal-back')) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); if (e.altKey) saveAll(); else save(active()); }
  else if (mod && e.shiftKey && k === 'p') { e.preventDefault(); openQuick('>'); }
  else if (mod && k === 'p') { e.preventDefault(); openQuick(''); }
  else if (mod && e.shiftKey && k === 'f') { e.preventDefault(); setPane('search'); }
  else if (mod && e.shiftKey && k === 'e') { e.preventDefault(); setPane('files'); }
  else if (mod && k === 'escape') { e.preventDefault(); setPane('claude'); }
  else if (e.ctrlKey && k === 'g') { e.preventDefault(); runCommand('gotoLine'); }
}, true);

window.addEventListener('beforeunload', (e) => { if (dirtyCount()) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('online', updateCloud);
window.addEventListener('offline', updateCloud);

// ---------------------------------------------------------------- Claude bridge

function claudeApi() {
  return {
    project: () => W.project,
    projectLabel: () => projectLabel(W.project),
    activePath: () => active()?.path || null,
    context() {
      const t = active();
      if (!t?.model || !W.editor || W.editor.getModel() !== t.model) return null;
      const sel = W.editor.getSelection();
      const pos = W.editor.getPosition();
      if (sel && !sel.isEmpty()) return { path: t.path, start: sel.startLineNumber, end: sel.endLineNumber, text: t.model.getValueInRange(sel) };
      return { path: t.path, line: pos?.lineNumber || 1 };
    },
    listFiles() {
      return [...allPaths().values()].sort((a, b) => cmp(a.path, b.path)).map((f) => ({ path: f.path, size: Number(f.size) || 0, unsaved: isDirty(tabFor(f.path)) }));
    },
    async readFile(path) {
      path = cleanPath(path);
      const t = tabFor(path);
      if (t?.model) return t.model.getValue();
      const row = liveRow(W.project, path);
      if (!row) throw new Error(`File not found: ${path}`);
      if (Number(row.size) > SEARCH_MAX) throw new Error(`${path} is ${fmtSize(row.size)}, too large to read here (limit 1 MB).`);
      const text = await fileText(path);
      if (text == null) throw new Error(`${path} is a binary file.`);
      return text;
    },
    search: (q, o) => searchProject(q, o, { limit: 300 }),
    exists: (path) => !!(liveRow(W.project, cleanPath(path)) || tabFor(cleanPath(path))),
    // Apply content to the editor as an unsaved change. Returns { before, after, created }.
    async applyEdit(path, content, { create = false } = {}) {
      path = cleanPath(path);
      let t;
      if (create) {
        if (liveRow(W.project, path) || tabFor(path)) throw new Error(`${path} already exists. Use propose_edit to change it.`);
        if (!W.monaco) await initEditor();
        t = { path, kind: 'text', isNew: true };
        makeModel(t, '');
        W.tabs.push(t);
        revealParents(path);
      } else {
        t = tabFor(path);
        if (!t || t.kind === 'stub' || t.kind === 'error') t = await openFile(path, { focus: false });
        if (!t || t.kind !== 'text' || !t.model) throw new Error(`${path} can't be edited here (${t?.kind === 'missing' || !t ? 'not found' : 'binary or too large'}).`);
      }
      const before = t.model.getValue();
      t.model.pushStackElement();
      t.model.pushEditOperations([], [{ range: t.model.getFullModelRange(), text: content }], () => null);
      t.model.pushStackElement();
      const after = t.model.getValue();
      activate(t);
      renderTree();
      return { before, after, created: create };
    },
    // Undo a proposal: restore the earlier text (or drop a created, still-unsaved file).
    async revertEdit(path, before, { created = false } = {}) {
      const t = tabFor(path);
      if (!t?.model) return;
      if (created && t.isNew) { await closeTab(t, true); renderTree(); return; }
      t.model.pushStackElement();
      t.model.pushEditOperations([], [{ range: t.model.getFullModelRange(), text: before }], () => null);
      t.model.pushStackElement();
      activate(t);
    },
    open: (path, line) => { openFile(path, { line, focus: false }); setPane('editor'); },
    save: (path) => save(tabFor(path)),
    isDirty: (path) => isDirty(tabFor(path)),
    problems: (path) => problems(path ? tabFor(path) : active()),
    insert(text) {
      const t = active();
      if (!t?.model) return toast('Open a file to insert code into.', 'warn');
      setPane('editor');
      W.editor.executeEdits('claude', [{ range: W.editor.getSelection(), text, forceMoveMarkers: true }]);
      W.editor.focus();
    },
    openSettings: () => setPane('settings'),
    close: () => setPane('editor'),
  };
}
