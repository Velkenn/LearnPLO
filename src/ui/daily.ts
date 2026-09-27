// The daily challenge: the strip under the scores, and the sheet with start, results, and leaderboard.
import { app, beginChallenge, challengeComplete, endChallenge, storeMode } from '../app.ts';
import { accountsOn } from '../data/supabase.ts';
import { DailyError, loadBoard, startDaily, submitDaily, type Board, type DailyResult } from '../data/daily.ts';
import { CHALLENGE_HANDS, CHALLENGE_VERSION } from '../engine/challenge.ts';
import { startHand } from '../game.ts';
import { $, $q, sheetOpen, showSheet } from './dom.ts';
import { openAccount } from './account.ts';
import { applySettings } from './settings.ts';
import { render } from './render.ts';

type Phase = 'idle' | 'name' | 'starting' | 'submitting' | 'error';
const ui = {
  phase: 'idle' as Phase,
  board: null as Board | null,
  boardFailed: false,
  /** Your graded run today, from submitting or from the leaderboard. */
  result: null as DailyResult | null,
  msg: '',
  retry: null as null | 'start' | 'submit',
  shared: false,
  tick: 0 as ReturnType<typeof setInterval> | 0,
};

const esc = (t: string): string => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const clock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
const dayLabel = (day: string): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
/** Time until the next challenge (midnight Central), like "7h 12m". */
function untilNext(): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  const left = 24 * 60 - (Number(p.hour) * 60 + Number(p.minute));
  return left >= 60 ? `${Math.floor(left / 60)}h ${left % 60}m` : `${left}m`;
}
const myResult = (): DailyResult | null => ui.result ?? (ui.board?.me ? { right: ui.board.me.right, total: ui.board.me.total, ms: ui.board.me.ms } : null);
const myRank = (): string => ui.board?.me ? `#${ui.board.me.rank} of ${ui.board.players}` : '';

// ---- the strip under the scores ----
function stripHTML(): string {
  const c = app.challenge;
  if (c && !c.submitted) {
    if (ui.phase === 'submitting') return `<span><b>Daily challenge</b> Grading your answers…</span>`;
    if (challengeComplete()) return `<span><b>Daily challenge</b> ${ui.phase === 'error' ? 'Couldn’t send your answers.' : 'All five hands dealt.'}</span><button class="linkbtn" id="dailyOpen">${ui.phase === 'error' ? 'Try again' : 'Results'}</button>`;
    const right = c.results.flat().filter(Boolean).length, asked = c.results.flat().length;
    return `<span><b>Daily challenge</b> Hand ${Math.max(1, c.hand + 1)} of ${CHALLENGE_HANDS} · ${right}/${asked} right</span><span class="dclock" aria-label="Time">${clock(Date.now() - Date.parse(c.startedAt))}</span>`;
  }
  const r = storeMode() === 'member' ? myResult() : null;
  if (r) return `<span><b>Today</b> ${r.right}/${r.total} in ${clock(r.ms)}${myRank() ? ` · ${myRank()}` : ''}</span><button class="linkbtn" id="dailyOpen" aria-expanded="${sheetOpen('daily')}">Leaderboard</button>`;
  const n = ui.board?.players ?? 0;
  return `<span><b>Daily challenge</b> ${n ? `${n} dealer${n === 1 ? '' : 's'} today` : 'Same five hands for everyone'}</span><button class="btn small" id="dailyOpen" aria-expanded="${sheetOpen('daily')}">Play</button>`;
}

// ---- the sheet ----
function boardHTML(): string {
  const b = ui.board;
  if (!b) return ui.boardFailed ? `<p class="muted">Couldn’t load the leaderboard.</p>` : `<p class="muted">Loading the leaderboard…</p>`;
  if (!b.top.length) return `<p class="muted">No one has finished today’s challenge yet. Be the first.</p>`;
  const row = (r: Board['top'][number]) => `<li class="${r.me ? 'me' : ''}"><span class="b-rank">${r.rank}</span><span class="b-name">${esc(r.name)}${r.me ? ' <small>(you)</small>' : ''}</span><span class="b-score">${r.right}/${r.total}</span><span class="b-time">${clock(r.ms)}</span></li>`;
  const meBelow = b.me && !b.top.some(r => r.me);
  return `<h3>Leaderboard <small>${b.players} dealer${b.players === 1 ? '' : 's'}</small></h3>
    <ol class="lboard">${b.top.map(row).join('')}${meBelow ? `<li class="gap" aria-hidden="true">⋯</li>${row(b.me!)}` : ''}</ol>`;
}

function bodyHTML(): string {
  const c = app.challenge;
  const how = `<p>Five hands on the same table for every dealer today: $2/$5, side pots often, and up to two pot calls a hand. Most right wins; ties go to the faster time from Start to your last answer.</p>`;
  if (storeMode() !== 'member') {
    return `${how}<p class="muted">Members only, so the leaderboard stays real. It’s free, with no password.</p><button class="btn" id="dailySignin">Sign in to play</button>`;
  }
  if (ui.phase === 'error') {
    return `<p class="acct-msg err" role="alert">${esc(ui.msg)}</p>${ui.retry ? `<button class="btn" id="dailyRetry">Try again</button>` : ''}`;
  }
  if (ui.phase === 'submitting') return `<p class="muted">Grading your answers…</p>`;
  if (ui.phase === 'starting') return `<p class="muted">Dealing today’s hands…</p>`;
  if (ui.phase === 'name') {
    return `<p>Pick a leaderboard name. It shows next to your score; your email never does.</p>
      <form class="acct-form" id="dailyNameForm" novalidate>
        <label class="sr" for="dailyName">Leaderboard name</label>
        <input id="dailyName" maxlength="24" autocomplete="nickname" placeholder="Name on the leaderboard" required>
        <button class="btn" type="submit">Save and start</button>
      </form>${ui.msg ? `<p class="acct-msg err" role="alert">${esc(ui.msg)}</p>` : ''}`;
  }
  if (c && !c.submitted) return `<p>You’re on hand ${Math.max(1, c.hand + 1)} of ${CHALLENGE_HANDS}. The clock is running.</p><button class="btn" id="dailyBack">Back to the table</button>`;
  const r = myResult();
  if (r) {
    return `<div class="dresult"><b>${r.right} of ${r.total} right</b><span>in ${clock(r.ms)}${myRank() ? ` · ${myRank()} today` : ''}</span></div>
      <p class="dnext"><button class="btn ghost" id="dailyShare">${ui.shared ? 'Copied' : 'Share your score'}</button><span class="muted">Next challenge in ${untilNext()}</span></p>`;
  }
  return `${how}<p class="muted">One run a day. The clock starts when you tap Start and keeps going if you leave.</p><button class="btn" id="dailyStart">Start today’s challenge</button>`;
}

export function renderDaily(): void {
  const strip = $('#dailyStrip'), box = $('#daily');
  strip.hidden = !accountsOn;
  if (!accountsOn) return;
  strip.innerHTML = stripHTML();
  if (!sheetOpen('daily')) return;
  const day = ui.board?.day ?? app.challenge?.day;
  box.innerHTML = `<div class="spots-head"><h2>Daily challenge${day ? ` <small>${dayLabel(day)}</small>` : ''}</h2><button class="linkbtn" id="dailyClose">Close</button></div>
    ${bodyHTML()}<div class="dboard">${boardHTML()}</div>`;
}

// ---- actions ----
async function refreshBoard(): Promise<void> {
  try { ui.board = await loadBoard(); ui.boardFailed = false; } catch (e) { console.warn('FeltReady: leaderboard', e); ui.boardFailed = true; }
  renderDaily();
}

function fail(e: unknown, retry: 'start' | 'submit'): void {
  ui.phase = 'error';
  ui.msg = e instanceof DailyError ? e.message : 'Something went wrong. Try again.';
  ui.retry = e instanceof DailyError && (e.code === 'version' || e.code === 'expired') ? null : retry;
  renderDaily();
}

async function start(name?: string): Promise<void> {
  ui.phase = 'starting'; ui.msg = ''; renderDaily();
  try {
    const r = await startDaily(name);
    if (r.status === 'name') { ui.phase = 'name'; renderDaily(); $q<HTMLInputElement>('#dailyName')?.focus(); return; }
    if (r.status === 'done') { ui.phase = 'idle'; ui.result = r.result; ui.board = r.board; renderDaily(); return; }
    if (r.version !== CHALLENGE_VERSION) throw new DailyError('FeltReady was updated. Reload the page to get the latest version.', 'version');
    ui.phase = 'idle';
    beginChallenge(r.day, r.seed, r.startedAt);
    applySettings();
    showSheet(null);
    startTicking();
    startHand();
    window.scrollTo({ top: 0, behavior: 'auto' });
    renderDaily();
  } catch (e) {
    if (e instanceof DailyError && e.code === 'name') { ui.phase = 'name'; ui.msg = e.message; renderDaily(); return; }
    fail(e, 'start');
  }
}

/** Send the answers after the last hand. Called when the fifth hand ends. */
export async function submitChallenge(): Promise<void> {
  const c = app.challenge;
  if (!c || c.submitted || ui.phase === 'submitting') return;
  ui.phase = 'submitting'; renderDaily();
  try {
    const r = await submitDaily(c.day, c.answers);
    ui.phase = 'idle'; ui.result = r.result; ui.board = r.board;
    c.submitted = true;
    stopTicking();
    if (sheetOpen('daily')) showDailyResults(); else { renderDaily(); render(); }
  } catch (e) {
    fail(e, 'submit');
  }
}

/** Open the results. After a graded run this also puts your own settings back. */
export function showDailyResults(): void {
  if (app.challenge?.submitted) { endChallenge(); applySettings(); render(); }
  showSheet('daily');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderDaily();
}

/** Redraw just the strip (hand number, right so far, clock). Cheap enough to run on every table redraw. */
export function renderStrip(): void {
  if (accountsOn) $('#dailyStrip').innerHTML = stripHTML();
}

function startTicking(): void {
  stopTicking();
  ui.tick = setInterval(() => { if (app.challenge && !app.challenge.submitted) renderStrip(); else stopTicking(); }, 1000);
}
function stopTicking(): void { if (ui.tick) { clearInterval(ui.tick); ui.tick = 0; } }

async function share(): Promise<void> {
  const r = myResult(); if (!r) return;
  const day = ui.board?.day ? dayLabel(ui.board.day) : 'today';
  const text = `FeltReady daily challenge, ${day}: ${r.right} of ${r.total} right in ${clock(r.ms)}${myRank() ? ` (${myRank()})` : ''}.`;
  // /share puts the score in the link preview (worker/share.ts), then lands on the challenge.
  const q = new URLSearchParams({ s: `${r.right}-${r.total}`, t: String(Math.round(r.ms / 1000)) });
  if (ui.board?.day) q.set('d', ui.board.day);
  if (ui.board?.me) q.set('r', `${ui.board.me.rank}-${ui.board.players}`);
  const url = `https://feltready.com/share?${q}`;
  (window as unknown as { __shared?: string }).__shared = url; // for the browser test
  try {
    if (navigator.share) { await navigator.share({ text, url }); return; }
    await navigator.clipboard.writeText(`${text} ${url}`);
    ui.shared = true; renderDaily();
  } catch { /* share sheet closed */ }
}

function toggle(): void {
  if (sheetOpen('daily')) { showSheet(null); renderDaily(); return; }
  openDaily();
}

/** Open the daily challenge sheet (or, right after a run, its results). */
export function openDaily(): void {
  if (challengeComplete()) { showDailyResults(); return; }
  showSheet('daily');
  window.scrollTo({ top: 0, behavior: 'auto' });
  renderDaily();
  void refreshBoard();
}

export function initDaily(): void {
  renderDaily();
  if (!accountsOn) return;
  $('#dailyStrip').addEventListener('click', e => { if ((e.target as HTMLElement).closest('#dailyOpen')) toggle(); });
  const box = $('#daily');
  box.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button'); if (!t) return;
    if (t.id === 'dailyClose' || t.id === 'dailyBack') { showSheet(null); renderDaily(); }
    if (t.id === 'dailySignin') openAccount();
    if (t.id === 'dailyStart') void start();
    if (t.id === 'dailyShare') void share();
    if (t.id === 'dailyRetry') { if (ui.retry === 'submit') void submitChallenge(); else void start(); }
  });
  box.addEventListener('submit', e => {
    e.preventDefault();
    if ((e.target as HTMLElement).id === 'dailyNameForm') void start(($q<HTMLInputElement>('#dailyName')?.value || '').trim());
  });
  if (new URLSearchParams(location.search).has('daily')) toggle(); else void refreshBoard();
}

/** Signed in or out: forget the last member's result and reload the leaderboard. */
export function refreshDaily(): void {
  ui.result = null; ui.phase = 'idle'; ui.msg = ''; ui.shared = false;
  stopTicking();
  renderDaily();
  void refreshBoard();
}
