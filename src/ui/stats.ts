// The owner's stats dashboard: members, activity by day, the daily challenge, and feedback.
// Only members listed in the admins table see the button or get any numbers back.
import { loadStats, type Stats } from '../data/admin.ts';
import { $, sheetOpen, showSheet } from './dom.ts';

const view = { stats: null as Stats | null, loading: false, error: '' };

const esc = (t: string): string => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const n = (x: number): string => x.toLocaleString('en-US');
const dayLabel = (d: string): string => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const when = (iso: string): string => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });

function statsHTML(s: Stats): string {
  const tiles = [['Members', n(s.members)], ['New this week', n(s.members_7d)], ['Answers', n(s.answers)], ['Daily runs', n(s.daily_runs)]]
    .map(([k, v]) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`).join('');
  const rows = s.days.map(d => `<tr${d.day === s.today ? ' class="today"' : ''}><th>${dayLabel(d.day)}</th><td>${d.new_members || ''}</td><td>${d.active || ''}</td><td>${d.answers ? n(d.answers) : ''}</td><td>${d.daily_players ? `${d.daily_players}${d.daily_avg != null ? ` <small>(${d.daily_avg}%)</small>` : ''}` : ''}</td></tr>`).join('');
  const fb = s.feedback.length
    ? `<ul class="fb-list">${s.feedback.map(f => {
      const c = f.context || {};
      const where = [c.mode, c.hand ? `hand: ${c.hand}` : '', c.challenge ? 'in the daily challenge' : '', c.width ? `${c.width}px wide` : ''].filter(Boolean).join(' · ');
      return `<li><p>${esc(f.message).replace(/\n/g, '<br>')}</p><small>${when(f.at)} · ${f.email ? `<a href="mailto:${esc(f.email)}">${esc(f.email)}</a>` : 'no email'}${where ? ` · ${esc(String(where))}` : ''}</small></li>`;
    }).join('')}</ul>`
    : `<p class="muted">No feedback yet.</p>`;
  return `<div class="tiles">${tiles}</div>
    <h3>Last 14 days <small>Central time</small></h3>
    <div class="stats-scroll"><table class="stats"><thead><tr><th></th><th>New</th><th>Active</th><th>Answers</th><th>Daily <small>(avg)</small></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted stats-note">New: members who signed up. Active: members who answered at least one question. Daily: challenge runs (average score). Visitors who never sign in show up in Cloudflare Web Analytics instead.</p>
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
