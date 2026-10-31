// Claude panel for the web / phone. Phones can't run Claude Code, so this calls the Anthropic API
// directly from the browser with the user's own API key (stored only on this device).
// Claude gets client-side tools over the open project; edits land in the editor as unsaved changes
// with a diff card and Accept / Undo, like "Ask before edits" on the desktop.
import { $, $$, esc, toast, modal, settings, setSetting, on, isTouch, fmtSize, friendly } from './core.js?v=1793470528';
import { icon, fileBadge, claudeLogo } from './icons.js?v=1793470528';
import { claudeKey, claudeKeyHtml, bindClaudeKey, CLAUDE_MODELS } from './account.js?v=1793470528';

// Official TypeScript SDK as an ES module, pinned to an exact version.
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
let sdkP = null;
function loadSdk() {
  if (!sdkP) sdkP = import(SDK_URL).then((m) => m.default || m.Anthropic).catch((e) => { sdkP = null; throw e; });
  return sdkP;
}

const CL = {
  api: null, el: null, messages: [], busy: false, stream: null, stopped: false,
  includeContext: true, proposals: [],
};

export const ready = () => !!claudeKey();

// ---------------------------------------------------------------- tools

const TOOLS = [
  {
    name: 'list_files',
    description: 'List every file in the open project with its size. Files with unsaved edits in the editor are marked.',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_file',
    description: 'Read a text file from the project. Returns the editor\'s current text, including unsaved edits. Paths are relative to the project root, e.g. "src/app.js".',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Project-relative file path' } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'search',
    description: 'Search all text files in the project. Returns matching lines as "path:line: text" (up to 300 matches).',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to find (or a JavaScript regular expression when regex is true)' },
        regex: { type: 'boolean', description: 'Treat query as a regular expression' },
        case_sensitive: { type: 'boolean' },
      },
      required: ['query'], additionalProperties: false,
    },
  },
  {
    name: 'propose_edit',
    description: 'Change an existing file by giving its complete new content. The change is applied in the user\'s editor as an unsaved edit and shown as a diff; the user reviews it and saves. Read the file first and keep everything you do not intend to change exactly as it was.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Project-relative path of an existing file' }, new_content: { type: 'string', description: 'The complete new file content' } },
      required: ['path', 'new_content'], additionalProperties: false,
    },
  },
  {
    name: 'create_file',
    description: 'Create a new file with the given content. It opens in the user\'s editor as an unsaved file; the user reviews and saves it.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Project-relative path for the new file' }, content: { type: 'string' } },
      required: ['path', 'content'], additionalProperties: false,
    },
  },
];

// Eager input streaming means the API no longer validates tool input, so check it here.
function validateInput(name, input) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return `Unknown tool ${name}`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Input must be an object';
  const props = tool.input_schema.properties;
  for (const k of tool.input_schema.required || []) if (!(k in input)) return `Missing "${k}"`;
  for (const [k, v] of Object.entries(input)) {
    if (!(k in props)) return `Unexpected field "${k}"`;
    if (typeof v !== props[k].type) return `"${k}" must be a ${props[k].type}`;
  }
  if ('path' in input) {
    const p = input.path.trim();
    if (!p || p.startsWith('/') || p.split(/[\\/]/).some((s) => s === '..')) return `"${input.path}" is not a valid project-relative path`;
  }
  return null;
}

function systemPrompt() {
  return `You are Claude, working inside Velaryn Code, a code editor running in a web browser (often on a phone). The user has the cloud project "${CL.api.projectLabel()}" open.

You cannot run commands, a terminal, or tests here. You work with the project's files through tools:
- list_files, read_file and search to explore the project.
- propose_edit to change an existing file (send the complete new file content) and create_file to add a new file.

Edits are not saved automatically: each one appears in the user's editor as an unsaved change with a diff, and the user reviews it, then accepts and saves it. Read a file before you edit it, keep changes focused, and say briefly what you changed.

Messages may start with <editor_context> describing the file and selection the user has open; use it to resolve "this file" or "this code". The user may be on a small screen, so keep replies concise and code blocks short.`;
}

async function runTool(tu, card) {
  const err = validateInput(tu.name, tu.input);
  if (err) {
    card.fail(`Invalid input: ${err}`);
    return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: JSON.stringify({ INVALID_JSON: JSON.stringify(tu.input), error: err }) };
  }
  const input = tu.input;
  try {
    let out = '';
    if (tu.name === 'list_files') {
      const list = CL.api.listFiles();
      out = list.length ? list.map((f) => `${f.path} (${fmtSize(f.size)})${f.unsaved ? ' [unsaved edits]' : ''}`).join('\n') : '(the project is empty)';
      card.done(`${list.length} file${list.length === 1 ? '' : 's'}`);
    } else if (tu.name === 'read_file') {
      out = await CL.api.readFile(input.path);
      card.done(`${out.split('\n').length} lines`);
    } else if (tu.name === 'search') {
      const r = await CL.api.search(input.query, { regex: !!input.regex, case: !!input.case_sensitive });
      const lines = [];
      for (const f of r.files) for (const m of f.matches) lines.push(`${f.path}:${m.line}: ${m.text.trim().slice(0, 240)}`);
      out = lines.length ? lines.join('\n') + (r.truncated ? '\n(more matches not shown)' : '') : 'No matches.';
      if (r.skipped) out += `\n(${r.skipped} binary or large files were skipped)`;
      card.done(`${r.total}${r.truncated ? '+' : ''} match${r.total === 1 ? '' : 'es'}`);
    } else if (tu.name === 'propose_edit' || tu.name === 'create_file') {
      const create = tu.name === 'create_file';
      const res = await CL.api.applyEdit(input.path, create ? input.content : input.new_content, { create });
      card.proposal(input.path, res);
      out = res.before === res.after && !create
        ? 'The new content is identical to the current file; nothing changed.'
        : `${create ? 'Created' : 'Applied'} in the editor as an unsaved change. The user will review the diff and save it.`;
    }
    return { type: 'tool_result', tool_use_id: tu.id, content: out || '(empty)' };
  } catch (e) {
    card.fail(friendly(e));
    return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: friendly(e) };
  }
}

// After a mid-output fallback, blocks before the last fallback marker that only the declined model
// produced (thinking, tool calls) must not be echoed back; the marker itself is dropped too.
function sanitizeContent(content) {
  const last = content.map((b) => b.type).lastIndexOf('fallback');
  if (last < 0) return content;
  return content.filter((b, i) => {
    if (b.type === 'fallback') return false;
    if (i > last) return true;
    return !['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use'].includes(b.type);
  });
}

// ---------------------------------------------------------------- diff

function lineDiff(aText, bText) {
  const a = aText.split('\n'), b = bText.split('\n');
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const A = a.slice(s, ea), B = b.slice(s, eb);
  const mid = [];
  const n = A.length, m = B.length;
  if (n && m && n * m <= 2_000_000) {
    const w = m + 1, dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { mid.push([' ', A[i]]); i++; j++; } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) mid.push(['-', A[i++]]); else mid.push(['+', B[j++]]);
    }
    while (i < n) mid.push(['-', A[i++]]);
    while (j < m) mid.push(['+', B[j++]]);
  } else { for (const l of A) mid.push(['-', l]); for (const l of B) mid.push(['+', l]); }
  const ops = [...a.slice(0, s).map((l) => [' ', l]), ...mid, ...a.slice(ea).map((l) => [' ', l])];
  return ops;
}

function diffHtml(before, after, created) {
  if (created) {
    const lines = after.split('\n');
    return { html: lines.slice(0, 400).map((l) => `<div class="add">${esc(l) || ' '}</div>`).join('') + (lines.length > 400 ? `<div class="gap">… ${lines.length - 400} more lines</div>` : ''), add: lines.length, del: 0 };
  }
  const ops = lineDiff(before, after);
  let add = 0, del = 0;
  const keep = new Uint8Array(ops.length);
  ops.forEach(([k], i) => { if (k !== ' ') { k === '+' ? add++ : del++; for (let d = -2; d <= 2; d++) if (ops[i + d]) keep[i + d] = 1; } });
  const out = [];
  let skipped = 0, shown = 0;
  ops.forEach(([k, l], i) => {
    if (!keep[i]) { skipped++; return; }
    if (skipped) { out.push(`<div class="gap">⋯ ${skipped} unchanged line${skipped === 1 ? '' : 's'}</div>`); skipped = 0; }
    if (shown++ < 600) out.push(`<div class="${k === '+' ? 'add' : k === '-' ? 'del' : 'ctx'}">${esc(l) || ' '}</div>`);
  });
  if (skipped) out.push(`<div class="gap">⋯ ${skipped} unchanged line${skipped === 1 ? '' : 's'}</div>`);
  if (shown > 600) out.push(`<div class="gap">… diff truncated</div>`);
  return { html: out.join('') || '<div class="gap">No changes</div>', add, del };
}

// ---------------------------------------------------------------- markdown (escape first, then format)

function md(src) {
  const blocks = [];
  let text = String(src || '').replace(/```([\w+-]*)\n?([\s\S]*?)(```|$)/g, (_m, lang, code) => {
    blocks.push({ lang, code: code.replace(/\n$/, '') });
    return `\u0000${blocks.length - 1}\u0000`;
  });
  text = esc(text)
    .replace(/^### (.*)$/gm, '<h4>$1</h4>').replace(/^## (.*)$/gm, '<h3>$1</h3>').replace(/^# (.*)$/gm, '<h3>$1</h3>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^(\s*)[-*] (.*)$/gm, '$1<li>$2</li>')
    .replace(/^(\s*)\d+\. (.*)$/gm, '$1<li class="ol">$2</li>')
    .replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, (m) => (m.includes('class="ol"') ? `<ol>${m}</ol>` : `<ul>${m}</ul>`))
    .split(/\n{2,}/).map((p) => (/^\s*<(h\d|ul|ol)|\u0000/.test(p) ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`)).join('');
  return text.replace(/\u0000(\d+)\u0000/g, (_m, i) => {
    const b = blocks[+i];
    return `<div class="cl-code"><div class="cl-code-head"><span>${esc(b.lang || 'code')}</span>
      <span><button type="button" data-copy="${i}">Copy</button><button type="button" data-insert="${i}">Insert</button></span></div><pre>${esc(b.code)}</pre></div>`;
  }).replace(/data-copy="(\d+)"/g, (_m, i) => `data-copy="${encodeURIComponent(blocks[+i].code)}"`)
    .replace(/data-insert="(\d+)"/g, (_m, i) => `data-insert="${encodeURIComponent(blocks[+i].code)}"`);
}

// ---------------------------------------------------------------- panel

export function init(api, el) {
  CL.api = api; CL.el = el;
  CL.messages = []; CL.proposals = [];
  if (!CL.wired) {
    CL.wired = true;
    on('claude-key', () => render());
    on('settings', (_s, patch) => { if ('claudeModel' in patch && CL.el) { const s = $('.cl-model', CL.el); if (s) s.value = settings().claudeModel; } });
  }
  render();
}

export function reset() {
  stop();
  CL.messages = []; CL.proposals = [];
  if (CL.el) render();
}

function render() {
  const el = CL.el; if (!el) return;
  const key = ready();
  el.innerHTML = `
    <div class="cl-head">
      <span class="cl-title">${claudeLogo(18)}<b>Claude</b></span>
      <select class="cl-model" aria-label="Model">${CLAUDE_MODELS.map(([v, l]) => `<option value="${v}" ${settings().claudeModel === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="cl-head-actions">
        <button type="button" class="btn icon small ghost" data-cl="new" title="New conversation" aria-label="New conversation">${icon('plus', 17)}</button>
        <button type="button" class="btn icon small ghost" data-cl="close" title="Close" aria-label="Close Claude">${icon('close', 16)}</button>
      </span>
    </div>
    <div class="cl-msgs"></div>
    <div class="cl-status" hidden><span class="spin">${icon('sync', 13)}</span><span class="t">Thinking…</span></div>
    <div class="cl-compose" ${key ? '' : 'hidden'}>
      <div class="cl-context"></div>
      <textarea class="cl-input" rows="1" placeholder="Ask Claude about your code…" enterkeyhint="${isTouch() ? 'enter' : 'send'}"></textarea>
      <div class="cl-bar">
        <button type="button" class="cl-pill" data-cl="fix" hidden>✨ Fix problems</button>
        <button type="button" class="cl-pill" data-cl="paste">Paste an error</button>
        <span class="flex"></span>
        <button type="button" class="btn small primary cl-send" data-cl="send">Send ${icon('play', 11)}</button>
      </div>
    </div>`;
  $('.cl-model', el).addEventListener('change', (e) => setSetting({ claudeModel: e.target.value }));
  el.onclick = onClick;
  const input = $('.cl-input', el);
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isTouch()) { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && CL.busy) stop();
  });
  if (!key) setupCard(); else emptyState();
  renderChip();
  setBusy(CL.busy);
}

function setupCard() {
  const msgs = $('.cl-msgs', CL.el);
  msgs.innerHTML = `<div class="cl-setup">
    <div class="cl-hello">${claudeLogo(28)}<b>Claude on this device</b></div>
    <p>Ask Claude to explain, write, fix or refactor code in this project. It reads your files and proposes edits you review before saving.</p>
    <div class="set-card">${claudeKeyHtml()}</div>
  </div>`;
  bindClaudeKey(msgs, () => render());
}

function emptyState() {
  const msgs = $('.cl-msgs', CL.el);
  if (CL.messages.length) return;
  msgs.innerHTML = `<div class="cl-empty">
    <div class="cl-hello">${claudeLogo(26)}<b>Claude</b></div>
    <p>Ask Claude to write, explain, refactor, or fix code. It can read and search this project and propose edits. Nothing is saved until you review and save it.</p>
    <div class="cl-suggest">
      <button type="button" data-suggest="Explain what this file does.">Explain this file</button>
      <button type="button" data-suggest="Find and fix any bugs in this file.">Find bugs in this file</button>
      <button type="button" data-cl="fixfile">✨ Fix problems in this file</button>
      <button type="button" data-cl="paste">Paste an error to fix</button>
      <button type="button" data-suggest="Give me a quick overview of this project: what it is and how it's organised.">Explain this project</button>
    </div></div>`;
}

export function onShow() {
  if (!CL.el) return;
  renderChip();
  if (!isTouch()) {
    setTimeout(() => {
      // don't steal focus from something the user opened meanwhile (quick open, a dialog…)
      const a = document.activeElement;
      if (a && a !== document.body && !CL.el.contains(a) && !a.closest?.('.monaco-editor')) return;
      $('.cl-input', CL.el)?.focus();
    }, 50);
  }
}

let chipTimer;
export function onContext() { clearTimeout(chipTimer); chipTimer = setTimeout(renderChip, 120); }

function renderChip() {
  const el = CL.el && $('.cl-context', CL.el); if (!el) return;
  const c = CL.api?.context();
  if (!c) { el.innerHTML = ''; } else {
    const lines = c.start ? ` · ${c.start === c.end ? `line ${c.start}` : `lines ${c.start}-${c.end}`}` : '';
    el.innerHTML = `<button type="button" class="cl-chip ${CL.includeContext ? 'on' : ''}" data-cl="chip" title="Claude sees the file you're in (and your selection). Tap to turn off.">${fileBadge(c.path.split('/').pop())}${esc(c.path.split('/').pop())}${lines}${CL.includeContext ? '' : ' (off)'}</button>`;
  }
  const fix = $('[data-cl=fix]', CL.el);
  const n = CL.api?.problems()?.length || 0;
  if (fix) { fix.hidden = !n; fix.textContent = `✨ Fix ${n} problem${n === 1 ? '' : 's'}`; }
}

function editorContext() {
  if (!CL.includeContext) return '';
  const c = CL.api.context();
  if (!c) return '';
  if (c.start) return `<editor_context>The user is in ${c.path} and has selected lines ${c.start}-${c.end}:\n\`\`\`\n${c.text.slice(0, 20000)}\n\`\`\`</editor_context>\n\n`;
  return `<editor_context>The user has ${c.path} open (cursor on line ${c.line}).</editor_context>\n\n`;
}

function autosize() {
  const i = $('.cl-input', CL.el); if (!i) return;
  i.style.height = 'auto';
  i.style.height = `${Math.min(180, i.scrollHeight)}px`;
}

function onClick(e) {
  const a = e.target.closest('[data-cl]')?.dataset.cl;
  if (a === 'send') return CL.busy ? stop() : submit();
  if (a === 'new') return reset();
  if (a === 'close') return CL.api.close();
  if (a === 'chip') { CL.includeContext = !CL.includeContext; return renderChip(); }
  if (a === 'paste') return pasteError();
  if (a === 'fix' || a === 'fixfile') { const p = CL.api.activePath(); if (!p) return toast('Open a file first.', 'warn'); return fixMarkers(p, CL.api.problems()); }
  const s = e.target.closest('[data-suggest]');
  if (s) return send(s.dataset.suggest);
  const c = e.target.closest('[data-copy]');
  if (c) { navigator.clipboard?.writeText(decodeURIComponent(c.dataset.copy)).then(() => { c.textContent = 'Copied'; }).catch(() => {}); return; }
  const ins = e.target.closest('[data-insert]');
  if (ins) return CL.api.insert(decodeURIComponent(ins.dataset.insert));
  const op = e.target.closest('[data-open]');
  if (op) return CL.api.open(op.dataset.open);
}

function submit() {
  const input = $('.cl-input', CL.el);
  const text = input.value;
  if (!text.trim()) return;
  input.value = '';
  autosize();
  send(text);
}

export function prefill(text) {
  const input = CL.el && $('.cl-input', CL.el); if (!input) return;
  input.value = text; autosize();
  input.focus();
  input.setSelectionRange(text.length, text.length);
}

function scrollChat(force = false) {
  const m = $('.cl-msgs', CL.el); if (!m) return;
  if (force || m.scrollHeight - m.scrollTop - m.clientHeight < 160 || CL.busy) m.scrollTop = m.scrollHeight;
}

function addMsg(cls, html) {
  const msgs = $('.cl-msgs', CL.el);
  $('.cl-empty', msgs)?.remove();
  const el = document.createElement('div');
  el.className = `cl-msg ${cls}`;
  el.innerHTML = html;
  msgs.appendChild(el);
  scrollChat();
  return el;
}
const addMeta = (t) => addMsg('meta', esc(t));
const addError = (t) => addMsg('error', esc(t));

function setBusy(b, label = 'Thinking…') {
  CL.busy = b;
  if (!CL.el) return;
  const btn = $('.cl-send', CL.el);
  if (btn) { btn.innerHTML = b ? `${icon('close', 13)} Stop` : `Send ${icon('play', 11)}`; btn.classList.toggle('stop', b); }
  const st = $('.cl-status', CL.el);
  if (st) { st.hidden = !b; $('.t', st).textContent = label; }
}
const status = (t) => { const st = CL.el && $('.cl-status .t', CL.el); if (st) st.textContent = t; };

function stop() {
  CL.stopped = true;
  try { CL.stream?.abort(); } catch {}
}

// ---------------------------------------------------------------- tool cards

const TOOL_LABEL = {
  list_files: () => ['files', 'List files'],
  read_file: (i) => ['files', `Read <b data-open="${esc(i.path || '')}">${esc(i.path || '…')}</b>`],
  search: (i) => ['search', `Search for <code>${esc(i.query || '…')}</code>`],
  propose_edit: (i) => ['edit', `Edit <b data-open="${esc(i.path || '')}">${esc(i.path || '…')}</b>`],
  create_file: (i) => ['newFile', `Create <b data-open="${esc(i.path || '')}">${esc(i.path || '…')}</b>`],
};

function toolCard(name) {
  const el = addMsg('tool', `<div class="cl-tool-head"><span class="ti">${icon('spark', 14)}</span><span class="lbl">${esc(name)}</span><span class="st spin">${icon('sync', 12)}</span></div><div class="cl-tool-body"></div>`);
  const head = (input) => {
    const [ic, label] = (TOOL_LABEL[name] || (() => ['spark', esc(name)]))(input || {});
    $('.ti', el).innerHTML = icon(ic, 14);
    $('.lbl', el).innerHTML = label;
  };
  head({});
  const st = (html) => { const s = $('.st', el); s.classList.remove('spin'); s.innerHTML = html; };
  return {
    el,
    streaming(partial) {
      const m = /"path"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(partial);
      const q = /"query"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(partial);
      head({ path: m ? m[1] : undefined, query: q ? q[1] : undefined });
      if (/content/.test(partial)) $('.st', el).title = `Writing… ${partial.length.toLocaleString()} characters`;
    },
    input(input) { head(input); },
    done(note) { st(`<span class="ok">${icon('check', 13)}</span>${note ? `<span class="note">${esc(note)}</span>` : ''}`); },
    fail(msg) { st(`<span class="bad">${icon('error', 13)}</span>`); $('.cl-tool-body', el).innerHTML = `<div class="cl-out"><pre>${esc(msg)}</pre></div>`; },
    proposal(path, res) {
      const { html, add, del } = diffHtml(res.before, res.after, res.created);
      st(`<span class="stat"><span class="a">+${add}</span> <span class="d">−${del}</span></span>`);
      const p = { path, ...res, el, state: 'pending' };
      for (const old of CL.proposals) if (old.path === path && old.state === 'pending') { old.state = 'superseded'; paintProposal(old); }
      CL.proposals.push(p);
      $('.cl-tool-body', el).innerHTML = `<div class="cl-diff">${html}</div><div class="cl-perm-actions"></div>`;
      paintProposal(p);
    },
  };
}

function paintProposal(p) {
  const bar = $('.cl-perm-actions', p.el); if (!bar) return;
  const unsaved = CL.api.isDirty(p.path);
  if (p.state === 'pending') {
    bar.innerHTML = `<span class="faint">Unsaved change in the editor</span><span class="flex"></span>
      <button type="button" class="btn small" data-pp="undo">Undo</button>
      <button type="button" class="btn small" data-pp="view">View</button>
      <button type="button" class="btn small primary" data-pp="accept">Accept</button>`;
  } else if (p.state === 'accepted') {
    bar.innerHTML = `<span class="faint">${icon('check', 13)} Accepted${unsaved ? ', not saved yet' : ' and saved'}</span><span class="flex"></span>
      ${unsaved ? '<button type="button" class="btn small primary" data-pp="save">Save</button>' : ''}`;
  } else if (p.state === 'undone') bar.innerHTML = '<span class="faint">Undone</span>';
  else if (p.state === 'superseded') bar.innerHTML = '<span class="faint">Replaced by a newer edit below</span>';
  bar.onclick = async (e) => {
    const a = e.target.closest('[data-pp]')?.dataset.pp; if (!a) return;
    if (a === 'view') return CL.api.open(p.path);
    if (a === 'accept') { p.state = 'accepted'; paintProposal(p); return; }
    if (a === 'save') { await CL.api.save(p.path); paintProposal(p); return; }
    if (a === 'undo') { await CL.api.revertEdit(p.path, p.before, { created: p.created }); p.state = 'undone'; paintProposal(p); }
  };
}

// ---------------------------------------------------------------- the agent loop

export async function send(text, { label = '', context = true } = {}) {
  text = (text || '').trim();
  if (!text) return;
  if (!ready()) return render();
  if (CL.busy) return toast('Claude is still working. Stop it first or wait for it to finish.', 'warn');
  addMsg('user', `<div class="cl-user">${esc(label || text)}</div>`);
  scrollChat(true);
  CL.messages.push({ role: 'user', content: (context ? editorContext() : '') + text });
  await runLoop();
}

async function runLoop() {
  CL.stopped = false;
  setBusy(true);
  let Anthropic;
  try { Anthropic = await loadSdk(); } catch (e) {
    setBusy(false);
    return addError(`Couldn't load the Claude SDK. Check your connection and try again. (${friendly(e)})`);
  }
  const client = new Anthropic({ apiKey: claudeKey(), dangerouslyAllowBrowser: true });
  let jsonRetries = 0;
  try {
    for (let turn = 0; turn < 40; turn++) {
      const model = settings().claudeModel || 'claude-opus-5-5';
      const params = {
        model, max_tokens: 64000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        cache_control: { type: 'ephemeral' },
        system: systemPrompt(), tools: TOOLS, messages: CL.messages,
      };
      // Opus 5.5 and Sonnet 5.5: let the API retry a policy decline on its recommended fallback model.
      const withFallback = model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5';
      const stream = withFallback
        ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : client.messages.stream(params);
      CL.stream = stream;
      status('Thinking…');
      const view = new TurnView();
      let message;
      try {
        for await (const ev of stream) view.event(ev);
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        view.abandon();
        // Only a tool input that could not be parsed is retried; API errors (incl. aborts) are rethrown.
        if (err instanceof Anthropic.APIError || CL.stopped || jsonRetries++ >= 2) throw err;
        addMeta('A tool call came back garbled. Asking Claude again…');
        continue;
      }
      view.finish(message);
      if (message.stop_reason === 'refusal') {
        const d = message.stop_details;
        addError(`Claude declined this request${d?.explanation ? `: ${d.explanation}` : '.'} Try rephrasing it${withFallback ? '' : ' or pick another model'}.`);
        break;
      }
      const content = sanitizeContent(message.content);
      if (message.stop_reason === 'pause_turn') { CL.messages.push({ role: 'assistant', content }); continue; }
      const toolUses = content.filter((b) => b.type === 'tool_use');
      if (!toolUses.length) {
        CL.messages.push({ role: 'assistant', content });
        if (message.stop_reason === 'max_tokens') addMeta('The reply hit the length limit and was cut off.');
        break;
      }
      if (message.stop_reason === 'max_tokens') {
        // A truncated tool input can still look valid, so never run it.
        addError('Claude ran out of room while writing a tool call, so it was not applied. Ask again, perhaps for a smaller change.');
        for (const tu of toolUses) view.cards.get(tu.id)?.fail('Cut off before it finished');
        break;
      }
      CL.messages.push({ role: 'assistant', content });
      status('Working…');
      const results = [];
      for (const tu of toolUses) {
        const card = view.cards.get(tu.id) || toolCard(tu.name);
        card.input(tu.input);
        results.push(await runTool(tu, card));
      }
      CL.messages.push({ role: 'user', content: results });
      if (CL.stopped) { addMeta('Stopped'); break; }
    }
  } catch (err) {
    showError(Anthropic, err);
  } finally {
    CL.stream = null;
    setBusy(false);
    renderChip();
  }
}

function showError(Anthropic, err) {
  const model = settings().claudeModel;
  if (err instanceof Anthropic.APIUserAbortError || CL.stopped) return addMeta('Stopped');
  if (err instanceof Anthropic.AuthenticationError) return addError('Anthropic rejected the API key. Check it in Settings → Claude.');
  if (err instanceof Anthropic.PermissionDeniedError) return addError(`This API key isn't allowed to use ${model}. Pick another model or check your Anthropic account.`);
  if (err instanceof Anthropic.NotFoundError) return addError(`The model ${model} isn't available for this API key. Pick another model.`);
  if (err instanceof Anthropic.RateLimitError) return addError('Rate limited by Anthropic. Wait a moment and try again.');
  if (err instanceof Anthropic.BadRequestError) return addError(`Anthropic couldn't process the request: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionError) return addError('Couldn\'t reach Anthropic. Check your connection and try again.');
  if (err instanceof Anthropic.APIError) return addError(`Anthropic error${err.status ? ` ${err.status}` : ''}: ${err.message}`);
  return addError(friendly(err));
}

// Renders one streamed assistant turn: text bubbles, tool cards, thinking status.
class TurnView {
  constructor() { this.blocks = new Map(); this.cards = new Map(); this.raf = 0; }
  event(ev) {
    if (ev.type === 'content_block_start') {
      const b = ev.content_block;
      if (b.type === 'text') this.blocks.set(ev.index, { type: 'text', text: b.text || '', el: addMsg('assistant', '') });
      else if (b.type === 'tool_use') {
        const card = toolCard(b.name);
        this.cards.set(b.id, card);
        this.blocks.set(ev.index, { type: 'tool_use', card, partial: '' });
        status('Working…');
      } else if (b.type === 'thinking' || b.type === 'redacted_thinking') status('Thinking…');
      else if (b.type === 'fallback') addMeta(`${b.from?.model || 'The model'} declined; ${b.to?.model || 'a fallback model'} continued.`);
    } else if (ev.type === 'content_block_delta') {
      const blk = this.blocks.get(ev.index); if (!blk) return;
      if (ev.delta.type === 'text_delta') { blk.text += ev.delta.text; status('Writing…'); this.paint(); }
      else if (ev.delta.type === 'input_json_delta') { blk.partial += ev.delta.partial_json; blk.card.streaming(blk.partial); }
    }
  }
  paint() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      for (const b of this.blocks.values()) if (b.type === 'text' && b.el.isConnected) b.el.innerHTML = md(b.text);
      scrollChat();
    });
  }
  finish(message) {
    cancelAnimationFrame(this.raf); this.raf = 0;
    message.content.forEach((b, i) => {
      const blk = this.blocks.get(i);
      if (b.type === 'text' && blk?.el) { if (b.text.trim()) blk.el.innerHTML = md(b.text); else blk.el.remove(); }
    });
    scrollChat();
  }
  abandon() {
    cancelAnimationFrame(this.raf);
    for (const b of this.blocks.values()) {
      if (b.type === 'text' && b.el && !b.text.trim()) b.el.remove();
      if (b.type === 'tool_use') b.card.fail('Interrupted');
    }
  }
}

// ---------------------------------------------------------------- fixing

const markerText = (m) => `line ${m.startLineNumber}:${m.startColumn}: ${m.message}${m.source ? ` (${m.source})` : ''}`;

export function fixMarkers(path, markers = []) {
  if (!ready()) return render();
  if (!markers.length) {
    return send(`Look over ${path} for bugs or syntax errors and fix anything that is clearly wrong. Keep changes minimal.`,
      { label: `Check ${path.split('/').pop()} for bugs and fix them` });
  }
  const list = markers.map((m) => `- ${markerText(m)}`).join('\n');
  return send(
    `Fix ${markers.length === 1 ? 'this problem' : 'these problems'} in ${path}:\n${list}\n\nMake the smallest change that fixes ${markers.length === 1 ? 'it' : 'them'}. If something is ambiguous, pick the most likely intended code. Then say in one sentence what you changed.`,
    { context: false, label: `✨ Fix ${markers.length} problem${markers.length > 1 ? 's' : ''} in ${path.split('/').pop()}:\n${list}` },
  );
}

export async function pasteError() {
  if (!ready()) return render();
  let clip = '';
  try { clip = await navigator.clipboard.readText(); } catch {}
  const v = await modal({
    title: 'Fix an error with Claude',
    text: 'Paste an error from your terminal, browser console, or build output. Claude finds the cause in this project and proposes a fix.',
    input: { type: 'textarea', rows: 8, placeholder: "TypeError: Cannot read properties of undefined (reading 'map')\n    at App (src/App.jsx:12:18)",
      value: clip && /error|exception|traceback|failed|warning|at .+:\d+/i.test(clip) ? clip : '' },
    actions: [{ label: 'Cancel', value: null }, { label: '✨ Fix it', primary: true }],
  });
  if (!v) return;
  send(
    `I got this error:\n\`\`\`\n${v.slice(-12000)}\n\`\`\`\nFind the cause in this project and fix it. Make the smallest correct change, then tell me briefly what was wrong and what you changed.`,
    { label: `Fix this error:\n${v.split('\n').slice(0, 6).join('\n')}${v.split('\n').length > 6 ? '\n…' : ''}` },
  );
}
