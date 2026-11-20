// "Send feedback": a short form anyone can use. Messages land in the feedback table, and the
// owner reads and answers them on the stats dashboard. Answers come back here: a note under the
// scores says there's a reply, and the sheet shows each answered message with its thread, where
// the sender can write back (data/replies.ts).
import { app, memberEmail, storeMode } from '../app.ts';
import { accountsOn } from '../data/supabase.ts';
import { sendFeedback } from '../data/admin.ts';
import { ensureSenderId, loadMyThreads, markRepliesSeen, unreadIn, writeBack, type Thread } from '../data/replies.ts';
import { $, $q, redraw, sheetOpen, showSheet } from './dom.ts';
import { game } from '../page.ts';

const ui = {
  busy: false, sent: false, msg: '', draft: '', email: '',
  /** The sender's answered messages (null until loaded, or when there are none to ask about). */
  threads: null as Thread[] | null,
  /** Threads that were unread when the sheet opened, so they stay marked while it's open. */
  fresh: new Set<number>(),
  /** Write back: which thread's box is open, and what's typed in it. */
  backOpen: null as number | null, back: '', backBusy: false, backMsg: '',
};

const esc = (t: string): string => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const para = (t: string): string => esc(t).replace(/\n/g, '<br>');
const day = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const unread = (): number => (ui.threads || []).reduce((n, t) => n + unreadIn(t), 0);

function threadHTML(t: Thread): string {
  const short = t.message.length > 240 ? `${t.message.slice(0, 240).trimEnd()}…` : t.message;
  const msgs = t.replies.map(r => `<div class="fb-msg${r.owner ? ' owner' : ''}"><small>${r.owner ? 'FeltReady' : 'You'} · ${day(r.at)}</small><p>${para(r.body)}</p></div>`).join('');
  const box = ui.backOpen === t.id
    ? `<form class="fb-form fb-back" data-thread="${t.id}" novalidate>
        <label class="sr" for="fbBack">Write back</label>
        <textarea id="fbBack" rows="3" maxlength="2000" placeholder="Type here">${esc(ui.back)}</textarea>
        <div class="fb-acts"><button class="btn small" type="submit" ${ui.backBusy ? 'disabled' : ''}>${ui.backBusy ? 'Sending…' : 'Send'}</button><button class="linkbtn" type="button" id="fbBackCancel">Cancel</button></div>
        ${ui.backMsg ? `<p class="acct-msg err" role="alert">${esc(ui.backMsg)}</p>` : ''}
      </form>`
    : `<button class="linkbtn fb-reply" data-back="${t.id}">Write back</button>`;
  return `<li class="fb-thread${ui.fresh.has(t.id) ? ' new' : ''}">
    <div class="fb-msg mine"><small>You wrote · ${day(t.at)}</small><p>${para(short)}</p></div>${msgs}${box}</li>`;
}

/** The note under the scores: there's a reply they haven't opened. */
function renderNote(): void {
  const note = $q('#fbNote');
  if (!note) return;
  const n = unread();
  note.hidden = !accountsOn || !n || sheetOpen('feedback');
  if (!note.hidden) redraw(note, `<span><b>${n === 1 ? 'You have a reply' : `You have ${n} replies`}</b> to your feedback.</span><button class="linkbtn" id="fbNoteOpen">Read it</button>`);
}

export function renderFeedback(): void {
  $('#feedbackOpen').hidden = !accountsOn;
  $('#feedbackRow').hidden = !accountsOn;
  renderNote();
  if (!sheetOpen('feedback')) return;
  const member = storeMode() === 'member';
  const head = `<div class="spots-head"><h2>${ui.threads?.length ? 'Feedback' : 'Send feedback'}</h2><button class="linkbtn" id="feedbackClose">Close</button></div>`;
  const threads = ui.threads?.length ? `<h3>Replies</h3><ul class="fb-threads">${ui.threads.map(threadHTML).join('')}</ul><h3>Send something new</h3>` : '';
  if (ui.sent) {
    redraw($('#feedback'), `${head}<p class="dresult fb-sent"><b>Thanks, got it.</b><span>${member ? 'If there’s a reply, you’ll see it here.' : ui.email ? 'If there’s a reply, it shows up here on this device, or we’ll email you.' : 'If there’s a reply, it shows up here on this device.'}</span></p>
      <button class="btn ghost" id="feedbackAgain">Send another</button>`);
    return;
  }
  redraw($('#feedback'), `${head}${threads}
    <p>What’s broken, confusing, or missing? A wrong answer the trainer marked right, a spot your room deals differently, a game you want next: all of it helps.</p>
    <form id="feedbackForm" class="fb-form" novalidate>
      <label class="sr" for="fbMessage">Your feedback</label>
      <textarea id="fbMessage" rows="5" maxlength="2000" placeholder="Type here">${esc(ui.draft)}</textarea>
      ${member ? `<p class="muted fb-who">Sent from ${esc(memberEmail())}, so we can reply.</p>`
        : `<label class="sr" for="fbEmail">Email (optional)</label><input type="email" id="fbEmail" autocomplete="email" inputmode="email" placeholder="Email, if you'd like a reply (optional)" value="${esc(ui.email)}">`}
      <button class="btn" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Sending…' : 'Send'}</button>
    </form>${ui.msg ? `<p class="acct-msg err" role="alert">${ui.msg}</p>` : ''}`);
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
  const member = storeMode() === 'member';
  const err = await sendFeedback(message, member ? null : email || null, context, ensureSenderId());
  ui.busy = false;
  if (err) { ui.msg = err; renderFeedback(); return; }
  ui.sent = true; ui.draft = ''; renderFeedback();
}

async function sendBack(id: number): Promise<void> {
  const body = ($q<HTMLTextAreaElement>('#fbBack')?.value || '').trim();
  ui.back = body;
  if (!body) { ui.backMsg = 'Type a message first.'; renderFeedback(); $q<HTMLTextAreaElement>('#fbBack')?.focus(); return; }
  ui.backBusy = true; ui.backMsg = ''; renderFeedback();
  const err = await writeBack(id, body);
  ui.backBusy = false;
  if (err) { ui.backMsg = err; renderFeedback(); return; }
  ui.threads?.find(t => t.id === id)?.replies.push({ at: new Date().toISOString(), body, owner: false });
  ui.backOpen = null; ui.back = ''; renderFeedback();
}

/** Look for replies: on load, and when someone signs in or out. Only the latest look counts. */
let looking = 0, shownFor = '';
export async function refreshReplies(): Promise<void> {
  if (!accountsOn) return;
  const mine = ++looking, mode = storeMode();
  // Signed in or out: the last person's replies go right away.
  if (mode !== shownFor) { shownFor = mode; ui.threads = null; ui.backOpen = null; ui.back = ''; ui.fresh.clear(); renderFeedback(); }
  const threads = await loadMyThreads(mode === 'member');
  if (mine !== looking || storeMode() !== mode) return; // a newer look is on its way
  // Keep what this visit already knows is read (opened while the call was out).
  for (const t of threads || []) {
    const had = ui.threads?.find(x => x.id === t.id);
    if (had?.seen_at && (!t.seen_at || Date.parse(had.seen_at) > Date.parse(t.seen_at))) t.seen_at = had.seen_at;
  }
  ui.threads = threads;
  renderFeedback();
  if (sheetOpen('feedback')) void seen();
}

/** Opening the sheet reads every reply. */
async function seen(): Promise<void> {
  if (!unread()) return;
  const now = new Date().toISOString();
  for (const t of ui.threads || []) if (unreadIn(t)) { ui.fresh.add(t.id); t.seen_at = now; }
  renderFeedback();
  await markRepliesSeen();
}

export function openFeedback(): void {
  ui.sent = false; ui.msg = ''; ui.fresh.clear();
  showSheet('feedback');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const replies = unread() > 0;
  renderFeedback();
  void seen();
  // With a new reply, the replies come first; otherwise go straight to typing.
  if (!replies) setTimeout(() => $q<HTMLTextAreaElement>('#fbMessage')?.focus({ preventScroll: true }), 50);
}

export function initFeedback(): void {
  renderFeedback();
  if (!accountsOn) return;
  $('#feedbackOpen').addEventListener('click', openFeedback);
  $('#feedbackSettings').addEventListener('click', openFeedback); // same form, from the settings sheet
  $('#fbNote').addEventListener('click', e => { if ((e.target as HTMLElement).closest('#fbNoteOpen')) openFeedback(); });
  const box = $('#feedback');
  box.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button'); if (!t) return;
    if (t.id === 'feedbackClose') { showSheet(null); renderNote(); }
    if (t.id === 'feedbackAgain') { ui.sent = false; renderFeedback(); }
    if (t.dataset.back) {
      ui.backOpen = Number(t.dataset.back); ui.back = ''; ui.backMsg = ''; renderFeedback();
      $q<HTMLTextAreaElement>('#fbBack')?.focus();
    }
    if (t.id === 'fbBackCancel') { ui.backOpen = null; ui.back = ''; ui.backMsg = ''; renderFeedback(); }
  });
  box.addEventListener('submit', e => {
    e.preventDefault();
    const form = e.target as HTMLElement;
    if (form.id === 'feedbackForm') void send();
    else if (form.dataset.thread) void sendBack(Number(form.dataset.thread));
  });
  box.addEventListener('input', e => {
    const id = (e.target as HTMLElement).id;
    if (id === 'fbMessage') ui.draft = (e.target as HTMLTextAreaElement).value;
    if (id === 'fbEmail') ui.email = (e.target as HTMLInputElement).value;
    if (id === 'fbBack') ui.back = (e.target as HTMLTextAreaElement).value;
    if (ui.msg || ui.backMsg) { ui.msg = ''; ui.backMsg = ''; $q('#feedback .acct-msg')?.remove(); } // typing clears the last complaint
  });
}
