// Phone app only: talk to your own computers over the private Realtime channel "relay:<user id>:<secret>"
// (see main/relay.js on the desktop and supabase/003_device_relay.sql). Computers that allow it
// announce themselves with presence ({ kind: 'runner', deviceId, name, os, claude, projects, at });
// the phone sends jobs (run a file, a shell, a Claude message) and gets output back as broadcasts.
import { S, DEVICE, uuid, emit, menu, esc, glyphFor } from './core.js?v=1795051823';

const R = {
  channel: null, uid: null, state: 'off', detail: '', runners: [], jobs: new Map(), authSub: null, retry: null,
};

export const MSG_NO_COMPUTER = 'Open Velaryn Code on your computer and turn on Settings → Cloud → Allow my other devices to run code here.';
export const MSG_UPGRADE = 'Your cloud needs the upgrade in Velaryn Code on your computer: Settings → Cloud → Upgrade Cloud.';

export const relayState = () => ({ state: R.state, detail: R.detail });
export const runners = () => R.runners;
export const claudeRunners = () => R.runners.filter((r) => r.claude);

// A plain sentence explaining why nothing can run right now (or '' when a computer is online).
export function problem() {
  if (R.state === 'upgrade') return MSG_UPGRADE;
  if (R.state === 'error') return `Couldn't reach your computers (${R.detail || 'connection problem'}). Check your connection and try again. ${MSG_NO_COMPUTER}`;
  if (R.state === 'connecting' || R.state === 'off') return `Looking for your computers… ${MSG_NO_COMPUTER}`;
  if (!R.runners.length) return MSG_NO_COMPUTER;
  return '';
}

function changed() { emit('relay'); }

function readRunners() {
  const by = new Map();
  let state = {};
  try { state = R.channel?.presenceState?.() || {}; } catch {}
  for (const metas of Object.values(state)) {
    for (const m of metas || []) {
      if (m?.kind !== 'runner' || !m.deviceId) continue;
      const prev = by.get(m.deviceId);
      if (!prev || (m.at || 0) > (prev.at || 0)) by.set(m.deviceId, { ...m, projects: Array.isArray(m.projects) ? m.projects : [] });
    }
  }
  R.runners = [...by.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  changed();
}

async function setAuth(token) {
  try {
    if (!token) token = (await S.client.auth.getSession())?.data?.session?.access_token;
    if (token) await S.client.realtime.setAuth(token);
  } catch {}
}

function dispatch(event, payload) {
  const j = payload?.jobId && R.jobs.get(payload.jobId);
  if (!j) return;
  try { j.on(event, payload); } catch (e) { console.error(e); }
  if (event === 'job-exit' || event === 'job-error') R.jobs.delete(payload.jobId);
}

// Join the channel (idempotent). Private channels need the user's token before subscribing.
export async function connect() {
  if (!S.client || !S.user) return;
  if (R.channel && R.uid === S.user.id && (R.state === 'ok' || R.state === 'connecting')) return;
  disconnect(false);
  R.uid = S.user.id;
  R.state = 'connecting'; R.detail = ''; changed();
  if (!R.authSub) {
    const { data } = S.client.auth.onAuthStateChange((event, sess) => {
      if (event === 'TOKEN_REFRESHED' && sess?.access_token) setTimeout(() => setAuth(sess.access_token), 0);
      if (event === 'SIGNED_OUT') setTimeout(() => disconnect(), 0);
    });
    R.authSub = data?.subscription || null;
  }
  await setAuth();
  // The channel name includes a random secret from the account's profile. A computer creates it
  // when "Allow my other devices to run code here" is turned on; until then there's nothing to join.
  const { data: fresh } = await S.client.auth.getUser().catch(() => ({ data: null }));
  const secret = fresh?.user?.user_metadata?.relay_secret;
  if (!secret) { R.state = 'off'; R.detail = ''; changed(); return; }
  let ch;
  try {
    ch = S.client.channel(`relay:${S.user.id}:${secret}`, { config: { private: true, broadcast: { self: false } } });
    ch.on('presence', { event: 'sync' }, readRunners);
    ch.on('presence', { event: 'join' }, readRunners);
    ch.on('presence', { event: 'leave' }, readRunners);
    for (const ev of ['job-started', 'job-out', 'job-exit', 'job-error', 'job-claude']) {
      ch.on('broadcast', { event: ev }, (msg) => dispatch(ev, msg?.payload));
    }
    R.channel = ch;
    ch.subscribe((status, err) => {
      if (R.channel !== ch) return;
      const why = String(err?.message || err || '');
      if (status === 'SUBSCRIBED') { R.state = 'ok'; R.detail = ''; readRunners(); return; }
      if (status === 'CHANNEL_ERROR') {
        // An authorization failure on the private topic means the relay policy isn't installed yet.
        // (CHANNEL_ERROR on this private topic means the cloud lacks upgrade 3, unless it's clearly a network failure.)
        R.state = /timeout|timed out|network|socket|connection|offline|failed to fetch/i.test(why) ? 'error' : 'upgrade';
        R.detail = why;
      } else if (status === 'TIMED_OUT') { R.state = 'error'; R.detail = 'timed out'; }
      else if (status === 'CLOSED') { R.state = 'off'; }
      R.runners = [];
      changed();
      if (R.state === 'error') { clearTimeout(R.retry); R.retry = setTimeout(() => connect(), 15000); }
    });
  } catch (e) {
    R.channel = null; R.state = 'error'; R.detail = e.message; changed();
  }
}

export function disconnect(notify = true) {
  clearTimeout(R.retry);
  for (const [jobId] of R.jobs) send('job-kill', { jobId });
  R.jobs.clear();
  if (R.channel) { try { S.client?.removeChannel(R.channel); } catch {} }
  R.channel = null; R.uid = null; R.runners = [];
  R.state = 'off';
  if (notify) changed();
}

function send(event, payload) {
  if (!R.channel) return Promise.resolve();
  return Promise.resolve(R.channel.send({ type: 'broadcast', event, payload })).catch(() => {});
}

// Start a job on a computer. on(event, payload) gets job-started / job-out / job-exit / job-error / job-claude.
export function startJob(runner, job, on) {
  const jobId = uuid();
  R.jobs.set(jobId, { on, runner });
  send('job', { jobId, to: runner.deviceId, from: DEVICE.id, fromName: DEVICE.name, ...job });
  return jobId;
}
export const input = (jobId, data) => send('job-in', { jobId, data });
export const resize = (jobId, cols, rows) => send('job-resize', { jobId, cols, rows });
export const perm = (jobId, id, decision) => send('job-perm', { jobId, id, decision });
export function kill(jobId) { send('job-kill', { jobId }); }
export const forget = (jobId) => R.jobs.delete(jobId);

// Choose a computer: the only one, else one that has the project synced, else ask.
export async function pickRunner(project, { needClaude = false, title = 'Run on which computer?' } = {}) {
  let list = needClaude ? claudeRunners() : R.runners;
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const withProject = list.filter((r) => r.projects.includes(project));
  if (withProject.length === 1) return withProject[0];
  if (withProject.length) list = withProject;
  const id = await menu(list.map((r) => ({ id: r.deviceId, label: `${r.name}${r.projects.includes(project) ? '' : ' (project not synced there)'}`, icon: 'device' })), null, title);
  return list.find((r) => r.deviceId === id) || null;
}

// Settings → "Your computers"
export function runnersHtml() {
  if (!R.runners.length) {
    const msg = problem();
    return `<div class="set-block"><p class="d">${esc(msg || 'No computers online.')}</p></div>`;
  }
  return R.runners.map((r) => `<div class="set-row"><div style="display:flex;gap:10px;align-items:center">
      <span class="glyph" aria-hidden="true">${esc(glyphFor(r.os))}</span>
      <div><div>${esc(r.name || 'Computer')}</div><div class="d">${esc(r.os || '')} · Claude ${r.claude ? 'signed in' : 'not signed in'}${r.projects.length ? ` · ${r.projects.length} project${r.projects.length === 1 ? '' : 's'}` : ''}</div></div></div>
      <span class="tag">${r.claude ? 'Claude ✓' : 'Run only'}</span></div>`).join('');
}

S.hooks = S.hooks || {};
S.hooks.runnersHtml = runnersHtml;

// Wait briefly for the channel to connect and a computer to show up (e.g. right after opening the app).
export function waitForRunners(ms = 4000, needClaude = false) {
  const has = () => (needClaude ? claudeRunners() : R.runners).length > 0;
  if (has() || R.state === 'upgrade') return Promise.resolve(has());
  connect();
  return new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (has() || R.state === 'upgrade' || Date.now() - t0 > ms) { clearInterval(iv); resolve(has()); }
    }, 150);
  });
}
