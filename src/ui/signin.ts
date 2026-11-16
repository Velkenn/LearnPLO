// A small sign-in box (emailed code, or a passkey) for the pages without the game shell's
// account box: the instructor view (/teach/) and the join page (/join/). One per page.
// The page draws it with signInHTML() and passes its form submits, typing and button clicks to
// signInSubmit() / signInInput() / signInClick(); a successful sign-in reaches the page through watchAuth.
import { passkeySignIn, passkeysAvailable, sendLink, verifyCode } from '../data/auth.ts';
import { $q } from './dom.ts';

const S = { step: 'email' as 'email' | 'code', email: '', code: '', busy: false, msg: '', err: false, passkeys: false };
let redraw = (): void => { /* set by initSignIn */ };

const esc = (t: string): string => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** redraw: draws the page again (with the box in it) when the box changes. */
export function initSignIn(onChange: () => void): void {
  redraw = onChange;
  void passkeysAvailable().then(on => { S.passkeys = on; redraw(); });
}

/** Back to the email step (on sign-in or sign-out). */
export function resetSignIn(): void { S.step = 'email'; S.msg = ''; S.busy = false; S.code = ''; }

/** lead: the line above the email box, saying why to sign in. */
export function signInHTML(lead: string): string {
  const note = S.msg ? `<p class="acct-msg${S.err ? ' err' : ''}" role="status">${esc(S.msg)}</p>` : '';
  if (S.step === 'code') {
    return `<div class="acct si-box"><p class="acct-lead">We sent a sign-in code to <b>${esc(S.email)}</b>. Enter it here. It can take a minute to arrive, so check spam too.</p>
      <form class="acct-form" id="siCodeForm" novalidate>
        <label class="sr" for="siCode">Code from the email</label>
        <input id="siCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="Code from the email" value="${esc(S.code)}">
        <button class="btn" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Checking…' : 'Sign in'}</button>
      </form>${note}
      <p class="acct-alt"><button class="linkbtn" id="siBack">Use a different email</button></p></div>`;
  }
  return `<div class="acct si-box"><p class="acct-lead">${lead}</p>
    <form class="acct-form" id="siEmailForm" novalidate>
      <label class="sr" for="siEmail">Email</label>
      <input type="email" id="siEmail" autocomplete="email" inputmode="email" placeholder="you@example.com" value="${esc(S.email)}" required>
      <button class="btn" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Sending…' : 'Email me a code'}</button>
    </form>${S.passkeys ? `<div class="acct-or" aria-hidden="true"><span>or</span></div>
    <button class="btn ghost acct-pk-btn" id="siPasskey" ${S.busy ? 'disabled' : ''}>Sign in with a passkey</button>` : ''}${note}</div>`;
}

function say(msg: string, err = true): void { S.msg = msg; S.err = err; redraw(); }

async function onEmail(): Promise<void> {
  const email = ($q<HTMLInputElement>('#siEmail')?.value || '').trim();
  S.email = email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say('Enter the email address you want to sign in with.'); return; }
  S.busy = true; S.msg = ''; redraw();
  const err = await sendLink(email);
  S.busy = false;
  if (err) { say(err); return; }
  S.step = 'code'; S.code = ''; S.msg = ''; redraw();
  $q<HTMLInputElement>('#siCode')?.focus();
}

async function onCode(): Promise<void> {
  const code = ($q<HTMLInputElement>('#siCode')?.value || '').replace(/\D/g, '');
  if (code.length < 6) { say('Enter the code from the email.'); return; }
  S.busy = true; S.msg = ''; redraw();
  const err = await verifyCode(S.email, code);
  S.busy = false;
  if (err) say(err); else redraw(); // on success, watchAuth takes over
}

async function onPasskey(): Promise<void> {
  S.busy = true; S.msg = ''; redraw();
  const err = await passkeySignIn();
  S.busy = false;
  if (err) say(err); else redraw(); // '' means the prompt was closed
}

/** Handles the box's forms. True if the form was the box's. */
export function signInSubmit(form: HTMLFormElement): boolean {
  if (form.id === 'siEmailForm') { void onEmail(); return true; }
  if (form.id === 'siCodeForm') { void onCode(); return true; }
  return false;
}

/** Keeps what's typed, so a redraw doesn't lose it. True if the box was the sign-in box's. */
export function signInInput(input: HTMLInputElement): boolean {
  if (input.id === 'siEmail') { S.email = input.value; return true; }
  if (input.id === 'siCode') { S.code = input.value; return true; }
  return false;
}

/** Handles the box's buttons. True if the button was the box's. */
export function signInClick(btn: HTMLElement): boolean {
  if (btn.id === 'siBack') { S.step = 'email'; S.code = ''; S.msg = ''; redraw(); return true; }
  if (btn.id === 'siPasskey') { void onPasskey(); return true; }
  return false;
}
