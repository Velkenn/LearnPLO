// The owner's stats dashboard: members, activity by day, the daily challenge, and feedback.
// Only members listed in the admins table see the button or get any numbers back.
import { loadStats, type Stats, type VisitorStats } from '../data/admin.ts';
import { $, sheetOpen, showSheet } from './dom.ts';

const view = { stats: null as Stats | null, loading: false, error: '' };

const esc = (t: string): string => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const n = (x: number): string => x.toLocaleString('en-US');
const dayLabel = (d: string): string => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
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

function statsHTML(s: Stats): string {
  const tiles = [['Members', n(s.members)], ['New this week', n(s.members_7d)], ['Answers', n(s.answers)], ['Daily runs', n(s.daily_runs)]]
    .map(([k, v]) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`).join('');
  const rows = s.days.map(d => `<tr${d.day === s.today ? ' class="today"' : ''}><th>${dayLabel(d.day)}</th>${s.visitors ? `<td>${d.visitors ? n(d.visitors) : ''}</td>` : ''}<td>${d.new_members || ''}</td><td>${d.active || ''}</td><td>${d.answers ? n(d.answers) : ''}</td><td>${d.daily_players ? `${d.daily_players}${d.daily_avg != null ? ` <small>(${d.daily_avg}%)</small>` : ''}` : ''}</td></tr>`).join('');
  const fb = s.feedback.length
    ? `<ul class="fb-list">${s.feedback.map(f => {
      const c = f.context || {};
      const where = [c.mode, c.hand ? `hand: ${c.hand}` : '', c.challenge ? 'in the daily challenge' : '', c.width ? `${c.width}px wide` : ''].filter(Boolean).join(' · ');
      return `<li><p>${esc(f.message).replace(/\n/g, '<br>')}</p><small>${when(f.at)} · ${f.email ? `<a href="mailto:${esc(f.email)}">${esc(f.email)}</a>` : 'no email'}${where ? ` · ${esc(String(where))}` : ''}</small></li>`;
    }).join('')}</ul>`
    : `<p class="muted">No feedback yet.</p>`;
  return `<div class="tiles">${tiles}</div>
    ${s.visitors ? visitorsHTML(s.visitors) : ''}
    <h3>Last 14 days <small>Central time</small></h3>
    <div class="stats-scroll"><table class="stats days"><thead><tr><th></th>${s.visitors ? '<th>Visitors</th>' : ''}<th>New</th><th>Active</th><th>Answers</th><th>Daily <small>(avg)</small></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted stats-note">New: members who signed up. Active: members who answered at least one question. Daily: challenge runs (average score).${s.visitors ? ' Visitors: signed-out browsers seen for the first time.' : ''}</p>
    <h3>Feedback <small>${s.feedback.length ? `latest ${s.feedback.length}` : ''}</small></h3>${fb}`;
}

export function renderStats(): void {
  if (!sheetOpen('stats')) return;
  let h = `<div class="spots-head"><h2>Stats</h2><button class="linkbtn" id="statsClose">Close</button></div>`;
  if (view.error) h += `<p class="acct-msg err" role="alert">${esc(view.error)}</p><button class="btn ghost" id="statsRetry">Try again</button>`;
  else if (!view.stats || view.loading) h += `<p class="muted">Loading…</p>`;
  else h += statsHTML(view.stats);
  $('#stats').innerHTML = h;
}

async function load(): Promise<void> {
  view.loading = true; view.error = ''; renderStats();
  try { view.stats = await loadStats(); } catch (e) { console.warn('FeltReady: stats', e); view.error = 'Couldn’t load the stats.'; }
  view.loading = false; renderStats();
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
  });
}
