// The join page: a student opens /join/<code> (or types a code at /join/), signs in, sees which
// class and school it is and what the school will see, gives the name their instructor knows them
// by, and joins. The Worker serves this page for /join/<anything>.
import { GAMES, type GameId } from '../config.ts';
import { accountsOn } from '../data/supabase.ts';
import { signOut, watchAuth, type Member } from '../data/auth.ts';
import { JOIN_ERRORS, MAX_NAME, classPreview, joinClass, type ClassPreview, type JoinError } from '../data/classes.ts';
import { cleanCode, codeFromUrl, formatCode } from '../data/joinCodes.ts';
import { brandHTML, siteLinksHTML } from './shell.ts';
import { $, $q, redraw } from './dom.ts';
import { initSignIn, resetSignIn, signInClick, signInHTML, signInInput, signInSubmit } from './signin.ts';

const S = {
  code: codeFromUrl(location.pathname, location.search),
  /** undefined: still finding out who's signed in. */
  member: undefined as Member | null | undefined,
  preview: null as ClassPreview | null,
  loading: false,
  failed: false,
  busy: false,
  /** An error from the join itself (the preview was fine). */
  joinError: null as JoinError | null,
  joined: false,
  /** What's typed in the name and code boxes. */
  name: '',
  codeDraft: '',
  run: 0,
};

const esc = (t: string): string => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const kindName = (k: string | undefined): string => k === 'card_room' ? 'card room' : 'dealer school';

/** Links to every game, for after joining. */
const DEAL: Record<GameId, string> = { plo: 'Deal pot limit Omaha', bomb: 'Deal bomb pots' };
const gamesHTML = (): string => `<div class="join-games">${(Object.keys(GAMES) as GameId[]).map((g, i) =>
  `<a class="btn${i ? ' ghost' : ''}" href="${GAMES[g].path}">${DEAL[g]}</a>`).join('')}</div>`;

function codeFormHTML(lead: string): string {
  return `<form class="acct-form join-code" id="codeForm" novalidate>
    <label class="sr" for="codeInput">Join code</label>
    <input id="codeInput" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="${lead}" value="${esc(S.codeDraft)}">
    <button class="btn" type="submit">Find my class</button>
  </form>`;
}

function body(): string {
  if (!accountsOn) return `<p>Classes aren’t set up on this copy of FeltReady.</p>`;
  if (!S.code) {
    return `<h2>Join your class</h2>
      <p>Enter the code from your instructor. It’s 8 letters and numbers, like K7Q2-PMXA.</p>
      ${codeFormHTML('Code from your instructor')}`;
  }
  const code = formatCode(S.code);
  if (S.member === undefined) return `<p class="muted">Loading…</p>`;
  if (!S.member) {
    return `<h2>Join your class</h2>
      <p>Your class code is <b class="join-code-inline">${esc(code)}</b>. Sign in to join, so your instructor can see how you’re doing. New to FeltReady? The same box makes you a free account.</p>
      ${signInHTML('Enter your email and we’ll send you a sign-in code. No password.')}`;
  }
  if (S.failed) return `<p class="acct-msg err" role="alert">Couldn’t look up that code. Check your connection and try again.</p><button class="btn ghost" id="retry">Try again</button>`;
  if (S.loading || !S.preview) return `<p class="muted">Finding your class…</p>`;

  const p = S.preview;
  if (!p.ok) {
    const err = p.error || 'not_found';
    return `<h2>Join your class</h2>
      <p class="acct-msg err join-err" role="alert">${JOIN_ERRORS[err]} <span class="muted">(Code ${esc(code)})</span></p>
      ${err === 'too_many_tries' ? '' : `<p>Try the code again:</p>${codeFormHTML('Code from your instructor')}`}`;
  }
  const cls = esc(p.class!.name), org = esc(p.org!.name);
  if (S.joined || p.already_in) {
    return `<div class="dresult join-done"><b>${S.joined ? 'You’re in.' : 'You’re already in this class.'}</b>
        <span>${cls} at ${org}. Everything you deal from ${S.joined ? 'now' : 'when you joined'} on shows up for your instructor.</span></div>
      <p>Pick a game to start dealing:</p>
      ${gamesHTML()}
      <p class="muted join-small">You can leave the class anytime from the settings button on any game page.</p>`;
  }
  if (p.error) {
    return `<h2>${cls}</h2><p class="muted join-org">${org} · ${kindName(p.org!.kind)}</p>
      <p class="acct-msg err join-err" role="alert">${JOIN_ERRORS[p.error]}</p>`;
  }
  return `<h2>Join ${cls}</h2>
    <p class="muted join-org">${org} · ${kindName(p.org!.kind)}</p>
    <div class="join-share">
      <h3>What your instructors see</h3>
      <ul>
        <li>Every answer you give in FeltReady from the moment you join: right or wrong, how long you took, and the mistakes you make most.</li>
        <li>The name you enter below.</li>
      </ul>
      <h3>What they don’t see</h3>
      <ul>
        <li>Your email address.</li>
        <li>Anything you answered before you joined.</li>
      </ul>
      <p>You can leave anytime from the settings button on any game page, and they stop seeing your answers right away.</p>
    </div>
    <form class="join-form" id="joinForm" novalidate>
      <label for="joinName">Your name, as your instructor knows you</label>
      <div class="acct-form">
        <input id="joinName" maxlength="${MAX_NAME}" autocomplete="name" value="${esc(S.name)}" placeholder="First and last name">
        <button class="btn" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Joining…' : 'Join the class'}</button>
      </div>
      ${S.joinError ? `<p class="acct-msg err" role="alert">${JOIN_ERRORS[S.joinError]}</p>` : ''}
    </form>`;
}

export function renderJoin(): void {
  redraw($('#app'), `<header class="top">
      <h1 class="brand"><a class="home" href="/" aria-label="FeltReady: all games">${brandHTML}</a><span class="game">Classes</span></h1>
    </header>
    <main class="join">${body()}</main>
    <footer class="foot"><a class="linkbtn" href="/">All games</a>${S.member ? `<span class="muted teach-who">${esc(S.member.email)}</span><button class="linkbtn" id="jSignOut">Sign out</button>` : ''}</footer>${siteLinksHTML}`);
}

async function loadPreview(): Promise<void> {
  if (!S.code || !S.member) return;
  const run = ++S.run;
  S.loading = true; S.failed = false; S.preview = null; S.joined = false; S.joinError = null; renderJoin();
  try {
    const p = await classPreview(S.code);
    if (run !== S.run) return;
    S.preview = p;
  } catch (e) {
    if (run !== S.run) return;
    console.warn('FeltReady: class_preview', e);
    S.failed = true;
  }
  S.loading = false; renderJoin();
  $q<HTMLInputElement>('#joinName')?.focus();
}

/** Show a new code: put it in the address (so a reload or a sign-in link keeps it) and look it up. */
function useCode(raw: string): void {
  const code = cleanCode(raw);
  if (code.length !== 8) {
    const input = $q<HTMLInputElement>('#codeInput');
    if (input) { input.setCustomValidity('Codes are 8 letters and numbers.'); input.reportValidity(); }
    return;
  }
  S.code = code; S.codeDraft = '';
  history.replaceState(null, '', `/join/${code}`);
  if (S.member) void loadPreview(); else renderJoin();
}

async function onJoin(): Promise<void> {
  const name = ($q<HTMLInputElement>('#joinName')?.value || '').trim();
  S.name = name;
  if (!name || name.length > MAX_NAME) { S.joinError = 'bad_name'; renderJoin(); $q<HTMLInputElement>('#joinName')?.focus(); return; }
  S.busy = true; S.joinError = null; renderJoin();
  try {
    const r = await joinClass(S.code, name);
    S.busy = false;
    if (r.ok) { S.joined = true; if (r.class && S.preview) S.preview = { ...S.preview, class: r.class, org: r.org ?? S.preview.org }; }
    else if (r.error === 'not_found' || r.error === 'too_many_tries') S.preview = { ok: false, error: r.error }; // the code was changed meanwhile
    else S.joinError = r.error || 'not_found';
  } catch (e) {
    console.warn('FeltReady: join_class', e);
    S.busy = false;
    S.failed = true;
  }
  renderJoin();
}

export function initJoin(): void {
  renderJoin();
  if (!accountsOn) return;
  initSignIn(renderJoin);
  const app = $('#app');
  app.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    if (signInSubmit(f)) return;
    if (f.id === 'codeForm') useCode($q<HTMLInputElement>('#codeInput')?.value || '');
    if (f.id === 'joinForm') void onJoin();
  });
  app.addEventListener('input', e => {
    const t = e.target as HTMLInputElement;
    if (signInInput(t)) return;
    if (t.id === 'codeInput') { S.codeDraft = t.value; t.setCustomValidity(''); }
    if (t.id === 'joinName') S.name = t.value;
  });
  app.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!t) return;
    if (signInClick(t)) return;
    if (t.id === 'jSignOut') void signOut();
    if (t.id === 'retry') void loadPreview();
  });
  watchAuth(m => {
    S.member = m; resetSignIn();
    if (m) void loadPreview(); else { S.preview = null; renderJoin(); }
  });
}
