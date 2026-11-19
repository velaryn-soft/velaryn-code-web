// Phone app only: the Run / Terminal panel. Output from a job on your computer (see relay.js) is shown
// in a real terminal (xterm.js, loaded on first use). Typing goes back to the computer as job-in.
import { $, esc, loadMonaco, isTouch, XTERM_JS, XTERM_CSS, XTERM_FIT_JS } from './core.js?v=1795051823';
import { icon } from './icons.js?v=1795051823';
import * as Relay from './relay.js?v=1795051823';

const T = { el: null, term: null, fit: null, jobId: null, running: false, last: null, ro: null, startTimer: null, size: null };

// ---------------------------------------------------------------- xterm (UMD scripts, loaded lazily)

let xtermP = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = false;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Couldn't load ${src.split('/').pop()}`));
    document.head.appendChild(s);
  });
}
export function loadXterm() {
  if (xtermP) return xtermP;
  xtermP = (async () => {
    if (!document.querySelector(`link[href="${XTERM_CSS}"]`)) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = XTERM_CSS; document.head.appendChild(l);
    }
    // xterm's UMD wrapper registers as an AMD module when Monaco's loader is present, so let Monaco
    // finish loading, then hide `define` while xterm's scripts run (they then attach to window).
    await loadMonaco().catch(() => {});
    const define = window.define;
    window.define = undefined;
    try {
      if (!window.Terminal) await loadScript(XTERM_JS);
      if (!window.FitAddon) await loadScript(XTERM_FIT_JS);
    } finally { window.define = define; }
    const Terminal = window.Terminal;
    const FitAddon = window.FitAddon?.FitAddon || window.FitAddon;
    if (typeof Terminal !== 'function' || typeof FitAddon !== 'function') throw new Error('The terminal could not load.');
    return { Terminal, FitAddon };
  })().catch((e) => { xtermP = null; throw e; });
  return xtermP;
}

// ---------------------------------------------------------------- panel

const KEYS = [['Ctrl-C', '\x03'], ['Tab', '\t'], ['Esc', '\x1b'], ['←', '\x1b[D'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['→', '\x1b[C'], ['Ctrl-D', '\x04'], ['Ctrl-Z', '\x1a']];

function buildPanel(host) {
  const el = document.createElement('section');
  el.className = 'term-panel';
  el.setAttribute('aria-label', 'Output from your computer');
  el.innerHTML = `
    <div class="term-head">
      <span class="term-title"></span>
      <span class="term-state"></span>
      <span class="flex"></span>
      <button type="button" class="btn small" data-t="again" hidden>${icon('play', 12)} Run again</button>
      <button type="button" class="btn small danger" data-t="stop" hidden>${icon('close', 13)} Stop</button>
      <button type="button" class="btn icon small ghost" data-t="close" aria-label="Close panel">${icon('chevronDown', 18)}</button>
    </div>
    <div class="term-body"><div class="term-host"></div></div>
    <div class="term-keys">${KEYS.map(([l, s]) => `<button type="button" data-key="${esc(encodeURIComponent(s))}">${esc(l)}</button>`).join('')}</div>`;
  host.appendChild(el);
  el.addEventListener('click', (e) => {
    const k = e.target.closest('[data-key]');
    if (k) { if (T.jobId && T.running) Relay.input(T.jobId, decodeURIComponent(k.dataset.key)); T.term?.focus(); return; }
    const a = e.target.closest('[data-t]')?.dataset.t;
    if (a === 'stop') stop();
    if (a === 'close') close();
    if (a === 'again' && T.last) start(T.last.runner, T.last.job, T.last.title);
  });
  // keep the terminal focused (and the keyboard up) while tapping the key row
  $('.term-keys', el).addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  return el;
}

function setState(text, cls = '') {
  const s = $('.term-state', T.el); if (!s) return;
  s.textContent = text; s.className = `term-state ${cls}`;
  $('[data-t=stop]', T.el).hidden = !T.running;
  $('[data-t=again]', T.el).hidden = T.running || T.last?.job.type !== 'run';
}

function sizeChanged() {
  if (!T.fit || !T.term || !T.el || T.el.hidden) return;
  try { T.fit.fit(); } catch {}
  const s = `${T.term.cols}x${T.term.rows}`;
  if (s !== T.size) { T.size = s; if (T.jobId && T.running) Relay.resize(T.jobId, T.term.cols, T.term.rows); }
}

export const isOpen = () => !!(T.el && !T.el.hidden);

// Start a job (type 'run' or 'shell') on `runner` and show its output. `host` is where the panel lives.
export async function start(runner, job, title, host = T.el?.parentElement) {
  if (!T.el) T.el = buildPanel(host);
  T.el.hidden = false;
  document.body.classList.add('term-open');
  $('.term-title', T.el).innerHTML = `${icon(job.type === 'run' ? 'play' : 'terminal', 14)}<span>${esc(title)}</span><span class="on"> · ${esc(runner.name)}</span>`;
  $('.term-keys', T.el).hidden = !isTouch() && job.type === 'run';
  if (T.jobId && T.running) { Relay.kill(T.jobId); Relay.forget(T.jobId); }
  T.running = false; T.jobId = null;
  T.last = { runner, job, title };
  setState('Loading…');
  let X;
  try { X = await loadXterm(); } catch (e) { setState(e.message, 'err'); return; }
  if (!T.term) {
    T.term = new X.Terminal({
      convertEol: false, cursorBlink: true, fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace", fontSize: isTouch() ? 12 : 13,
      scrollback: 5000, allowProposedApi: false,
      theme: { background: '#070a12', foreground: '#d6dcea', cursor: '#3fc3ff', selectionBackground: '#2453b366' },
    });
    T.fit = new X.FitAddon();
    T.term.loadAddon(T.fit);
    T.term.open($('.term-host', T.el));
    T.term.onData((d) => { if (T.jobId && T.running) Relay.input(T.jobId, d); });
    T.ro = new ResizeObserver(() => sizeChanged());
    T.ro.observe($('.term-body', T.el));
  }
  T.term.reset();
  try { T.fit.fit(); } catch {}
  T.size = `${T.term.cols}x${T.term.rows}`;
  T.term.write(`\x1b[2mAsking ${runner.name}…\x1b[0m\r\n`);
  setState('Starting…');
  T.running = true;
  T.started = false;
  const jobId = T.jobId = Relay.startJob(runner, { ...job, cols: T.term.cols, rows: T.term.rows }, (event, p) => onEvent(jobId, event, p));
  setState('Starting…');
  clearTimeout(T.startTimer);
  T.startTimer = setTimeout(() => {
    if (T.jobId !== jobId || !T.running || T.started) return;
    T.term.write(`\r\n\x1b[33mNo answer from ${runner.name}. Is Velaryn Code still open there, with “Allow my other devices to run code here” on?\x1b[0m\r\n`);
    T.running = false; Relay.forget(jobId);
    setState('No answer', 'err');
  }, 20000);
  if (job.type === 'shell') T.term.focus();
}

function onEvent(jobId, event, p) {
  if (jobId !== T.jobId) return;
  if (event === 'job-started') {
    T.started = true; clearTimeout(T.startTimer);
    T.term.write(`\x1b[2m${p.command && p.command !== 'terminal' ? `$ ${p.command}` : 'Terminal'}${p.cwd ? `   (${p.cwd})` : ''}\x1b[0m\r\n`);
    setState('Running', 'run');
  } else if (event === 'job-out') {
    T.term.write(String(p.data || ''));
  } else if (event === 'job-exit') {
    T.running = false; clearTimeout(T.startTimer);
    const code = Number(p.code);
    T.term.write(`\r\n\x1b[${code === 0 ? '32' : '31'}m[exited with code ${code}]\x1b[0m\r\n`);
    setState(`Exited with code ${code}`, code === 0 ? 'ok' : 'err');
  } else if (event === 'job-error') {
    T.running = false; T.started = true; clearTimeout(T.startTimer);
    T.term.write(`\r\n\x1b[31m${String(p.message || 'Something went wrong.')}\x1b[0m\r\n`);
    setState('Error', 'err');
  }
}

export function stop() {
  if (!T.jobId || !T.running) return;
  Relay.kill(T.jobId);
  T.term?.write('\r\n\x1b[2m[stopping…]\x1b[0m\r\n');
  setState('Stopping…');
  // the computer answers with job-exit; if it never does, stop waiting
  const id = T.jobId;
  setTimeout(() => { if (T.jobId === id && T.running) { T.running = false; Relay.forget(id); setState('Stopped', 'err'); } }, 5000);
}

export function close() {
  if (T.jobId && T.running) { Relay.kill(T.jobId); Relay.forget(T.jobId); }
  T.running = false; T.jobId = null;
  clearTimeout(T.startTimer);
  if (T.el) T.el.hidden = true;
  document.body.classList.remove('term-open');
}
