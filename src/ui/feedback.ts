// "Send feedback": a short form anyone can use. Messages land in the feedback table, and the
// owner reads them on the stats dashboard.
import { app, memberEmail, storeMode } from '../app.ts';
import { accountsOn } from '../data/supabase.ts';
import { sendFeedback } from '../data/admin.ts';
import { $, $q, sheetOpen, showSheet } from './dom.ts';
import { game } from '../page.ts';

const ui = { busy: false, sent: false, msg: '', draft: '', email: '' };

export function renderFeedback(): void {
  $('#feedbackOpen').hidden = !accountsOn;
  if (!sheetOpen('feedback')) return;
  const member = storeMode() === 'member';
  const head = `<div class="spots-head"><h2>Send feedback</h2><button class="linkbtn" id="feedbackClose">Close</button></div>`;
  if (ui.sent) {
    $('#feedback').innerHTML = `${head}<p class="dresult fb-sent"><b>Thanks, got it.</b><span>${member || ui.email ? 'We may write back if there’s a question.' : 'It went straight to the person building FeltReady.'}</span></p>
      <button class="btn ghost" id="feedbackAgain">Send another</button>`;
    return;
  }
  $('#feedback').innerHTML = `${head}
    <p>What’s broken, confusing, or missing? A wrong answer the trainer marked right, a spot your room deals differently, a game you want next: all of it helps.</p>
    <form id="feedbackForm" class="fb-form" novalidate>
      <label class="sr" for="fbMessage">Your feedback</label>
      <textarea id="fbMessage" rows="5" maxlength="2000" placeholder="Type here">${ui.draft.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</textarea>
      ${member ? `<p class="muted fb-who">Sent from ${memberEmail().replace(/[&<>"]/g, '')}, so we can reply.</p>`
        : `<label class="sr" for="fbEmail">Email (optional)</label><input type="email" id="fbEmail" autocomplete="email" inputmode="email" placeholder="Email, if you'd like a reply (optional)" value="${ui.email.replace(/[&<>"]/g, '')}">`}
      <button class="btn" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Sending…' : 'Send'}</button>
    </form>${ui.msg ? `<p class="acct-msg err" role="alert">${ui.msg}</p>` : ''}`;
}

async function send(): Promise<void> {
  const message = ($q<HTMLTextAreaElement>('#fbMessage')?.value || '').trim();
  const email = ($q<HTMLInputElement>('#fbEmail')?.value || '').trim();
  ui.draft = message; ui.email = email;
  if (!message) { ui.msg = 'Type a message first.'; renderFeedback(); $q<HTMLTextAreaElement>('#fbMessage')?.focus(); return; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { ui.msg = 'That email doesn’t look right. Fix it, or leave it blank.'; renderFeedback(); return; }
  ui.busy = true; ui.msg = ''; renderFeedback();
  // A little context makes a bug report usable: where they were and on what device.
  const context = {
    game, mode: storeMode(), hand: app.S?.mode ?? null, challenge: !!app.challenge,
    width: window.innerWidth, ua: navigator.userAgent.slice(0, 180),
  };
  const err = await sendFeedback(message, storeMode() === 'member' ? null : email || null, context);
  ui.busy = false;
  if (err) { ui.msg = err; renderFeedback(); return; }
  ui.sent = true; ui.draft = ''; renderFeedback();
}

export function openFeedback(): void {
  ui.sent = false; ui.msg = '';
  showSheet('feedback');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderFeedback();
  setTimeout(() => $q<HTMLTextAreaElement>('#fbMessage')?.focus({ preventScroll: true }), 50);
}

export function initFeedback(): void {
  renderFeedback();
  if (!accountsOn) return;
  $('#feedbackOpen').addEventListener('click', openFeedback);
  const box = $('#feedback');
  box.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button'); if (!t) return;
    if (t.id === 'feedbackClose') showSheet(null);
    if (t.id === 'feedbackAgain') { ui.sent = false; renderFeedback(); }
  });
  box.addEventListener('submit', e => { e.preventDefault(); void send(); });
  box.addEventListener('input', e => {
    if ((e.target as HTMLElement).id === 'fbMessage') ui.draft = (e.target as HTMLTextAreaElement).value;
    if (ui.msg) { ui.msg = ''; $q('#feedback .acct-msg')?.remove(); } // typing clears the last complaint
  });
}
