// Sign-in box in the settings sheet, the header "Sign in" link, and switching stores on sign-in/out.
import { memberEmail, storeMode, switchStore } from '../app.ts';
import { accountsOn, supabase } from '../data/supabase.ts';
import { linkVisitor, signinStep } from '../data/visits.ts';
import { addPasskey, listPasskeys, passkeySignIn, passkeysAvailable, sendLink, signOut, verifyCode, watchAuth, type PasskeyInfo } from '../data/auth.ts';
import { inAppBrowser, regularBrowser } from '../data/browser.ts';
import { clearGuestStats, guestStore, memberStore, store } from '../data/store.ts';
import { $, $q, sheetOpen, showSheet } from './dom.ts';
import { applySettings } from './settings.ts';
import { render } from './render.ts';
import { refreshSpots } from './weakSpots.ts';
import { refreshDaily } from './daily.ts';
import { renderFeedback } from './feedback.ts';
import { openStats } from './stats.ts';
import { isAdmin } from '../data/admin.ts';
import { isInstructor } from '../data/teach.ts';
import { leaveClass, myClasses, type MyClass } from '../data/classes.ts';

type Step = 'email' | 'code';
const ui = {
  step: 'email' as Step, email: '', busy: false, msg: '', err: false, loading: false,
  /** Passkeys are on for the project and this browser can use them. */
  passkeys: false,
  /** The member's passkeys (null until loaded, or if they couldn't be). */
  keys: null as PasskeyInfo[] | null,
  /** The member can see the stats dashboard. */
  admin: false,
  /** The member runs or teaches at a school, so gets a link to the instructor view. */
  teach: false,
  /** Classes the member has joined (null until loaded, or if they couldn't be). */
  classes: null as MyClass[] | null,
  /** The class they asked to leave, waiting for them to confirm. */
  leaving: '',
};
const shortDate = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Signed in: offer a passkey, or say which ones the account has. */
function passkeyHTML(): string {
  if (!ui.passkeys || !ui.keys) return '';
  if (!ui.keys.length) {
    return `<div class="acct-pk"><p><b>Sign in faster next time.</b> Add a passkey and sign in with Face ID, Touch ID, or your phone’s screen lock. No code to wait for.</p>
      <button class="btn" id="acctAddPasskey" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Waiting for your device…' : 'Add a passkey'}</button></div>`;
  }
  const list = ui.keys.map(k => `${esc(k.friendly_name || 'Passkey')} (added ${shortDate(k.created_at)})`).join(', ');
  return `<p class="acct-note">Passkey${ui.keys.length > 1 ? 's' : ''}: ${list}. <button class="linkbtn" id="acctAddPasskey">Add one for another device</button></p>`;
}

const esc = (t: string): string => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Signed in and in a class or more: each one, with a way to leave. */
function classesHTML(): string {
  if (!ui.classes?.length) return '';
  return `<div class="acct-classes"><h3>Your classes</h3><ul>${ui.classes.map(c => {
    const asking = ui.leaving === c.class_id;
    return `<li><div class="acct-cls"><span><b>${esc(c.class_name)}</b><small>${esc(c.org_name)} · your instructor sees you as ${esc(c.name)}</small></span>${asking ? '' : `<button class="linkbtn" data-leave="${c.class_id}">Leave</button>`}</div>
      ${asking ? `<div class="confirm"><p>Leave ${esc(c.class_name)}? ${esc(c.org_name)} stops seeing your answers right away. You can rejoin with the code.</p>
        <div class="confirm-go"><button class="btn small" data-leave-yes="${c.class_id}" ${ui.busy ? 'disabled' : ''}>Leave the class</button><button class="linkbtn" data-leave-no>Cancel</button></div></div>` : ''}</li>`;
  }).join('')}</ul></div>`;
}

export function renderAccount(): void {
  const box = $('#acct'), link = $('#signin');
  if (!accountsOn) { box.hidden = true; link.hidden = true; return; }
  box.hidden = false;
  const mode = storeMode();
  link.hidden = mode !== 'guest';
  const note = ui.msg ? `<p class="acct-msg${ui.err ? ' err' : ''}" role="status">${esc(ui.msg)}</p>` : '';
  // In an app's built-in browser (the Google app, Facebook...) a sign-in doesn't stick. Say so.
  const app = inAppBrowser(navigator.userAgent);
  const warn = app ? `<p class="acct-warn">You’re in ${app}’s built-in browser, which forgets sign-ins. To stay signed in, open feltready.com in ${regularBrowser(navigator.userAgent)}. Look for “Open in browser” in the app’s menu.</p>` : '';
  if (ui.loading) { box.innerHTML = `<p class="muted">Loading your account…</p>`; return; }
  if (mode === 'member') {
    box.innerHTML = `${warn}<div class="acct-row"><p>Signed in as <b>${esc(memberEmail())}</b>. Settings and stats save to your account.</p><button class="btn ghost" id="signout">Sign out</button></div>${passkeyHTML()}${classesHTML()}${ui.teach ? '<p class="acct-note acct-teach"><a class="linkbtn" href="/teach/">Open your instructor view</a></p>' : ''}${ui.admin ? '<p class="acct-note"><button class="linkbtn" id="acctStats">Open the stats dashboard</button></p>' : ''}${note}`;
    return;
  }
  if (ui.step === 'email') {
    box.innerHTML = `${warn}<p class="acct-lead">Sign in to set a timer, pick your blinds, and keep your stats on any device. It's free, and there's no password: we email you a code.</p>
      <form class="acct-form" id="acctEmailForm" novalidate>
        <label class="sr" for="acctEmail">Email</label>
        <input type="email" id="acctEmail" autocomplete="email" inputmode="email" placeholder="you@example.com" value="${esc(ui.email)}" required>
        <button class="btn" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Sending…' : 'Email me a code'}</button>
      </form>${ui.passkeys ? `<div class="acct-or" aria-hidden="true"><span>or</span></div>
      <button class="btn ghost acct-pk-btn" id="acctPasskey" ${ui.busy ? 'disabled' : ''}>Sign in with a passkey</button>` : ''}${note}`;
  } else {
    // The code signs in this browser, so it stays signed in. The emailed link can open in a
    // different browser on a phone (often the Google app's), which is why it's the backup.
    box.innerHTML = `${warn}<p class="acct-lead">We sent a sign-in code to <b>${esc(ui.email)}</b>. Enter it here and this browser stays signed in. It can take a minute to arrive, so check spam too.</p>
      <form class="acct-form" id="acctCodeForm" novalidate>
        <label class="sr" for="acctCode">Code from the email</label>
        <input id="acctCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="Code from the email">
        <button class="btn" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Checking…' : 'Sign in'}</button>
      </form>${note}
      <p class="acct-alt"><button class="linkbtn" id="acctBack">Use a different email</button></p>
      <p class="acct-note">The email has a sign-in link too. On a phone it can open in another app’s browser, which won’t keep you signed in here.</p>`;
  }
}

function say(msg: string, err = false): void { ui.msg = msg; ui.err = err; renderAccount(); }

/** Open the settings sheet on the sign-in box. */
export function openAccount(): void {
  if (storeMode() === 'guest') signinStep('signin');
  if (!sheetOpen('sheet')) showSheet('sheet');
  window.scrollTo({ top: 0, behavior: 'auto' });
  setTimeout(() => ($q<HTMLInputElement>('#acctEmail') || $q<HTMLInputElement>('#acctCode'))?.focus(), 30);
}

async function onEmail(): Promise<void> {
  const email = ($q<HTMLInputElement>('#acctEmail')?.value || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { ui.email = email; say('Enter the email address you want to sign in with.', true); return; }
  ui.email = email; ui.busy = true; ui.msg = ''; renderAccount();
  const err = await sendLink(email);
  ui.busy = false;
  if (err) { say(err, true); return; }
  signinStep('code');
  ui.step = 'code'; say('');
  $q<HTMLInputElement>('#acctCode')?.focus();
}

async function onPasskeySignIn(): Promise<void> {
  signinStep('code');
  ui.busy = true; ui.msg = ''; renderAccount();
  const err = await passkeySignIn();
  ui.busy = false;
  if (err) say(err, true); // '' means the prompt was closed; null means signed in and watchAuth takes over
  else renderAccount();
}

async function onAddPasskey(): Promise<void> {
  ui.busy = true; ui.msg = ''; renderAccount();
  const err = await addPasskey();
  ui.busy = false;
  if (err === null) { ui.keys = (await listPasskeys()) ?? ui.keys; say('Passkey added. Next time, tap “Sign in with a passkey.”'); }
  else if (err) say(err, true);
  else renderAccount();
}

/** Load the member's passkeys so the box can offer one. */
async function loadKeys(): Promise<void> {
  ui.keys = null;
  if (storeMode() !== 'member' || !ui.passkeys) return;
  ui.keys = await listPasskeys();
  renderAccount();
}

async function loadClasses(): Promise<void> {
  ui.classes = null; ui.leaving = '';
  if (storeMode() !== 'member') return;
  try { ui.classes = await myClasses(); } catch (e) { console.warn('FeltReady: my_classes', e); }
  renderAccount();
}

async function onLeave(classId: string): Promise<void> {
  const c = ui.classes?.find(k => k.class_id === classId);
  ui.busy = true; renderAccount();
  try {
    await leaveClass(classId);
    ui.busy = false;
    await loadClasses();
    say(`You left ${c?.class_name || 'the class'}.`);
  } catch (e) {
    console.warn('FeltReady: leave_class', e);
    ui.busy = false;
    say('Couldn’t leave the class. Check your connection and try again.', true);
  }
}

async function onCode(): Promise<void> {
  const code = ($q<HTMLInputElement>('#acctCode')?.value || '').replace(/\D/g, '');
  if (code.length < 6) { say('Enter the code from the email.', true); return; }
  ui.busy = true; ui.msg = ''; renderAccount();
  const err = await verifyCode(ui.email, code);
  ui.busy = false;
  if (err) say(err, true); // on success, watchAuth takes over
  else renderAccount();
}

export function initAccount(): void {
  renderAccount();
  if (!accountsOn) return;
  $('#signin').addEventListener('click', openAccount);
  void passkeysAvailable().then(on => { ui.passkeys = on; renderAccount(); void loadKeys(); });
  const box = $('#acct');
  box.addEventListener('submit', e => {
    e.preventDefault();
    const id = (e.target as HTMLElement).id;
    if (id === 'acctEmailForm') void onEmail();
    if (id === 'acctCodeForm') void onCode();
  });
  box.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button'); if (!t) return;
    if (t.id === 'acctBack') { ui.step = 'email'; say(''); }
    if (t.id === 'acctPasskey') void onPasskeySignIn();
    if (t.id === 'acctAddPasskey') void onAddPasskey();
    if (t.id === 'acctStats') openStats();
    if (t.dataset.leave) { ui.leaving = t.dataset.leave; ui.msg = ''; renderAccount(); }
    if (t.hasAttribute('data-leave-no')) { ui.leaving = ''; renderAccount(); }
    if (t.dataset.leaveYes) void onLeave(t.dataset.leaveYes);
    if (t.id === 'signout') {
      store.close?.();
      void signOut();
    }
  });

  watchAuth(async m => {
    if (m) {
      ui.loading = true; renderAccount();
      try {
        void linkVisitor((fn, args) => supabase!.rpc(fn, args));
        const ms = await memberStore(m.id, m.email);
        switchStore(ms);
        clearGuestStats();
        ui.step = 'email'; ui.msg = '';
      } catch {
        ui.msg = 'Couldn’t load your account. Check your connection and reload.'; ui.err = true;
      }
      ui.loading = false;
    } else if (storeMode() !== 'guest') {
      switchStore(guestStore);
      ui.step = 'email'; ui.msg = 'Signed out.'; ui.err = false;
    }
    // A hand in progress keeps going; new settings apply from the next deal.
    applySettings(); render(); renderAccount(); refreshSpots(); refreshDaily(); renderFeedback();
    void loadKeys();
    ui.admin = false; ui.teach = false;
    void loadClasses();
    if (storeMode() === 'member') {
      void isAdmin().then(a => { ui.admin = a; renderAccount(); });
      void isInstructor().then(t => { ui.teach = t; renderAccount(); });
    }
  });
}
