// The owner's stats dashboard: members, activity by day, the daily challenge, and feedback.
// Only members listed in the admins table see the button or get any numbers back.
import { loadStats, type Stats, type StatsDay, type StatsFeedback, type VisitorStats } from '../data/admin.ts';
import { loadAdminFeedback, replyToFeedback, setFeedbackDone, type AdminFeedback } from '../data/replies.ts';
import { $, $q, redraw, sheetOpen, showSheet } from './dom.ts';

const view = {
  stats: null as Stats | null, loading: false, error: '',
  /** Feedback with threads; null until the replies migration has run (then the plain list shows). */
  threads: null as AdminFeedback[] | null,
  filter: 'waiting' as 'waiting' | 'all',
  /** The reply box: which message, what's typed, and how sending went. */
  replyOpen: null as number | null, reply: '', busy: false, replyMsg: '',
};

const esc = (t: string): string => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const n = (x: number): string => x.toLocaleString('en-US');
// "Tue 11/17": short enough that every column of the 14-day table fits a phone.
const dayLabel = (d: string): string => {
  const t = new Date(`${d}T12:00:00Z`);
  return `${t.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${t.getUTCMonth() + 1}/${t.getUTCDate()}`;
};
const when = (iso: string): string => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });

const pct = (x: number, of: number): string => of ? `${Math.round((x / of) * 100)}%` : '';

/** Signed-out visitors: the steps toward signing up, how far the rest got, and where they came from. */
function visitorsHTML(v: VisitorStats): string {
  if (!v.visitors) return `<h3>Visitors <small>last 7 days</small></h3><p class="muted stats-note">No signed-out visitors counted yet. They show up here from their first page load.</p>`;
  const steps: [string, number][] = [['Visited', v.visitors], ['Answered', v.played], ['Opened sign-in', v.opened_signin], ['Asked for a code', v.sent_code], ['Signed up', v.signed_up]];
  const funnel = steps.map(([k, x]) => `<li><span class="fn-k">${k}</span><span class="fn-bar"><i style="width:${v.visitors ? Math.max(x ? 2 : 0, (x / v.visitors) * 100) : 0}%"></i></span><b>${n(x)}</b><small>${pct(x, v.visitors)}</small></li>`).join('');
  const left = v.visitors - v.signed_up, l = v.left_after;
  const gone: [string, number][] = [['Left without answering', l.none], ['Answered 1 to 9', l.few], ['Answered 10 to 49', l.some], ['Answered 50 or more', l.lots]];
  const leftRows = gone.map(([k, x]) => `<tr><th>${k}</th><td>${n(x)}</td><td><small>${pct(x, left)}</small></td></tr>`).join('');
  const src = v.sources.map(r => `<tr><th>${esc(r.source)}</th><td>${n(r.visitors)}</td><td>${r.played ? n(r.played) : ''}</td><td>${r.signed_up ? n(r.signed_up) : ''}</td></tr>`).join('');
  return `<h3>Visitors <small>last 7 days, signed out</small></h3>
    <ul class="funnel">${funnel}</ul>
    <h3>The ${n(left)} who didn’t sign up</h3>
    <div class="stats-scroll"><table class="stats"><tbody>${leftRows}<tr><th>Came back another day</th><td>${n(v.came_back)}</td><td><small>${pct(v.came_back, left)}</small></td></tr></tbody></table></div>
    <h3>Where they came from</h3>
    <div class="stats-scroll"><table class="stats"><thead><tr><th></th><th>Visitors</th><th>Answered</th><th>Signed up</th></tr></thead><tbody>${src}</tbody></table></div>
    <p class="muted stats-note">Counts each signed-out browser once (no cookies or IP addresses). Members already signed in aren’t counted, and neither are members signing in on a new device. Sources come from the link’s utm_source, or the site they clicked from; “direct” means no referrer, which includes most app links.</p>`;
}

/** Everyone's answers that day: members' plus signed-out visitors'. */
const answersOf = (d: StatsDay): number => d.answers + (d.guest_answers ?? 0);

/** Where a message was sent from, for the line under it. */
function whereOf(c: Record<string, unknown>): string {
  return [c.kind === 'pilot' ? 'pilot request, For schools page' : '', c.mode, c.hand ? `hand: ${c.hand}` : '', c.challenge ? 'in the daily challenge' : '', c.width ? `${c.width}px wide` : ''].filter(Boolean).join(' · ');
}

/** Before the replies migration has run: the feedback as a plain list. */
function plainFeedbackHTML(list: StatsFeedback[]): string {
  const items = list.length
    ? `<ul class="fb-list">${list.map(f => {
      const where = whereOf(f.context || {});
      return `<li><p>${esc(f.message).replace(/\n/g, '<br>')}</p><small>${when(f.at)} · ${f.email ? `<a href="mailto:${esc(f.email)}">${esc(f.email)}</a>` : 'no email'}${where ? ` · ${esc(where)}` : ''}</small></li>`;
    }).join('')}</ul>`
    : `<p class="muted">No feedback yet.</p>`;
  return `<h3>Feedback <small>${list.length ? `latest ${list.length}` : ''}</small></h3>${items}`;
}

const mailto = (f: AdminFeedback): string => `mailto:${encodeURIComponent(f.email!)}?subject=${encodeURIComponent('Re: your FeltReady feedback')}&body=${encodeURIComponent(`\n\n> ${f.message.replace(/\n/g, '\n> ')}`)}`;

/** One message: what they wrote, the thread, who a reply reaches, and the buttons. */
function threadItemHTML(f: AdminFeedback): string {
  const where = whereOf(f.context || {});
  const lastOwner = [...f.replies].reverse().find(r => r.owner);
  const read = !!(lastOwner && f.seen_at && Date.parse(f.seen_at) >= Date.parse(lastOwner.at));
  const reach = f.in_app
    ? `${f.member ? 'A member' : 'Sent signed out'}: your reply shows up for them in FeltReady${f.email ? ', or email them' : ''}.${read ? ' <b>They’ve read your reply.</b>' : lastOwner ? ' Not read yet.' : ''}`
    : f.email ? 'Sent before replies existed: reply by email.' : 'Sent before replies existed, with no email: there’s no way to reply.';
  const msgs = f.replies.map(r => `<div class="fb-msg${r.owner ? ' owner' : ''}"><small>${r.owner ? 'You' : 'They wrote back'} · ${when(r.at)}</small><p>${esc(r.body).replace(/\n/g, '<br>')}</p></div>`).join('');
  const box = view.replyOpen === f.id
    ? `<form class="fb-form fb-back" data-reply="${f.id}" novalidate>
        <label class="sr" for="fbReply">Your reply</label>
        <textarea id="fbReply" rows="4" maxlength="2000" placeholder="Type your reply">${esc(view.reply)}</textarea>
        <div class="fb-acts"><button class="btn small" type="submit" ${view.busy ? 'disabled' : ''}>${view.busy ? 'Sending…' : 'Send reply'}</button><button class="linkbtn" type="button" id="fbReplyCancel">Cancel</button></div>
        ${view.replyMsg ? `<p class="acct-msg err" role="alert">${esc(view.replyMsg)}</p>` : ''}
      </form>`
    : `<div class="fb-acts">${f.in_app ? `<button class="btn small" data-reply="${f.id}">Reply</button>` : ''}${f.email ? `<a class="linkbtn" href="${esc(mailto(f))}">Email ${esc(f.email)}</a>` : ''}<button class="linkbtn" data-done="${f.id}" data-v="${f.done_at ? '0' : '1'}">${f.done_at ? 'Reopen' : 'Mark done'}</button></div>`;
  return `<li class="fb-item${f.done_at ? '' : ' waiting'}">
    <p>${esc(f.message).replace(/\n/g, '<br>')}</p>
    <small>${when(f.at)}${where ? ` · ${esc(where)}` : ''}</small>
    ${msgs}<p class="fb-reach muted">${reach}</p>${box}</li>`;
}

/** The feedback, answered from here. Waiting: not marked done (a reply marks it done; their writing back reopens it). */
function threadsHTML(list: AdminFeedback[]): string {
  if (!list.length) return `<h3>Feedback</h3><p class="muted">No feedback yet.</p>`;
  const waiting = list.filter(f => !f.done_at);
  const shown = view.filter === 'waiting' ? waiting : list;
  const seg = `<div class="seg fb-filter" id="fbFilter"><button data-v="waiting" class="${view.filter === 'waiting' ? 'on' : ''}">Waiting (${waiting.length})</button><button data-v="all" class="${view.filter === 'all' ? 'on' : ''}">All (${list.length})</button></div>`;
  return `<h3>Feedback <small>${waiting.length ? `${waiting.length} waiting` : 'all answered'}</small></h3>${seg}
    ${shown.length ? `<ul class="fb-list">${shown.map(threadItemHTML).join('')}</ul>` : `<p class="muted">Nothing waiting. Nice.</p>`}`;
}

function statsHTML(s: Stats): string {
  const hands = s.hands != null;
  const tiles = [['Members', n(s.members)], ['New this week', n(s.members_7d)],
    ...(hands ? [['Hands', n(s.hands!)]] : []), ['Answers', n(s.answers + (s.guest_answers ?? 0))],
    ['Daily runs', n(s.daily_runs)], ...(hands && s.visitors ? [['Visitors this week', n(s.visitors.visitors)]] : [])]
    .map(([k, v]) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`).join('');
  const rows = s.days.map(d => `<tr${d.day === s.today ? ' class="today"' : ''}><th>${dayLabel(d.day)}</th>${s.visitors ? `<td>${d.visitors ? n(d.visitors) : ''}</td>` : ''}<td>${d.new_members || ''}</td><td>${(d.players ?? d.active) || ''}</td>${hands ? `<td>${d.hands ? n(d.hands) : ''}</td>` : ''}<td>${answersOf(d) ? n(answersOf(d)) : ''}</td><td>${d.daily_players ? `${d.daily_players}${d.daily_avg != null ? ` <small>(${d.daily_avg}%)</small>` : ''}` : ''}</td></tr>`).join('');
  const fb = view.threads ? threadsHTML(view.threads) : plainFeedbackHTML(s.feedback);
  return `<div class="tiles">${tiles}</div>
    ${s.visitors ? visitorsHTML(s.visitors) : ''}
    <h3>Last 14 days <small>Central time</small></h3>
    <div class="stats-scroll"><table class="stats days"><thead><tr><th></th>${s.visitors ? '<th>Visitors</th>' : ''}<th>New</th><th>Active</th>${hands ? '<th>Hands</th>' : ''}<th>Answers</th><th>Daily <small>(avg)</small></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted stats-note">New: members who signed up. ${s.days.some(d => d.players != null) ? 'Active: members and signed-out visitors who answered at least one question. Answers: everyone’s answers, signed in or out.' : 'Active: members who answered at least one question.'}${hands ? ' Hands: hands played to the end, signed in or out, counted since Nov 17, 2026.' : ''} Daily: challenge runs (average score).${s.visitors ? ' Visitors: signed-out browsers seen for the first time.' : ''}</p>
    ${fb}`;
}

export function renderStats(): void {
  if (!sheetOpen('stats')) return;
  let h = `<div class="spots-head"><h2>Stats</h2><button class="linkbtn" id="statsClose">Close</button></div>`;
  if (view.error) h += `<p class="acct-msg err" role="alert">${esc(view.error)}</p><button class="btn ghost" id="statsRetry">Try again</button>`;
  else if (!view.stats || view.loading) h += `<p class="muted">Loading…</p>`;
  else h += statsHTML(view.stats);
  redraw($('#stats'), h);
}

async function load(): Promise<void> {
  view.loading = true; view.error = ''; renderStats();
  const [stats, threads] = await Promise.all([
    loadStats().catch(e => { console.warn('FeltReady: stats', e); return null; }),
    loadAdminFeedback(),
  ]);
  if (stats) view.stats = stats; else view.error = 'Couldn’t load the stats.';
  view.threads = threads;
  // Nothing waiting: show everything rather than an empty list.
  if (threads && !threads.some(f => !f.done_at)) view.filter = 'all';
  view.loading = false; renderStats();
}

async function sendReply(id: number): Promise<void> {
  const body = ($q<HTMLTextAreaElement>('#fbReply')?.value || '').trim();
  view.reply = body;
  if (!body) { view.replyMsg = 'Type a reply first.'; renderStats(); $q<HTMLTextAreaElement>('#fbReply')?.focus(); return; }
  view.busy = true; view.replyMsg = ''; renderStats();
  const err = await replyToFeedback(id, body);
  view.busy = false;
  if (err) { view.replyMsg = err; renderStats(); return; }
  const f = view.threads?.find(t => t.id === id);
  if (f) { f.replies.push({ at: new Date().toISOString(), body, owner: true }); f.done_at = new Date().toISOString(); }
  view.replyOpen = null; view.reply = ''; renderStats();
}

async function markDone(id: number, done: boolean): Promise<void> {
  const f = view.threads?.find(t => t.id === id); if (!f) return;
  const was = f.done_at;
  f.done_at = done ? new Date().toISOString() : null; renderStats();
  const err = await setFeedbackDone(id, done);
  if (err) { f.done_at = was; renderStats(); }
}

export function openStats(): void {
  showSheet('stats');
  window.scrollTo({ top: 0, behavior: 'auto' });
  void load();
}

export function initStats(): void {
  $('#stats').addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button'); if (!t) return;
    if (t.id === 'statsClose') showSheet(null);
    if (t.id === 'statsRetry') void load();
    if (t.closest('#fbFilter') && t.dataset.v) { view.filter = t.dataset.v as 'waiting' | 'all'; renderStats(); }
    if (t.dataset.reply) {
      view.replyOpen = Number(t.dataset.reply); view.reply = ''; view.replyMsg = ''; renderStats();
      $q<HTMLTextAreaElement>('#fbReply')?.focus();
    }
    if (t.id === 'fbReplyCancel') { view.replyOpen = null; view.reply = ''; view.replyMsg = ''; renderStats(); }
    if (t.dataset.done) void markDone(Number(t.dataset.done), t.dataset.v === '1');
  });
  $('#stats').addEventListener('submit', e => {
    e.preventDefault();
    const id = Number((e.target as HTMLElement).dataset.reply);
    if (id) void sendReply(id);
  });
  $('#stats').addEventListener('input', e => {
    if ((e.target as HTMLElement).id !== 'fbReply') return;
    view.reply = (e.target as HTMLTextAreaElement).value;
    if (view.replyMsg) { view.replyMsg = ''; $q('#stats .acct-msg')?.remove(); }
  });
}
