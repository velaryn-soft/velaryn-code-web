// Shared projects (cloud upgrade 4): share a project with another Velaryn account by email,
// remove members, leave a project someone shared with you. Same behaviour as the desktop
// (main/sync.js shareProject / removeFromShare / leaveShare).
import {
  S, $, esc, BUCKET, CHUNK, LOOSE, toast, friendly, confirmBox, emit, target, fetchRows, loadShares, projectLabel, isShareKey,
} from './core.js?v=1795051823';
import { icon } from './icons.js?v=1795051823';

const shareError = (e, email) => {
  const m = e?.message || String(e);
  if (/VC_NO_ACCOUNT/.test(m)) return `No Velaryn account uses ${email}. Ask them to create one first.`;
  if (/VC_SELF/.test(m)) return 'That’s your own email.';
  if (/VC_NO_PROJECT/.test(m)) return 'Sync this project to the cloud before sharing it.';
  if (/VC_NO_ACCESS/.test(m)) return 'Only the owner can change who this project is shared with.';
  if (/function .* does not exist|schema cache|Could not find the function/i.test(m)) return 'Sharing needs the cloud upgrade in Velaryn Code on your computer (Settings → Cloud → Upgrade Cloud).';
  return friendly(e);
};

// Share my project `name` with `email`, then copy its current contents into shares/<id>/blobs/
// so members can open every file. Big files: the "<hash>.parts" list and its pieces, never a whole blob.
export async function shareProject(name, email, role = 'editor', onProgress = null) {
  const { data: shareId, error } = await S.client.rpc('vc_share_project', { p_project: name, p_email: email, p_role: role });
  if (error) throw new Error(shareError(error, email));
  await loadShares();
  const rows = (await fetchRows(name)).filter((r) => !r.deleted && r.hash);
  let n = 0;
  for (const r of rows) {
    const names = [];
    if (Number(r.size) > CHUNK) {
      names.push(`${r.hash}.parts`);
      // the list may be in my folder (saved before sharing) or already in the shared area
      let manifest = null;
      for (const p of [`${S.user.id}/blobs/${r.hash}.parts`, `shares/${shareId}/blobs/${r.hash}.parts`]) {
        const { data } = await S.client.storage.from(BUCKET).download(p);
        if (data) { manifest = JSON.parse(await data.text()); break; }
      }
      for (const c of manifest?.chunks || []) names.push(c.hash);
    } else names.push(r.hash);
    for (const nm of names) {
      const { error: cErr } = await S.client.storage.from(BUCKET).copy(`${S.user.id}/blobs/${nm}`, `shares/${shareId}/blobs/${nm}`);
      // already there, or saved after an earlier share (then it only exists in the shared area): fine
      if (cErr && !/exists|duplicate|409|not.?found|404/i.test(`${cErr.message} ${cErr.statusCode} ${cErr.status}`)) throw cErr;
    }
    onProgress?.(++n, rows.length);
  }
  emit('shares');
  return shareId;
}

export async function removeFromShare(name, memberId) {
  const sh = S.ownShares.get(name);
  if (!sh) return;
  const { error } = await S.client.rpc('vc_unshare', { p_share: sh.id, p_member: memberId });
  if (error) throw new Error(shareError(error));
  await loadShares();
  emit('shares');
}

// A member leaves a project someone shared with them.
export async function leaveShare(key) {
  const t = target(key);
  if (t.share) {
    const { error } = await S.client.rpc('vc_unshare', { p_share: t.share.id, p_member: S.user.id });
    if (error) throw new Error(shareError(error));
  }
  for (const [k, r] of [...S.rows]) if (r._key === key) S.rows.delete(k);
  await loadShares();
  emit('shares');
}

export async function confirmLeave(key) {
  const t = target(key);
  const ok = await confirmBox(`Leave ${projectLabel(key)}?`,
    `You'll stop seeing this project${t.share?.ownerEmail ? ` from ${t.share.ownerEmail}` : ''}. The owner can share it with you again.`, 'Leave', true);
  if (!ok) return false;
  const tt = toast('Leaving…', '', { sticky: true, spin: true });
  try { await leaveShare(key); tt.done('You left the project'); return true; } catch (e) { tt.done(friendly(e), 'err'); return false; }
}

// One line for a project card / page header.
export function shareLine(key) {
  if (isShareKey(key)) {
    const t = target(key);
    return t.share ? `Shared by ${t.share.ownerEmail || 'someone'}${t.role === 'viewer' ? ' · view only' : ''}` : '';
  }
  const n = S.ownShares.get(key)?.members?.length || 0;
  return n ? `Shared with ${n}` : '';
}

export const canShare = (key) => S.sharesSupported && !isShareKey(key) && key !== LOOSE;

// The Share dialog (owner): invite by email as editor or viewer, see and remove members.
export function openShareDialog(name) {
  if (!S.sharesSupported) return toast('Sharing needs the cloud upgrade in Velaryn Code on your computer (Settings → Cloud → Upgrade Cloud).', 'warn', { ms: 6000 });
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal share-modal" role="dialog" aria-modal="true" aria-label="Share ${esc(name)}">
    <h3>Share “${esc(name)}”</h3>
    <p>People you add can open this project in Velaryn Code on their own devices. Editors can change files; viewers can only look and download.</p>
    <form class="share-form" autocomplete="off">
      <input class="m-in" type="email" name="email" placeholder="Email of their Velaryn account" required autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="email">
      <div class="share-row">
        <select name="role" aria-label="Permission"><option value="editor">Can edit</option><option value="viewer">Can view</option></select>
        <button class="btn primary" type="submit">${icon('plus', 15)} Share</button>
      </div>
    </form>
    <div class="form-err" hidden></div>
    <h4 class="share-h">People with access</h4>
    <div class="share-members"></div>
    <div class="btns"><button class="btn" type="button" data-close>Done</button></div>
  </div>`;
  const err = $('.form-err', back);
  const showErr = (m) => { err.hidden = !m; err.textContent = m || ''; };
  const paint = () => {
    const members = S.ownShares.get(name)?.members || [];
    $('.share-members', back).innerHTML = `<div class="share-member owner"><span class="who">${esc(S.user.email || 'You')}</span><span class="role">Owner</span></div>`
      + (members.length ? members.map((m) => `<div class="share-member"><span class="who">${esc(m.email || m.id)}</span>
          <span class="role">${m.role === 'viewer' ? 'Can view' : 'Can edit'}</span>
          <button class="btn small ghost danger-text" type="button" data-remove="${esc(m.id)}" data-email="${esc(m.email || '')}">Remove</button></div>`).join('')
        : '<p class="d">Not shared with anyone yet.</p>');
  };
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('click', async (e) => {
    if (e.target === back || e.target.closest('[data-close]')) return close();
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      if (!(await confirmBox(`Remove ${rm.dataset.email || 'this person'}?`, 'They lose access to this project on all their devices.', 'Remove', true))) return;
      rm.disabled = true;
      try { await removeFromShare(name, rm.dataset.remove); toast('Removed', 'ok'); } catch (x) { showErr(friendly(x)); }
      paint();
    }
  });
  $('.share-form', back).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim(), role = f.role.value;
    if (!email) return;
    showErr('');
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    const t = toast('Sharing…', '', { sticky: true, spin: true });
    try {
      await shareProject(name, email, role, (i, n) => t.update(`Copying files for sharing ${i} / ${n}…`));
      t.done(`Shared with ${email}`);
      f.email.value = '';
      paint();
    } catch (x) { t.close(); showErr(x.message); }
    btn.disabled = false;
  });
  $('#modal-root').appendChild(back);
  paint();
  $('input[name=email]', back).focus();
}
