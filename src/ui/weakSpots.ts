// The weak spots sheet: where a member's answers go wrong, from the attempts log.
import { storeMode } from '../app.ts';
import { accountsOn } from '../data/supabase.ts';
import { ATTEMPTS_WINDOW, store } from '../data/store.ts';
import { DRILLS, MIN_ANSWERS, WEAK_BELOW, accuracy, weakSpots, type Line, type Report } from '../data/weakSpots.ts';
import { $, sheetOpen, showSheet } from './dom.ts';
import { openAccount } from './account.ts';

const view = { loading: false, error: false, report: null as Report | null, run: 0 };

const pct = (l: Pick<Line, 'n' | 'right'>): string => `${Math.round(accuracy(l) * 100)}%`;
const secs = (ms: number | null): string => ms == null ? '–' : `${(ms / 1000).toFixed(1)}s`;
const drillName = (kind: string): string => DRILLS.find(d => d.kind === kind)?.label || kind;
/** Red is saved for the spots in "Work on these"; green is 90% or better; in between stays neutral. */
const tone = (l: Line, focus: Line[] = []): string => focus.includes(l) ? 'weak' : accuracy(l) >= WEAK_BELOW ? 'good' : '';

function rowHTML(l: Line, focus: Line[]): string {
  const w = Math.max(3, Math.round(accuracy(l) * 100));
  return `<div class="srow ${tone(l, focus)}"><span class="sl">${l.label}</span><span class="bar" aria-hidden="true"><i style="width:${w}%"></i></span><span class="sv" aria-label="${l.right} of ${l.n} right">${l.right}/${l.n}</span><span class="st">${secs(l.avgMs)}</span></div>`;
}

function reportHTML(r: Report): string {
  const since = r.since ? new Date(r.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  let h = `<p class="muted spots-sub">${r.total >= ATTEMPTS_WINDOW
    ? `From your last ${r.total.toLocaleString('en-US')} answers, since ${since}.`
    : `From all ${r.total.toLocaleString('en-US')} of your answers${since ? `, since ${since}` : ''}.`}</p>`;

  const enough = r.drills.some(d => d.situations.some(s => s.n >= MIN_ANSWERS));
  if (r.focus.length) {
    h += `<div class="focus"><h3>Work on these</h3><ol>${r.focus.map(f =>
      `<li><b>${f.label}</b><span>${drillName(f.kind)}: ${f.right} of ${f.n} right (${pct(f)})</span></li>`).join('')}</ol></div>`;
  } else {
    h += `<p class="focus none">${enough
      ? `No weak spots right now. Every spot you've played ${MIN_ANSWERS} or more times is at ${Math.round(WEAK_BELOW * 100)}% or better.`
      : `Keep dealing. A spot can show up here once you've played it ${MIN_ANSWERS} times.`}</p>`;
  }

  for (const d of r.drills) {
    h += `<div class="drill"><div class="dhead"><h3>${d.label}</h3>${d.n
      ? `<span><b class="${tone(d)}">${pct(d)}</b> of ${d.n} · ${secs(d.avgMs)} avg${d.timeouts ? ` · ${d.timeouts} timed out` : ''}</span>`
      : '<span class="muted">No answers yet</span>'}</div>`;
    if (d.situations.length) h += `<div class="srow shead" aria-hidden="true"><span></span><span></span><span>Right</span><span>Avg</span></div>${d.situations.map(l => rowHTML(l, r.focus)).join('')}`;
    h += `</div>`;
  }

  if (r.misses.length) {
    h += `<div class="misses"><h3>What went wrong</h3><ul>${r.misses.slice(0, 6).map(m =>
      `<li><span>${m.label} <small>${drillName(m.kind)}</small></span><b>${m.n}</b></li>`).join('')}</ul></div>`;
  }
  return h;
}

export function renderSpots(): void {
  const box = $('#spots'), btn = $('#spotsBtn');
  btn.hidden = !accountsOn;
  if (!sheetOpen('spots')) return;
  let h = `<div class="spots-head"><h2>Your weak spots</h2><button class="linkbtn" id="spotsClose">Close</button></div>`;
  if (storeMode() !== 'member') {
    h += `<p>Sign in and FeltReady keeps every answer you give, then shows where you slip: re-pots, side pots with two or more all-ins, chops, and the mistakes you make most.</p>
      <button class="btn" id="spotsSignin">Sign in free</button>`;
  } else if (view.report && !view.loading) {
    h += view.report.total ? reportHTML(view.report)
      : `<p class="muted">No answers yet. Deal a few hands and your weak spots show up here.</p>`;
  } else if (view.error) {
    h += `<p class="acct-msg err">Couldn’t load your answers. Check your connection and try again.</p><button class="btn ghost" id="spotsRetry">Try again</button>`;
  } else {
    h += `<p class="muted">Loading your answers…</p>`;
  }
  box.innerHTML = h;
}

/** Fetch the member's answers again and redraw. */
async function load(): Promise<void> {
  if (storeMode() !== 'member' || !store.loadAttempts) { renderSpots(); return; }
  const run = ++view.run, from = store;
  view.loading = true; view.error = false; renderSpots();
  try {
    const rows = await from.loadAttempts!();
    if (run !== view.run || from !== store) return; // signed out or reopened meanwhile
    view.report = weakSpots(rows);
  } catch (e) {
    if (run !== view.run) return;
    console.warn('FeltReady: could not load answers', e);
    view.error = true;
  }
  view.loading = false;
  renderSpots();
}

function open(): void {
  showSheet('spots');
  window.scrollTo({ top: 0, behavior: 'auto' });
  void load();
}

export function initSpots(): void {
  renderSpots();
  if (!accountsOn) return;
  $('#spotsBtn').addEventListener('click', () => { if (sheetOpen('spots')) showSheet(null); else open(); });
  $('#spots').addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button'); if (!t) return;
    if (t.id === 'spotsClose') showSheet(null);
    if (t.id === 'spotsRetry') void load();
    if (t.id === 'spotsSignin') openAccount();
  });
}

/** Signed in or out: drop the last member's numbers, and reload if the sheet is open. */
export function refreshSpots(): void {
  view.report = null; view.run++;
  if (sheetOpen('spots')) void load(); else renderSpots();
}
