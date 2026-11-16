// The instructor view (/teach/): a school's classes, their join codes, and each student's
// progress since joining. Owners and instructors only; the database checks every call.
//   /teach/                the school(s) and their classes, and a form to add one
//   /teach/#class=<id>     one class: its code, its students, and what each one is missing
import { GAMES, type GameId } from '../config.ts';
import { accountsOn } from '../data/supabase.ts';
import { passkeySignIn, passkeysAvailable, sendLink, signOut, verifyCode, watchAuth, type Member } from '../data/auth.ts';
import { MISS_LABELS, WEAK_BELOW, drillsFor, type Drill } from '../data/weakSpots.ts';
import {
  classRoster, createClass, formatCode, joinLink, myOrgs, newClassCode, notAllowed, removeStudent, renameClass, setClassOpen,
  type Org, type Roster, type Student,
} from '../data/teach.ts';
import { brandHTML } from './shell.ts';
import { $, $q } from './dom.ts';

type Sort = 'name' | 'accuracy' | 'recent';
const S = {
  /** null: still finding out who's signed in. */
  member: undefined as Member | null | undefined,
  orgs: null as Org[] | null,
  orgsError: false,
  roster: null as Roster | null,
  rosterFor: '' as string,
  rosterError: '' as string,
  rosterRun: 0,
  // sign-in
  step: 'email' as 'email' | 'code', email: '', busy: false, msg: '', msgErr: false, passkeys: false,
  // the class view
  open: new Set<string>(),
  sort: 'name' as Sort,
  confirm: '' as '' | 'code' | `remove:${string}`,
  renaming: false,
  working: false,
  flash: '',
};

const esc = (t: string): string => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const n = (x: number): string => x.toLocaleString('en-US');
const pct = (right: number, of: number): string => of ? `${Math.round((right / of) * 100)}%` : '–';
const secs = (ms: number | null): string => ms == null ? '–' : `${(ms / 1000).toFixed(1)}s`;
const shortDate = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
/** "just now", "5m ago", "3h ago", "yesterday", "4 days ago", or a date. */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 2) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return shortDate(iso);
}
/** Below this, with enough answers, a student's accuracy shows in red. */
const STRUGGLING = 0.75;
const MIN_FOR_TONE = 10;
const tone = (right: number, of: number): string =>
  of < MIN_FOR_TONE ? '' : right / of >= WEAK_BELOW ? 'good' : right / of < STRUGGLING ? 'weak' : '';

const drillLabel = (game: GameId, kind: string): string => drillsFor(game).find(d => d.kind === kind)?.label || kind;
const missLabel = (kind: string, miss: string): string => MISS_LABELS[kind as Drill]?.[miss] || miss;

const classId = (): string => new URLSearchParams(location.hash.slice(1)).get('class') || '';

// ---- sign-in -------------------------------------------------------------------------------

function signInHTML(): string {
  const note = S.msg ? `<p class="acct-msg${S.msgErr ? ' err' : ''}" role="status">${esc(S.msg)}</p>` : '';
  if (S.step === 'code') {
    return `<div class="acct teach-signin"><p class="acct-lead">We sent a sign-in code to <b>${esc(S.email)}</b>. Enter it here. It can take a minute to arrive, so check spam too.</p>
      <form class="acct-form" id="tCodeForm" novalidate>
        <label class="sr" for="tCode">Code from the email</label>
        <input id="tCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="Code from the email">
        <button class="btn" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Checking…' : 'Sign in'}</button>
      </form>${note}
      <p class="acct-alt"><button class="linkbtn" id="tBack">Use a different email</button></p></div>`;
  }
  return `<div class="acct teach-signin"><p class="acct-lead">Sign in with the email your school set up for you. There's no password: we email you a code.</p>
    <form class="acct-form" id="tEmailForm" novalidate>
      <label class="sr" for="tEmail">Email</label>
      <input type="email" id="tEmail" autocomplete="email" inputmode="email" placeholder="you@example.com" value="${esc(S.email)}" required>
      <button class="btn" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Sending…' : 'Email me a code'}</button>
    </form>${S.passkeys ? `<div class="acct-or" aria-hidden="true"><span>or</span></div>
    <button class="btn ghost acct-pk-btn" id="tPasskey" ${S.busy ? 'disabled' : ''}>Sign in with a passkey</button>` : ''}${note}</div>`;
}

// ---- the school and its classes ------------------------------------------------------------

function seatsText(o: { seat_limit: number | null; seats_used: number }): string {
  return o.seat_limit == null ? `${n(o.seats_used)} student${o.seats_used === 1 ? '' : 's'}` : `${n(o.seats_used)} of ${n(o.seat_limit)} seats used`;
}

function orgHTML(o: Org): string {
  const classes = o.classes.length
    ? `<ul class="cls-list">${o.classes.map(c => `<li><a class="cls${c.active ? '' : ' closed'}" href="#class=${c.id}">
        <span class="cls-name">${esc(c.name)}${c.active ? '' : ' <small>Closed</small>'}</span>
        <span class="cls-meta">${n(c.students)} student${c.students === 1 ? '' : 's'} · code <b>${formatCode(c.join_code)}</b></span>
      </a></li>`).join('')}</ul>`
    : `<p class="muted">No classes yet. Add one and you get a join code to give your students.</p>`;
  return `<section class="org" data-org="${o.id}">
    <h2>${esc(o.name)}</h2>
    <p class="muted org-sub">${o.kind === 'card_room' ? 'Card room' : 'Dealer school'} · ${seatsText(o)} · you're ${o.role === 'owner' ? 'an owner' : 'an instructor'}</p>
    <h3>Classes</h3>
    ${classes}
    <form class="acct-form new-class" data-org="${o.id}" novalidate>
      <label class="sr" for="newClass-${o.id}">New class name</label>
      <input id="newClass-${o.id}" name="name" maxlength="80" placeholder="New class name">
      <button class="btn" type="submit" ${S.working ? 'disabled' : ''}>Add class</button>
    </form>
  </section>`;
}

function noOrgsHTML(): string {
  return `<div class="teach-empty"><h2>No school on this account yet</h2>
    <p>You're signed in as <b>${esc(S.member?.email || '')}</b>, which isn't an owner or instructor at any school on FeltReady.</p>
    <p>If your school already uses FeltReady, ask its owner to add this email. Running a dealer school or card room and want to try it with your students? Use <b>Send feedback</b> on any game page and we'll set you up.</p>
    <p><a class="btn ghost" href="/plo/">Go to the games</a></p></div>`;
}

// ---- one class -----------------------------------------------------------------------------

function sorted(list: Student[]): Student[] {
  const acc = (s: Student) => s.stats && s.stats.answers ? s.stats.right / s.stats.answers : 2; // no answers last
  const by: Record<Sort, (a: Student, b: Student) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    accuracy: (a, b) => acc(a) - acc(b) || a.name.localeCompare(b.name),
    recent: (a, b) => (b.stats?.last_at || '').localeCompare(a.stats?.last_at || '') || a.name.localeCompare(b.name),
  };
  return [...list].sort(by[S.sort]);
}

function studentMoreHTML(s: Student, classIdNow: string): string {
  const st = s.stats!;
  let h = '';
  const games = [...new Set(st.drills.map(d => d.game))];
  for (const g of games) {
    const lines = st.drills.filter(d => d.game === g);
    h += `<div class="stu-game"><h4>${GAMES[g]?.name || g}</h4>
      <div class="srow shead" aria-hidden="true"><span></span><span></span><span>Right</span><span>Avg</span></div>
      ${lines.map(d => {
        const w = Math.max(3, Math.round((d.answers ? d.right / d.answers : 0) * 100));
        return `<div class="srow ${tone(d.right, d.answers)}"><span class="sl">${drillLabel(g, d.kind)}</span><span class="bar" aria-hidden="true"><i style="width:${w}%"></i></span><span class="sv" aria-label="${d.right} of ${d.answers} right">${d.right}/${d.answers}</span><span class="st">${secs(d.avg_ms)}</span></div>`;
      }).join('')}</div>`;
  }
  if (st.misses.length) {
    h += `<div class="misses"><h4>Most common mistakes</h4><ul>${st.misses.map(m =>
      `<li><span>${esc(missLabel(m.kind, m.miss))} <small>${drillLabel(m.game, m.kind)}${games.length > 1 ? `, ${GAMES[m.game]?.tag || m.game}` : ''}</small></span><b>${m.count}</b></li>`).join('')}</ul></div>`;
  }
  if (!st.answers) h += `<p class="muted">No answers since joining on ${shortDate(s.joined_at)}.</p>`;
  const asking = S.confirm === `remove:${s.user_id}`;
  h += asking
    ? `<div class="confirm" role="alert"><p>Remove ${esc(s.name)} from the class? Their seat frees up and you stop seeing their answers. They can rejoin with the code.</p>
        <div class="confirm-go"><button class="btn small" data-remove="${s.user_id}" data-class="${classIdNow}" ${S.working ? 'disabled' : ''}>Remove</button><button class="linkbtn" data-cancel>Cancel</button></div></div>`
    : `<p class="stu-foot"><span class="muted">Joined ${shortDate(s.joined_at)}</span><button class="linkbtn" data-ask-remove="${s.user_id}">Remove from class</button></p>`;
  return h;
}

function studentHTML(s: Student, cid: string): string {
  const st = s.stats!;
  const open = S.open.has(s.user_id);
  const acc = st.answers
    ? `<span class="stu-acc ${tone(st.right, st.answers)}">${pct(st.right, st.answers)}</span>`
    : `<span class="stu-acc none">No answers yet</span>`;
  const meta = st.answers ? `${n(st.answers)} answer${st.answers === 1 ? '' : 's'} · ${n(st.answers_7d)} this week · ${ago(st.last_at)}` : `Joined ${shortDate(s.joined_at)}`;
  return `<li class="stu${open ? ' open' : ''}">
    <button class="stu-row" data-stu="${s.user_id}" aria-expanded="${open}"><span class="stu-name">${esc(s.name)}</span>${acc}<span class="stu-meta">${meta}</span></button>
    ${open ? `<div class="stu-more">${studentMoreHTML(s, cid)}</div>` : ''}
  </li>`;
}

function classHTML(r: Roster): string {
  const c = r.class, link = joinLink(c.join_code);
  const now = r.students.filter(s => !s.left_at), gone = r.students.filter(s => s.left_at);
  const sum = now.reduce((a, s) => ({
    answers: a.answers + (s.stats?.answers || 0), right: a.right + (s.stats?.right || 0),
    week: a.week + (s.stats?.answers_7d || 0), active: a.active + (s.stats?.answers_7d ? 1 : 0),
  }), { answers: 0, right: 0, week: 0, active: 0 });

  const title = S.renaming
    ? `<form class="acct-form rename" id="renameForm" novalidate><label class="sr" for="renameInput">Class name</label>
        <input id="renameInput" maxlength="80" value="${esc(c.name)}"><button class="btn" type="submit" ${S.working ? 'disabled' : ''}>Save</button><button class="linkbtn" type="button" id="renameCancel">Cancel</button></form>`
    : `<div class="cls-title"><h2>${esc(c.name)}</h2><button class="linkbtn" id="renameOpen">Rename</button></div>`;

  const code = `<div class="code-box">
    <span class="code-label">Join code</span>
    <b class="code" id="joinCode">${formatCode(c.join_code)}</b>
    <span class="code-link" id="joinLink">${esc(link.replace(/^https?:\/\//, ''))}</span>
    <div class="code-go"><button class="btn small" id="copyLink">Copy join link</button>${S.confirm === 'code' ? '' : '<button class="linkbtn" id="askCode">New code</button>'}</div>
    ${S.confirm === 'code' ? `<div class="confirm" role="alert"><p>Make a new code? The old code and link stop working right away. Students already in the class stay in it.</p>
      <div class="confirm-go"><button class="btn small" id="newCode" ${S.working ? 'disabled' : ''}>Make a new code</button><button class="linkbtn" data-cancel>Cancel</button></div></div>` : ''}
    <p class="code-help">Give students the link or the code. They sign in to FeltReady, then join under the name you'll see here.</p>
  </div>`;

  const openRow = `<div class="row cls-open"><span>${c.active ? 'Taking new students' : '<b>Closed</b> to new students. Students already in stay in.'}</span>
    <button class="btn ghost" id="toggleOpen" ${S.working ? 'disabled' : ''}>${c.active ? 'Close class' : 'Reopen'}</button></div>`;

  const tiles = [['Students', n(now.length)], ['Active this week', n(sum.active)], ['Answers this week', n(sum.week)], ['Right since joining', pct(sum.right, sum.answers)]]
    .map(([k, v]) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`).join('');

  const sortSeg = `<div class="seg" id="sortSeg" role="group" aria-label="Sort students">${(['name', 'accuracy', 'recent'] as Sort[]).map(k =>
    `<button data-sort="${k}" class="${S.sort === k ? 'on' : ''}" aria-pressed="${S.sort === k}">${{ name: 'Name', accuracy: 'Lowest first', recent: 'Last active' }[k]}</button>`).join('')}</div>`;

  const list = now.length
    ? `<ul class="stu-list">${sorted(now).map(s => studentHTML(s, c.id)).join('')}</ul>`
    : `<p class="muted">No students yet. Once they join with the code, they show up here with everything they answer from then on.</p>`;

  const left = gone.length
    ? `<details class="left-list"><summary>Left the class (${gone.length})</summary><ul>${gone.map(s =>
      `<li>${esc(s.name)} <small>left ${shortDate(s.left_at!)}</small></li>`).join('')}</ul></details>`
    : '';

  return `<p class="crumb"><a class="linkbtn" href="#">All classes</a><span class="muted">${esc(r.org.name)} · ${seatsText(r.org)}</span></p>
    ${title}${code}${openRow}
    <div class="tiles">${tiles}</div>
    <div class="stu-head"><h3>Students</h3>${sortSeg}</div>
    ${list}${left}
    <p class="teach-note muted">Counts include every answer since each student joined, in any game. You never see answers from before they joined, or anything once they leave. <button class="linkbtn" id="refresh">Refresh</button></p>`;
}

// ---- the page -----------------------------------------------------------------------------

export function renderTeach(): void {
  const signedIn = !!S.member;
  let body: string;
  if (!accountsOn) body = `<p>Instructor accounts aren't set up on this copy of FeltReady.</p>`;
  else if (S.member === undefined) body = `<p class="muted">Loading…</p>`;
  else if (!S.member) body = `<h2 class="teach-h">Your classes</h2><p>Join codes for your classes, and how each of your students is doing.</p>${signInHTML()}`;
  else if (S.orgsError) body = `<p class="acct-msg err" role="alert">Couldn’t load your school. Check your connection and try again.</p><button class="btn ghost" id="retry">Try again</button>`;
  else if (!S.orgs) body = `<p class="muted">Loading your school…</p>`;
  else if (!S.orgs.length) body = noOrgsHTML();
  else if (classId()) {
    if (S.rosterError) body = `<p class="crumb"><a class="linkbtn" href="#">All classes</a></p><p class="acct-msg err" role="alert">${esc(S.rosterError)}</p><button class="btn ghost" id="refresh">Try again</button>`;
    else if (!S.roster || S.rosterFor !== classId()) body = `<p class="crumb"><a class="linkbtn" href="#">All classes</a></p><p class="muted">Loading the class…</p>`;
    else body = classHTML(S.roster);
  } else body = S.orgs.map(orgHTML).join('');

  $('#app').innerHTML = `<header class="top">
      <h1 class="brand"><a class="home" href="/" aria-label="FeltReady: all games">${brandHTML}</a><span class="game">Instructors</span></h1>
      ${signedIn ? '<button class="linkbtn" id="tSignOut">Sign out</button>' : ''}
    </header>
    ${S.flash ? `<p class="teach-flash" role="status">${esc(S.flash)}</p>` : ''}
    <main class="teach">${body}</main>
    <footer class="foot"><a class="linkbtn" href="/">All games</a>${signedIn ? `<span class="muted teach-who">${esc(S.member!.email)}</span>` : ''}</footer>`;
}

let flashTimer = 0;
function flash(msg: string): void {
  S.flash = msg; renderTeach();
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => { S.flash = ''; renderTeach(); }, 4000);
}

async function loadOrgs(): Promise<void> {
  S.orgsError = false;
  try { S.orgs = await myOrgs(); } catch (e) { console.warn('FeltReady: my_orgs', e); S.orgsError = true; }
  renderTeach();
}

async function loadRoster(): Promise<void> {
  const id = classId(); if (!id || !S.member) return;
  const run = ++S.rosterRun;
  if (S.rosterFor !== id) { S.roster = null; S.open.clear(); S.confirm = ''; S.renaming = false; }
  S.rosterFor = id; S.rosterError = ''; renderTeach();
  try {
    const r = await classRoster(id);
    if (run !== S.rosterRun) return;
    S.roster = r;
  } catch (e) {
    if (run !== S.rosterRun) return;
    console.warn('FeltReady: class_roster', e);
    S.rosterError = notAllowed(e) ? 'This class isn’t one of your school’s, or it was removed.' : 'Couldn’t load the class. Check your connection and try again.';
  }
  renderTeach();
}

/** Run a change, then reload the class (and the school's list, whose counts and codes change too). */
async function change(what: () => Promise<unknown>, done: string, fail: string): Promise<void> {
  S.working = true; renderTeach();
  try {
    await what();
    S.confirm = ''; S.renaming = false;
    await Promise.all([loadRoster(), loadOrgs()]);
    flash(done);
  } catch (e) {
    console.warn('FeltReady: change', e);
    flash(notAllowed(e) ? 'Only this school’s instructors can do that.' : fail);
  }
  S.working = false; renderTeach();
}

async function copyLink(): Promise<void> {
  if (!S.roster) return;
  const link = joinLink(S.roster.class.join_code);
  try { await navigator.clipboard.writeText(link); flash('Join link copied.'); }
  catch {
    // No clipboard (an older browser, or permission refused): select the link so it can be copied by hand.
    const el = $q('#joinLink'); if (!el) return;
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(range);
    flash('Copy the link that’s selected.');
  }
}

async function onEmail(): Promise<void> {
  const email = ($q<HTMLInputElement>('#tEmail')?.value || '').trim();
  S.email = email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { S.msg = 'Enter the email address you want to sign in with.'; S.msgErr = true; renderTeach(); return; }
  S.busy = true; S.msg = ''; renderTeach();
  const err = await sendLink(email);
  S.busy = false;
  if (err) { S.msg = err; S.msgErr = true; renderTeach(); return; }
  S.step = 'code'; S.msg = ''; renderTeach();
  $q<HTMLInputElement>('#tCode')?.focus();
}

async function onCode(): Promise<void> {
  const code = ($q<HTMLInputElement>('#tCode')?.value || '').replace(/\D/g, '');
  if (code.length < 6) { S.msg = 'Enter the code from the email.'; S.msgErr = true; renderTeach(); return; }
  S.busy = true; S.msg = ''; renderTeach();
  const err = await verifyCode(S.email, code);
  S.busy = false;
  if (err) { S.msg = err; S.msgErr = true; }
  renderTeach(); // on success, watchAuth takes over
}

async function onPasskey(): Promise<void> {
  S.busy = true; S.msg = ''; renderTeach();
  const err = await passkeySignIn();
  S.busy = false;
  if (err) { S.msg = err; S.msgErr = true; }
  renderTeach();
}

export function initTeach(): void {
  renderTeach();
  if (!accountsOn) return;
  void passkeysAvailable().then(on => { S.passkeys = on; renderTeach(); });

  const app = $('#app');
  app.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    if (f.id === 'tEmailForm') void onEmail();
    if (f.id === 'tCodeForm') void onCode();
    if (f.id === 'renameForm' && S.roster) {
      const name = ($q<HTMLInputElement>('#renameInput')?.value || '').trim();
      if (!name) return;
      const id = S.roster.class.id;
      void change(() => renameClass(id, name), 'Class renamed.', 'Couldn’t rename the class. Try again.');
    }
    if (f.classList.contains('new-class')) {
      const name = (f.querySelector<HTMLInputElement>('input')?.value || '').trim();
      if (!name) { f.querySelector<HTMLInputElement>('input')?.focus(); return; }
      S.working = true; renderTeach();
      void createClass(f.dataset.org!, name).then(async c => {
        S.working = false;
        await loadOrgs();
        location.hash = `class=${c.id}`;
        flash(`Class added. Its join code is ${formatCode(c.join_code)}.`);
      }, e2 => {
        console.warn('FeltReady: create_class', e2);
        S.working = false;
        flash(notAllowed(e2) ? 'Only this school’s instructors can add classes.' : 'Couldn’t add the class. Try again.');
      });
    }
  });

  app.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!t) return;
    const r = S.roster;
    if (t.id === 'tBack') { S.step = 'email'; S.msg = ''; renderTeach(); }
    else if (t.id === 'tPasskey') void onPasskey();
    else if (t.id === 'tSignOut') void signOut();
    else if (t.id === 'retry') { S.orgs = null; renderTeach(); void loadOrgs(); }
    else if (t.id === 'refresh') void loadRoster();
    else if (t.id === 'copyLink') void copyLink();
    else if (t.id === 'askCode') { S.confirm = 'code'; renderTeach(); }
    else if (t.hasAttribute('data-cancel')) { S.confirm = ''; renderTeach(); }
    else if (t.id === 'newCode' && r) void change(() => newClassCode(r.class.id), 'New code made. The old one no longer works.', 'Couldn’t make a new code. Try again.');
    else if (t.id === 'toggleOpen' && r) {
      const open = !r.class.active;
      void change(() => setClassOpen(r.class.id, open), open ? 'Class reopened to new students.' : 'Class closed to new students.', 'Couldn’t change the class. Try again.');
    }
    else if (t.id === 'renameOpen') { S.renaming = true; renderTeach(); $q<HTMLInputElement>('#renameInput')?.select(); }
    else if (t.id === 'renameCancel') { S.renaming = false; renderTeach(); }
    else if (t.dataset.sort) { S.sort = t.dataset.sort as Sort; renderTeach(); }
    else if (t.dataset.stu) {
      const id = t.dataset.stu;
      if (S.open.has(id)) S.open.delete(id); else S.open.add(id);
      if (S.confirm.startsWith('remove:')) S.confirm = '';
      renderTeach();
    }
    else if (t.dataset.askRemove) { S.confirm = `remove:${t.dataset.askRemove}`; renderTeach(); }
    else if (t.dataset.remove && t.dataset.class) {
      const name = r?.students.find(s => s.user_id === t.dataset.remove)?.name || 'The student';
      const cid = t.dataset.class, uid = t.dataset.remove;
      S.open.delete(uid);
      void change(() => removeStudent(cid, uid), `${name} was removed from the class.`, 'Couldn’t remove the student. Try again.');
    }
  });

  addEventListener('hashchange', () => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (classId()) void loadRoster(); else { S.rosterRun++; renderTeach(); }
  });

  watchAuth(m => {
    S.member = m; S.orgs = null; S.roster = null; S.rosterFor = ''; S.open.clear();
    S.step = 'email'; S.msg = ''; S.busy = false;
    renderTeach();
    if (m) { void loadOrgs(); if (classId()) void loadRoster(); }
  });
}
