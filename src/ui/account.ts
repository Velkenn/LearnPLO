// Sign-in box in the settings sheet, the header "Sign in" link, and switching stores on sign-in/out.
import { memberEmail, storeMode, switchStore } from '../app.ts';
import { accountsOn, supabase } from '../data/supabase.ts';
import { linkVisitor, signinStep } from '../data/visits.ts';
import { addPasskey, listPasskeys, MIN_PASSWORD, passkeysAvailable, setPassword, signOut, watchAuth, type PasskeyInfo } from '../data/auth.ts';
import { createSignIn } from './signin.ts';
import { inAppBrowser, regularBrowser } from '../data/browser.ts';
import { clearGuestStats, guestStore, memberStore, store } from '../data/store.ts';
import { $, $q, sheetOpen, showSheet } from './dom.ts';
import { applySettings } from './settings.ts';
import { render } from './render.ts';
import { refreshSpots } from './weakSpots.ts';
import { refreshDaily } from './daily.ts';
import { refreshReplies, renderFeedback } from './feedback.ts';
import { openStats } from './stats.ts';
import { isAdmin } from '../data/admin.ts';
import { isInstructor } from '../data/teach.ts';
import { leaveClass, myClasses, type MyClass } from '../data/classes.ts';

const ui = {
  busy: false, msg: '', err: false, loading: false,
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
  /** The set-a-password form is open, and what's typed in it. */
  pwOpen: false, pw: '',
};
// Signed out: Google, Apple, email and password, an emailed code, or a passkey.
const signin = createSignIn({ prefix: 'acct', redraw: () => renderAccount(), track: signinStep });

/** Signed in: set a password (accounts made with a code or Google have none) or change it. */
function passwordHTML(): string {
  if (!ui.pwOpen) return `<p class="acct-note"><button class="linkbtn" id="acctSetPw">Set or change your password</button> to sign in with your email and a password.</p>`;
  return `<form class="acct-form acct-pw" id="acctPwForm" novalidate>
      <input type="email" autocomplete="username" value="${esc(memberEmail())}" hidden>
      <label class="sr" for="acctNewPw">New password</label>
      <input type="password" id="acctNewPw" autocomplete="new-password" minlength="${MIN_PASSWORD}" placeholder="New password (${MIN_PASSWORD}+ characters)" value="${esc(ui.pw)}">
      <button class="btn" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Saving…' : 'Save password'}</button>
    </form>
    <p class="acct-alt"><button class="linkbtn" id="acctPwCancel">Cancel</button></p>`;
}
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
    box.innerHTML = `${warn}<div class="acct-row"><p>Signed in as <b>${esc(memberEmail())}</b>. Settings and stats save to your account.</p><button class="btn ghost" id="signout">Sign out</button></div>${passkeyHTML()}${passwordHTML()}${classesHTML()}${ui.teach ? '<p class="acct-note acct-teach"><a class="linkbtn" href="/teach/">Open your instructor view</a></p>' : ''}${ui.admin ? '<p class="acct-note"><button class="linkbtn" id="acctStats">Open the stats dashboard</button></p>' : ''}${note}`;
    return;
  }
  box.innerHTML = signinHTML(warn) + note;
}

const signinHTML = (warn: string): string => signin.html(
  'Sign in to set a timer, pick your blinds, and keep your stats on any device. It’s free.',
  // The emailed link can open in a different browser on a phone (often the Google app's), which is why the code comes first.
  { warn, codeNote: '<p class="acct-note">The email has a sign-in link too. On a phone it can open in another app’s browser, which won’t keep you signed in here.</p>' },
);

function say(msg: string, err = false): void { ui.msg = msg; ui.err = err; renderAccount(); }

/** Open the settings sheet on the sign-in box. */
export function openAccount(): void {
  if (storeMode() === 'guest') signinStep('signin');
  if (!sheetOpen('sheet')) showSheet('sheet');
  window.scrollTo({ top: 0, behavior: 'auto' });
  setTimeout(() => signin.focusTarget()?.focus(), 30);
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

async function onSetPassword(): Promise<void> {
  const pw = $q<HTMLInputElement>('#acctNewPw')?.value ?? ui.pw;
  if (pw.length < MIN_PASSWORD) { ui.pw = pw; say(`Pick a password with at least ${MIN_PASSWORD} characters.`, true); return; }
  ui.busy = true; ui.msg = ''; renderAccount();
  const err = await setPassword(pw);
  ui.busy = false;
  if (err) { say(err, true); return; }
  ui.pwOpen = false; ui.pw = '';
  say('Password saved. Next time, sign in with your email and password.');
}

export function initAccount(): void {
  renderAccount();
  if (!accountsOn) return;
  $('#signin').addEventListener('click', openAccount);
  void passkeysAvailable().then(on => { ui.passkeys = on; renderAccount(); void loadKeys(); });
  const box = $('#acct');
  box.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    if (signin.submit(f)) { ui.msg = ''; return; }
    if (f.id === 'acctPwForm') void onSetPassword();
  });
  // Keep what's typed, so a redraw (a passkey list or class list loading) doesn't wipe it.
  box.addEventListener('input', e => {
    const t = e.target as HTMLInputElement;
    if (signin.input(t)) return;
    if (t.id === 'acctNewPw') ui.pw = t.value;
  });
  box.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button'); if (!t) return;
    if (signin.click(t)) { ui.msg = ''; return; }
    if (t.id === 'acctSetPw') { ui.pwOpen = true; ui.msg = ''; renderAccount(); $q<HTMLInputElement>('#acctNewPw')?.focus(); }
    if (t.id === 'acctPwCancel') { ui.pwOpen = false; ui.pw = ''; ui.msg = ''; renderAccount(); }
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
        signin.reset(); ui.msg = ''; ui.pwOpen = false; ui.pw = '';
      } catch {
        ui.msg = 'Couldn’t load your account. Check your connection and reload.'; ui.err = true;
      }
      ui.loading = false;
    } else if (storeMode() !== 'guest') {
      switchStore(guestStore);
      signin.reset('Signed out.'); ui.msg = ''; ui.pwOpen = false; ui.pw = '';
    }
    // A hand in progress keeps going; new settings apply from the next deal.
    applySettings(); render(); renderAccount(); refreshSpots(); refreshDaily(); renderFeedback();
    void loadKeys();
    void refreshReplies();
    ui.admin = false; ui.teach = false;
    void loadClasses();
    if (storeMode() === 'member') {
      void isAdmin().then(a => { ui.admin = a; renderAccount(); });
      void isInstructor().then(t => { ui.teach = t; renderAccount(); });
    }
  });
}
