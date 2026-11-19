// The sign-in box: Google or Apple, an email and password, an emailed code, or a passkey.
// One box per page. The game shell's account box makes its own with createSignIn({ prefix: 'acct' });
// the pages without the game shell, the instructor view (/teach/) and the join page (/join/), use
// the ready-made one below through signInHTML() / signInSubmit() / signInInput() / signInClick().
// A page passes its form submits, typing and button clicks to the box, and redraws when it asks.
// A successful sign-in reaches the page through watchAuth, not through the box.
import {
  MIN_PASSWORD, oauthReturnError, oauthSignIn, passkeySignIn, passkeysAvailable, passwordSignIn, passwordSignUp,
  providerName, providersAvailable, sendLink, verifyCode, verifySignupCode, type Provider,
} from '../data/auth.ts';
import { wasMember } from '../data/visits.ts';
import { $q } from './dom.ts';

/** What the email form does: make an account with a password, sign in with one, or email a code. */
type Mode = 'signup' | 'signin' | 'code';
/** form: the email form. code: waiting for a sign-in code. confirm: waiting for a new account's confirmation code. */
type Step = 'form' | 'code' | 'confirm';

export interface SignInOptions {
  /** Starts every element id in the box (acctEmail, siEmail...). */
  prefix: string;
  /** Draws the page again (with the box in it) when the box changes. */
  redraw: () => void;
  /** Counts how far a signed-out visitor got (the owner's stats): 'code' when they try a way to sign in. */
  track?: (step: 'signin' | 'code') => void;
}

export interface SignInBox {
  /** The box. lead: the line saying why to sign in. warn: shown first (the in-app browser notice). codeNote: under the code box. */
  html(lead: string, extra?: { warn?: string; codeNote?: string }): string;
  /** Handles the box's forms. True if the form was the box's. */
  submit(form: HTMLFormElement): boolean;
  /** Keeps what's typed, so a redraw doesn't lose it. True if the box was the box's. */
  input(el: HTMLInputElement): boolean;
  /** Handles the box's buttons. True if the button was the box's. */
  click(btn: HTMLElement): boolean;
  /** Back to the email form (on sign-in or sign-out), forgetting the password and code. */
  reset(msg?: string): void;
  /** The element to focus when the box opens. */
  focusTarget(): HTMLInputElement | null;
  /** Something is under way (a code being sent, a sign-in being checked). */
  busy(): boolean;
}

const esc = (t: string): string => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const validEmail = (e: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const LOGO: Record<Provider, string> = {
  google: '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>',
  apple: '<svg viewBox="0 0 814 1000" width="16" height="19" aria-hidden="true"><path fill="currentColor" d="M788 341c-6 4-108 62-108 190 0 149 131 201 135 203-1 3-21 72-69 142-43 62-88 124-156 124s-86-40-164-40c-77 0-104 41-167 41s-106-57-156-128C45 789 0 664 0 546c0-190 124-291 245-291 65 0 118 42 159 42 39 0 100-45 174-45 28 0 130 3 197 99zM554 159c31-37 53-88 53-139 0-7-1-14-2-20-50 2-110 34-146 76-28 32-55 83-55 135 0 8 1 16 2 18 3 1 9 2 14 2 45 0 102-30 134-72z"/></svg>',
};

export function createSignIn(o: SignInOptions): SignInBox {
  const p = o.prefix;
  const S = {
    step: 'form' as Step,
    // A browser that has had an account starts on "Sign in"; a new one on "Create account".
    mode: (wasMember() ? 'signin' : 'signup') as Mode,
    email: '', password: '', code: '',
    busy: false, msg: '', err: false,
    passkeys: false, providers: [] as Provider[],
  };
  const say = (msg: string, err = true): void => { S.msg = msg; S.err = err; o.redraw(); };

  void passkeysAvailable().then(on => { S.passkeys = on; o.redraw(); });
  void providersAvailable().then(list => { S.providers = list; o.redraw(); });
  // Back from Google or Apple without a sign-in (cancelled, or it failed): say so.
  const back = oauthReturnError();
  if (back) { S.msg = back; S.err = true; }

  function formHTML(): string {
    const dis = S.busy ? 'disabled' : '';
    const oauth = S.providers.length
      ? `<div class="acct-oauth">${S.providers.map(pr => `<button type="button" class="btn oauth oauth-${pr}" id="${p}Oauth-${pr}" data-oauth="${pr}" ${dis}>${LOGO[pr]}<span>Continue with ${providerName(pr)}</span></button>`).join('')}</div>
        <div class="acct-or" aria-hidden="true"><span>or use your email</span></div>`
      : '';
    const pw = S.mode !== 'code'
      ? `<label class="sr" for="${p}Password">Password</label>
        <input type="password" id="${p}Password" autocomplete="${S.mode === 'signup' ? 'new-password' : 'current-password'}" placeholder="${S.mode === 'signup' ? `Choose a password (${MIN_PASSWORD}+ characters)` : 'Password'}" value="${esc(S.password)}" ${S.mode === 'signup' ? `minlength="${MIN_PASSWORD}"` : ''}>`
      : '';
    const label = S.busy
      ? (S.mode === 'code' ? 'Sending…' : S.mode === 'signup' ? 'Making your account…' : 'Signing in…')
      : (S.mode === 'code' ? 'Email me a code' : S.mode === 'signup' ? 'Create account' : 'Sign in');
    const links = S.mode === 'signup'
      ? `<span>Have an account? <button type="button" class="linkbtn" id="${p}ToSignin">Sign in</button></span><button type="button" class="linkbtn" id="${p}ToCode">Email me a code instead</button>`
      : S.mode === 'signin'
        ? `<span>New here? <button type="button" class="linkbtn" id="${p}ToSignup">Create an account</button></span><button type="button" class="linkbtn" id="${p}ToCode">Forgot it? Email me a code</button>`
        : `<button type="button" class="linkbtn" id="${p}ToPassword">Use a password instead</button>`;
    return `${oauth}<form class="acct-form acct-stack" id="${p}EmailForm" data-mode="${S.mode}" novalidate>
        <label class="sr" for="${p}Email">Email</label>
        <input type="email" id="${p}Email" autocomplete="${S.mode === 'code' ? 'email' : 'username'}" inputmode="email" placeholder="you@example.com" value="${esc(S.email)}" required>
        ${pw}
        <button class="btn" type="submit" ${dis}>${label}</button>
      </form>
      <p class="acct-alt">${links}</p>${S.passkeys ? `<button type="button" class="btn ghost acct-pk-btn" id="${p}Passkey" ${dis}>Sign in with a passkey</button>` : ''}`;
  }

  function codeHTML(codeNote: string): string {
    const lead = S.step === 'confirm'
      ? `We sent an email to <b>${esc(S.email)}</b> to confirm it’s yours. Enter the code from it, or tap its link. It can take a minute to arrive, so check spam too.`
      : `We sent a sign-in code to <b>${esc(S.email)}</b>. Enter it here and this browser stays signed in. It can take a minute to arrive, so check spam too.`;
    return `<p class="acct-lead">${lead}</p>
      <form class="acct-form" id="${p}CodeForm" novalidate>
        <label class="sr" for="${p}Code">Code from the email</label>
        <input id="${p}Code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="Code from the email" value="${esc(S.code)}">
        <button class="btn" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Checking…' : S.step === 'confirm' ? 'Confirm' : 'Sign in'}</button>
      </form>
      <p class="acct-alt"><button type="button" class="linkbtn" id="${p}Back">Use a different email</button></p>${codeNote}`;
  }

  /** Read the boxes now: autofill doesn't always fire input events. */
  function readForm(): void {
    const e = $q<HTMLInputElement>(`#${p}Email`), pw = $q<HTMLInputElement>(`#${p}Password`);
    if (e) S.email = e.value.trim();
    if (pw) S.password = pw.value;
  }

  async function sendCode(): Promise<void> {
    if (!validEmail(S.email)) { say('Enter the email address you want to sign in with.'); $q<HTMLInputElement>(`#${p}Email`)?.focus(); return; }
    o.track?.('code');
    S.busy = true; S.msg = ''; o.redraw();
    const err = await sendLink(S.email);
    S.busy = false;
    if (err) { say(err); return; }
    S.step = 'code'; S.code = ''; S.msg = ''; o.redraw();
    $q<HTMLInputElement>(`#${p}Code`)?.focus();
  }

  async function onForm(): Promise<void> {
    readForm();
    if (S.mode === 'code') { await sendCode(); return; }
    if (!validEmail(S.email)) { say('Enter your email address.'); return; }
    if (!S.password) { say(S.mode === 'signup' ? 'Choose a password.' : 'Enter your password.'); return; }
    if (S.mode === 'signup' && S.password.length < MIN_PASSWORD) { say(`Pick a password with at least ${MIN_PASSWORD} characters.`); return; }
    o.track?.('code');
    S.busy = true; S.msg = ''; o.redraw();
    if (S.mode === 'signin') {
      const err = await passwordSignIn(S.email, S.password);
      S.busy = false;
      if (err) say(err); else o.redraw(); // on success, watchAuth takes over
      return;
    }
    const { error, confirm } = await passwordSignUp(S.email, S.password);
    S.busy = false;
    if (error) { say(error); return; }
    if (confirm) { S.step = 'confirm'; S.code = ''; S.msg = ''; o.redraw(); $q<HTMLInputElement>(`#${p}Code`)?.focus(); return; }
    o.redraw(); // signed in; watchAuth takes over
  }

  async function onCode(): Promise<void> {
    const code = ($q<HTMLInputElement>(`#${p}Code`)?.value || S.code).replace(/\D/g, '');
    if (code.length < 6) { say('Enter the code from the email.'); return; }
    S.busy = true; S.msg = ''; o.redraw();
    const err = S.step === 'confirm' ? await verifySignupCode(S.email, code) : await verifyCode(S.email, code);
    S.busy = false;
    if (err) say(err); else o.redraw(); // on success, watchAuth takes over
  }

  async function onPasskey(): Promise<void> {
    o.track?.('code');
    S.busy = true; S.msg = ''; o.redraw();
    const err = await passkeySignIn();
    S.busy = false;
    if (err) say(err); else o.redraw(); // '' means the prompt was closed
  }

  async function onOauth(pr: Provider): Promise<void> {
    o.track?.('code');
    S.busy = true; S.msg = ''; o.redraw();
    const err = await oauthSignIn(pr);
    // On success the page is leaving for Google or Apple; stay busy so it can't be tapped twice.
    if (err) { S.busy = false; say(err); }
  }

  function setMode(m: Mode): void {
    readForm();
    S.mode = m; S.msg = '';
    o.redraw();
    $q<HTMLInputElement>(S.email && m !== 'code' ? `#${p}Password` : `#${p}Email`)?.focus();
  }

  return {
    html(lead, extra = {}) {
      const note = S.msg ? `<p class="acct-msg${S.err ? ' err' : ''}" role="status">${esc(S.msg)}</p>` : '';
      const warn = extra.warn || '';
      if (S.step !== 'form') return `${warn}${codeHTML(extra.codeNote || '')}${note}`;
      return `${warn}<p class="acct-lead">${lead}</p>${formHTML()}${note}`;
    },
    submit(form) {
      if (form.id === `${p}EmailForm`) { void onForm(); return true; }
      if (form.id === `${p}CodeForm`) { void onCode(); return true; }
      return false;
    },
    input(el) {
      if (el.id === `${p}Email`) { S.email = el.value; return true; }
      if (el.id === `${p}Password`) { S.password = el.value; return true; }
      if (el.id === `${p}Code`) { S.code = el.value; return true; }
      return false;
    },
    click(btn) {
      const id = btn.id;
      if (btn.dataset.oauth && id.startsWith(p)) { void onOauth(btn.dataset.oauth as Provider); return true; }
      if (id === `${p}Passkey`) { void onPasskey(); return true; }
      if (id === `${p}Back`) { S.step = 'form'; S.code = ''; S.msg = ''; o.redraw(); return true; }
      if (id === `${p}ToSignin`) { setMode('signin'); return true; }
      if (id === `${p}ToSignup`) { setMode('signup'); return true; }
      if (id === `${p}ToPassword`) { setMode(wasMember() ? 'signin' : 'signup'); return true; }
      if (id === `${p}ToCode`) {
        readForm();
        S.mode = 'code'; S.msg = '';
        // They asked for a code: send it now if the email is already there.
        if (validEmail(S.email)) void sendCode(); else { o.redraw(); $q<HTMLInputElement>(`#${p}Email`)?.focus(); }
        return true;
      }
      return false;
    },
    reset(msg = '') {
      S.step = 'form'; S.busy = false; S.code = ''; S.password = ''; S.msg = msg; S.err = false;
      if (S.mode === 'code') S.mode = 'signin';
      else if (S.mode === 'signup' && wasMember()) S.mode = 'signin';
    },
    focusTarget() {
      if (S.step !== 'form') return $q<HTMLInputElement>(`#${p}Code`);
      return $q<HTMLInputElement>(S.email && S.mode !== 'code' ? `#${p}Password` : `#${p}Email`);
    },
    busy: () => S.busy,
  };
}

// ---- the ready-made box for the instructor view and the join page ----

let box: SignInBox | null = null;
let redraw = (): void => { /* set by initSignIn */ };

/** redraw: draws the page again (with the box in it) when the box changes. */
export function initSignIn(onChange: () => void): void {
  redraw = onChange;
  box = createSignIn({ prefix: 'si', redraw: () => redraw() });
}

/** Back to the email form (on sign-in or sign-out). */
export function resetSignIn(): void { box?.reset(); }

/** lead: the line above the email box, saying why to sign in. */
export function signInHTML(lead: string): string {
  return box ? `<div class="acct si-box">${box.html(lead)}</div>` : '';
}

export const signInSubmit = (form: HTMLFormElement): boolean => !!box?.submit(form);
export const signInInput = (input: HTMLInputElement): boolean => !!box?.input(input);
export const signInClick = (btn: HTMLElement): boolean => !!box?.click(btn);
