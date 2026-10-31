// Website project page: a file manager (no editor). Browse the tree, see each file's last device,
// time and size, upload / new folder / rename / move / delete / download / zip, delete the project,
// and open a details sheet with a read-only preview (escaped text in a <pre>, or an image).
import {
  S, $, esc, store, keyOf, projectLabel, baseName, dirName, cmp, LOOSE, IMAGE_EXT, BINARY_EXT, SEARCH_MAX,
  DEVICE, timeAgo, fmtSize, deviceHtml, friendly, toast, modal, confirmBox, menu,
  liveFiles, liveRow, commit, readRow, ConflictError, cleanPath, pickFiles, downloadFile, downloadZip, decodeText, emit,
} from './core.js?v=1793470528';
import { icon, fileBadge } from './icons.js?v=1793470528';

const PREVIEW_IMG_MAX = 20 * 1024 * 1024;
const PREVIEW_LINES = 10000;

const F = { project: null, openDirs: new Set(), pending: new Set(), sheetPath: null, sheetHash: null, imgUrl: null, previewToken: 0 };
const ukey = (k) => `${k}:${S.user?.id || ''}:${F.project}`;
const projHref = (p) => `#/p/${encodeURIComponent(p)}`;

function persist() {
  store.set(ukey('vc_fm'), JSON.stringify([...F.openDirs]));
  store.set(ukey('vc_dirs'), JSON.stringify([...F.pending]));   // same key as the app's workspace
}

function loadState() {
  try { F.openDirs = new Set(JSON.parse(store.get(ukey('vc_fm')) || '[]')); } catch { F.openDirs = new Set(); }
  try { F.pending = new Set(JSON.parse(store.get(ukey('vc_dirs')) || '[]')); } catch { F.pending = new Set(); }
}

export function closeProject() {
  closeSheet(false);
  F.project = null;
}

// ---------------------------------------------------------------- page

export function renderProject(project, path) {
  const v = $('#view');
  const mounted = F.project === project && v.querySelector('.fm');
  if (!mounted) {
    closeSheet(false);
    F.project = project;
    loadState();
    v.innerHTML = `<div class="fm">
      <div class="crumbs"><a href="#/">‹ Projects</a></div>
      <div class="page-title"><h1></h1></div>
      <div class="page-sub"></div>
      <div class="toolbar">
        <button class="btn small primary" type="button" data-fm="upload">${icon('upload', 15)} Upload files</button>
        ${project === LOOSE ? '' : `<button class="btn small" type="button" data-fm="uploadFolder">${icon('upload', 15)} Upload folder</button>
        <button class="btn small" type="button" data-fm="newFolder">${icon('newFolder', 15)} New folder</button>`}
        <button class="btn small" type="button" data-fm="zip">${icon('download', 15)} Download .zip</button>
        <button class="btn small danger" type="button" data-fm="deleteProject">${icon('trash', 15)} Delete project</button>
      </div>
      <div class="fm-tree" role="tree"></div>
      <p class="fm-hint tiny muted">Editing happens in the Velaryn Code apps. Here you can manage, preview and download your files.</p>
    </div>`;
    $('.page-title h1', v).textContent = projectLabel(project);
    bindPage($('.fm', v));   // bound to the new .fm element, so listeners never pile up on #view
  }
  refreshProject();
  if (path && path !== F.sheetPath) openDetails(path);
}

export function refreshProject() {
  const v = $('#view');
  if (!F.project || !v.querySelector('.fm')) return;
  const files = liveFiles(F.project);
  const latest = files.reduce((a, b) => (!a || b.updated_at > a.updated_at ? b : a), null);
  const size = files.reduce((s, f) => s + Number(f.size || 0), 0);
  $('.page-sub', v).innerHTML = `${files.length} file${files.length === 1 ? '' : 's'} · ${fmtSize(size)}${latest ? ` · last change ${deviceHtml(latest.device_os, latest.device_name, latest.updated_at)}` : ''}`;
  $('[data-fm=zip]', v).disabled = !files.length;
  renderTree();
  if (F.sheetPath) refreshSheetMeta();
}

function buildTree() {
  const root = { dirs: new Map(), files: [], path: '' };
  const ensureDir = (path) => {
    let node = root;
    const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) {
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { name: parts[i], path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [] });
      node = node.dirs.get(parts[i]);
    }
    return node;
  };
  for (const f of liveFiles(F.project)) { const d = dirName(f.path); (d ? ensureDir(d) : root).files.push(f); }
  for (const d of F.pending) ensureDir(d);
  return root;
}
const countFiles = (n) => n.files.length + [...n.dirs.values()].reduce((s, d) => s + countFiles(d), 0);

function renderTree() {
  const el = $('#view .fm-tree'); if (!el) return;
  const rows = [];
  const walk = (node, depth) => {
    for (const d of [...node.dirs.values()].sort((a, b) => cmp(a.name, b.name))) {
      const open = F.openDirs.has(d.path);
      const n = countFiles(d);
      rows.push(`<div class="fm-row dir" role="treeitem" aria-expanded="${open}" data-path="${esc(d.path)}" data-kind="dir" style="--d:${depth}">
        <span class="tw">${icon(open ? 'chevronDown' : 'chevronRight', 14)}</span><span class="fold">${icon('folder', 17)}</span>
        <span class="main"><span class="label">${esc(d.name)}</span><span class="meta">${n ? `${n} file${n === 1 ? '' : 's'}` : 'Empty folder (saved when you add a file)'}</span></span>
        <button class="row-more" type="button" aria-label="Actions for ${esc(d.name)}">${icon('more', 18)}</button></div>`);
      if (open) walk(d, depth + 1);
    }
    for (const f of [...node.files].sort((a, b) => cmp(baseName(a.path), baseName(b.path)))) {
      rows.push(`<div class="fm-row file${F.sheetPath === f.path ? ' sel' : ''}" role="treeitem" data-path="${esc(f.path)}" data-kind="file" style="--d:${depth}">
        <span class="tw"></span>${fileBadge(baseName(f.path))}
        <span class="main"><span class="label">${esc(baseName(f.path))}</span><span class="meta">${deviceHtml(f.device_os, f.device_name, f.updated_at)} · ${fmtSize(f.size)}</span></span>
        <button class="row-more" type="button" aria-label="Actions for ${esc(baseName(f.path))}">${icon('more', 18)}</button></div>`);
    }
  };
  walk(buildTree(), 0);
  el.innerHTML = rows.length ? rows.join('') : `<div class="empty"><div class="big-ic">${icon('folder', 28)}</div><strong>This project is empty.</strong>
    <p>Upload files from this device, or open the project in a Velaryn Code app.</p></div>`;
}

function bindPage(v) {
  v.addEventListener('click', (e) => {
    const a = e.target.closest('[data-fm]')?.dataset.fm;
    if (a) return pageAction(a, e);
    const row = e.target.closest('.fm-row'); if (!row) return;
    const path = row.dataset.path;
    if (e.target.closest('.row-more')) { const r = e.target.closest('.row-more').getBoundingClientRect(); return rowMenu(row, { x: r.left - 180, y: r.bottom }); }
    if (row.dataset.kind === 'dir') {
      if (F.openDirs.has(path)) F.openDirs.delete(path); else F.openDirs.add(path);
      persist(); renderTree();
    } else openDetails(path);
  });
  v.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.fm-row'); if (!row) return;
    e.preventDefault();
    rowMenu(row, { x: e.clientX, y: e.clientY });
  });
}

async function pageAction(a) {
  const p = F.project;
  if (a === 'upload') return pickFiles(false, p);
  if (a === 'uploadFolder') return pickFiles(true, p);
  if (a === 'newFolder') return newFolder('');
  if (a === 'zip') return downloadZip(p);
  if (a === 'deleteProject') return deleteProject();
}

async function rowMenu(row, at) {
  const path = row.dataset.path, dir = row.dataset.kind === 'dir';
  const loose = F.project === LOOSE;
  const items = dir ? [
    { id: 'upload', label: 'Upload files here…', icon: 'upload' },
    { id: 'newFolder', label: 'New folder here…', icon: 'newFolder' },
    { id: 'rename', label: 'Rename / move…', icon: 'edit' },
    { id: 'zip', label: 'Download as .zip', icon: 'download' }, '-',
    { id: 'delete', label: 'Delete folder…', icon: 'trash', danger: true },
  ] : [
    { id: 'details', label: 'Details & preview', icon: 'eye' },
    { id: 'download', label: 'Download', icon: 'download' },
    { id: 'rename', label: loose ? 'Rename…' : 'Rename / move…', icon: 'edit' }, '-',
    { id: 'delete', label: 'Delete…', icon: 'trash', danger: true },
  ];
  const id = await menu(items, at, path);
  if (id === 'upload') pickFiles(false, F.project, path);
  if (id === 'newFolder') newFolder(path);
  if (id === 'zip') downloadZip(F.project, path);
  if (id === 'details') openDetails(path);
  if (id === 'download') downloadFile(F.project, path);
  if (id === 'rename') renamePath(path, dir);
  if (id === 'delete') deletePath(path, dir);
}

// ---------------------------------------------------------------- actions (conflict-safe vc_commit writes)

async function newFolder(dir) {
  const raw = await modal({ title: 'New folder', text: 'It is saved to the cloud when you add a file to it.',
    input: { placeholder: 'src', value: dir ? `${dir}/` : '' }, actions: [{ label: 'Cancel', value: null }, { label: 'Create', primary: true }] });
  const path = cleanPath(raw || '');
  if (!path) return;
  F.pending.add(path);
  const parts = path.split('/');
  for (let i = 1; i <= parts.length; i++) F.openDirs.add(parts.slice(0, i).join('/'));
  persist(); renderTree();
}

function dropPending(prefix, to = null) {
  for (const d of [...F.pending]) {
    if (d === prefix || d.startsWith(`${prefix}/`)) { F.pending.delete(d); if (to != null) F.pending.add(`${to}${d.slice(prefix.length)}`); }
  }
}

async function moveFile(from, to) {
  const row = liveRow(F.project, from);
  if (!row) throw new Error(`${from} is no longer in the cloud.`);
  const target = S.rows.get(keyOf(F.project, to));
  if (target && !target.deleted) throw new Error(`${to} already exists.`);
  // same blob (hash/size) at the new path, then delete the old path; both check versions
  await commit(F.project, to, { hash: row.hash, size: row.size, deleted: false }, target?.version || 0);
  await commit(F.project, from, { hash: '', size: 0, deleted: true }, row.version);
}

async function renamePath(path, dir) {
  const loose = F.project === LOOSE;
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
      if (F.sheetPath === path) { F.sheetPath = to; setSheetHash(to); }
    } else {
      if (to.startsWith(`${path}/`)) throw new Error('A folder can\'t be moved inside itself.');
      const files = liveFiles(F.project).map((r) => r.path).filter((p) => p.startsWith(`${path}/`));
      let n = 0;
      for (const f of files) { await moveFile(f, `${to}${f.slice(path.length)}`); t.update(`Renaming ${++n} / ${files.length}…`); }
      dropPending(path, to);
      if (F.openDirs.has(path)) F.openDirs.add(to);
    }
    const parts = to.split('/');
    for (let i = 1; i < parts.length; i++) F.openDirs.add(parts.slice(0, i).join('/'));
    persist();
    t.done('Renamed');
  } catch (e) {
    t.done(e instanceof ConflictError ? 'Changed on another device. Try again in a moment.' : friendly(e), 'err');
  }
  refreshProject();
}

async function deletePath(path, dir) {
  const files = dir ? liveFiles(F.project).map((r) => r.path).filter((p) => p.startsWith(`${path}/`)) : [path];
  const ok = await confirmBox(dir ? `Delete ${baseName(path)} and ${files.length} file${files.length === 1 ? '' : 's'}?` : `Delete ${baseName(path)}?`,
    'It will be removed from the cloud and from your other devices on their next sync.', 'Delete', true);
  if (!ok) return;
  const t = toast('Deleting…', '', { sticky: true, spin: true });
  try {
    let n = 0;
    for (const p of files) {
      const row = liveRow(F.project, p);
      if (row) await commit(F.project, p, { hash: '', size: 0, deleted: true }, row.version, false);
      if (files.length > 1) t.update(`Deleting ${++n} / ${files.length}…`);
    }
    if (dir) dropPending(path);
    if (F.sheetPath && files.includes(F.sheetPath)) closeSheet();
    persist();
    t.done('Deleted');
  } catch (e) {
    t.done(e instanceof ConflictError ? 'Changed on another device. Try again in a moment.' : friendly(e), 'err');
  }
  refreshProject();
}

// Same as the desktop's deleteCloudProject: write the 'deleted' tombstone (upsert), then delete the rows.
async function deleteProject() {
  const p = F.project;
  const n = liveFiles(p).length;
  const ok = await confirmBox(`Delete ${projectLabel(p)}?`,
    `This removes the project and its ${n} file${n === 1 ? '' : 's'} from the cloud, and every device stops syncing it. Copies already on a computer stay there.`,
    'Delete project', true);
  if (!ok) return;
  const t = toast('Deleting project…', '', { sticky: true, spin: true });
  try {
    const tomb = { user_id: S.user.id, name: p, kind: 'deleted', device_name: DEVICE.name, device_os: DEVICE.os, updated_at: new Date().toISOString() };
    const { error: tErr } = await S.client.from('vc_projects').upsert(tomb, { onConflict: 'user_id,name' });
    if (tErr) throw tErr;
    const { error } = await S.client.from('vc_files').delete().eq('project', p);
    if (error) throw error;
    const meta = S.projectMeta.find((x) => x.name === p);
    if (meta) Object.assign(meta, tomb); else S.projectMeta.push(tomb);
    for (const [k, r] of [...S.rows]) if (r.project === p) S.rows.delete(k);
    F.pending.clear(); persist();
    t.done('Project deleted');
    emit('rows');
    location.hash = '#/';
  } catch (e) { t.done(friendly(e), 'err'); }
}

// ---------------------------------------------------------------- details sheet + preview

function setSheetHash(path) {
  history.replaceState(null, '', path ? `#/f/${encodeURIComponent(F.project)}/${encodeURIComponent(path)}` : projHref(F.project));
}

function openDetails(path) {
  const row = liveRow(F.project, path);
  if (!row) { toast('That file is no longer in the cloud.', 'warn'); setSheetHash(null); return; }
  closeSheet(false);
  F.sheetPath = path;
  setSheetHash(path);
  const back = document.createElement('div');
  back.className = 'fsheet-back';
  back.innerHTML = `<aside class="fsheet" role="dialog" aria-modal="true" aria-label="File details">
      <div class="fsheet-grab" aria-hidden="true"></div>
      <div class="fsheet-head"><span class="fs-badge"></span><h3 class="fs-name"></h3>
        <button class="btn icon small ghost" type="button" data-fs="close" aria-label="Close">${icon('close', 17)}</button></div>
      <div class="fs-meta"></div>
      <div class="fs-actions">
        <button class="btn small primary" type="button" data-fs="download">${icon('download', 15)} Download</button>
        <button class="btn small" type="button" data-fs="rename">${icon('edit', 15)} Rename</button>
        <button class="btn small danger" type="button" data-fs="delete">${icon('trash', 15)} Delete</button>
      </div>
      <div class="fs-preview"></div>
    </aside>`;
  back.addEventListener('click', (e) => {
    if (e.target === back) return closeSheet();
    const a = e.target.closest('[data-fs]')?.dataset.fs; if (!a) return;
    const p = F.sheetPath;
    if (a === 'close') closeSheet();
    if (a === 'download') downloadFile(F.project, p);
    if (a === 'rename') renamePath(p, false);
    if (a === 'delete') deletePath(p, false);
  });
  document.addEventListener('keydown', onSheetKey, true);
  document.body.appendChild(back);
  document.body.classList.add('sheet-open');
  refreshSheetMeta();
  renderTree();
  loadPreview(row);
  $('[data-fs=close]', back).focus({ preventScroll: true });
}

function onSheetKey(e) {
  if (e.key === 'Escape' && !document.querySelector('.modal-back, .menu-back')) { e.stopPropagation(); closeSheet(); }
}

function refreshSheetMeta() {
  const back = $('.fsheet-back'); if (!back || !F.sheetPath) return;
  const row = liveRow(F.project, F.sheetPath);
  if (!row) return;
  $('.fs-badge', back).innerHTML = fileBadge(baseName(row.path));
  $('.fs-name', back).textContent = baseName(row.path);
  $('.fs-meta', back).innerHTML = `
    <div><span>Path</span><b class="mono">${esc(row.path)}</b></div>
    <div><span>Size</span><b>${esc(fmtSize(row.size))}${Number(row.size) >= 1024 ? ` <i>(${Number(row.size).toLocaleString()} bytes)</i>` : ''}</b></div>
    <div><span>Version</span><b>${esc(row.version)}</b></div>
    <div><span>Last change</span><b>${deviceHtml(row.device_os, row.device_name, row.updated_at) || esc(timeAgo(row.updated_at))}</b></div>`;
  const shown = $('.fs-preview', back).dataset.hash;
  if (shown && shown !== row.hash) loadPreview(row);  // changed on another device
}

async function loadPreview(row) {
  const el = $('.fsheet-back .fs-preview'); if (!el) return;
  const token = ++F.previewToken;
  el.dataset.hash = row.hash;
  if (F.imgUrl) { URL.revokeObjectURL(F.imgUrl); F.imgUrl = null; }
  const size = Number(row.size);
  const isImg = IMAGE_EXT.test(row.path);
  const note = (t) => { el.innerHTML = `<div class="fs-note">${esc(t)}</div>`; };
  if (isImg && size > PREVIEW_IMG_MAX) return note(`No preview: the image is ${fmtSize(size)}. Download it to view it.`);
  if (!isImg && size > SEARCH_MAX) return note(`No preview for files over 1 MB (this one is ${fmtSize(size)}). Download it instead.`);
  if (!isImg && BINARY_EXT.test(row.path)) return note('No preview for this file type. Download it to open it.');
  if (!size) return note('This file is empty.');
  el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading preview…</div>';
  try {
    const bytes = await readRow(row);
    if (token !== F.previewToken || !el.isConnected) return;
    if (isImg) {
      const ext = row.path.split('.').pop().toLowerCase();
      const type = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : ext === 'ico' ? 'image/x-icon' : `image/${ext}`;
      F.imgUrl = URL.createObjectURL(new Blob([bytes], { type }));
      el.innerHTML = '<div class="fs-img"><img alt=""></div>';
      const img = $('img', el);
      img.alt = `Preview of ${baseName(row.path)}`;
      img.onerror = () => note('This image could not be shown.');
      img.src = F.imgUrl;
      return;
    }
    const text = decodeText(bytes);
    if (text == null) return note('This looks like a binary file, so there is no text preview.');
    const lines = text.replace(/\n$/, '').split('\n');
    const shown = lines.slice(0, PREVIEW_LINES);
    el.innerHTML = `<div class="fs-pre-head"><span>Preview · read-only</span><span>${lines.length.toLocaleString()} line${lines.length === 1 ? '' : 's'}</span></div>
      <pre class="fs-pre">${shown.map((l) => `<span class="l">${esc(l) || ' '}</span>`).join('\n')}</pre>
      ${lines.length > PREVIEW_LINES ? `<div class="fs-note">Showing the first ${PREVIEW_LINES.toLocaleString()} lines.</div>` : ''}`;
  } catch (e) {
    if (token === F.previewToken) note(`Couldn't load the preview: ${friendly(e)}`);
  }
}

function closeSheet(updateHash = true) {
  const back = $('.fsheet-back');
  F.previewToken++;
  if (F.imgUrl) { URL.revokeObjectURL(F.imgUrl); F.imgUrl = null; }
  document.removeEventListener('keydown', onSheetKey, true);
  document.body.classList.remove('sheet-open');
  if (!back) { F.sheetPath = null; return; }
  back.remove();
  F.sheetPath = null;
  if (updateHash && F.project) setSheetHash(null);
  renderTree();
}

