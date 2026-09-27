// Sign-in box in the settings sheet, the header "Sign in" link, and switching stores on sign-in/out.
import { memberEmail, storeMode, switchStore } from '../app.ts';
import { accountsOn } from '../data/supabase.ts';
import { sendLink, signOut, verifyCode, watchAuth } from '../data/auth.ts';
import { clearGuestStats, guestStore, memberStore, store } from '../data/store.ts';
import { $, $q, sheetOpen, showSheet } from './dom.ts';
import { applySettings } from './settings.ts';
import { render } from './render.ts';
import { refreshSpots } from './weakSpots.ts';

type Step = 'email' | 'code';
const ui = { step: 'email' as Step, email: '', busy: false, msg: '', err: false, loading: false, showCode: false };

const esc = (t: string): string => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function renderAccount(): void {
  const box = $('#acct'), link = $('#signin');
  if (!accountsOn) { box.hidden = true; link.hidden = true; return; }
  box.hidden = false;
  const mode = storeMode();
  link.hidden = mode !== 'guest';
  const note = ui.msg ? `<p class="acct-msg${ui.err ? ' err' : ''}" role="status">${esc(ui.msg)}</p>` : '';
  if (ui.loading) { box.innerHTML = `<p class="muted">Loading your account…</p>`; return; }
  if (mode === 'member') {
    box.innerHTML = `<div class="acct-row"><p>Signed in as <b>${esc(memberEmail())}</b>. Settings and stats save to your account.</p><button class="btn ghost" id="signout">Sign out</button></div>${note}`;
    return;
  }
  if (ui.step === 'email') {
    box.innerHTML = `<p class="acct-lead">Sign in to set a timer, pick your blinds, and keep your stats on any device. It's free, and there's no password.</p>
      <form class="acct-form" id="acctEmailForm" novalidate>
        <label class="sr" for="acctEmail">Email</label>
        <input type="email" id="acctEmail" autocomplete="email" inputmode="email" placeholder="you@example.com" value="${esc(ui.email)}" required>
        <button class="btn" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Sending…' : 'Email me a sign-in link'}</button>
      </form>${note}`;
  } else {
    // The link always works. A code only appears if the email template includes one.
    const codeForm = ui.showCode ? `
      <form class="acct-form" id="acctCodeForm" novalidate>
        <label class="sr" for="acctCode">Code from the email</label>
        <input id="acctCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="Code">
        <button class="btn" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Checking…' : 'Sign in'}</button>
      </form>` : '';
    box.innerHTML = `<p class="acct-lead">We sent a sign-in link to <b>${esc(ui.email)}</b>. Open it on this device and you're in. It can take a minute to arrive, so check spam too.</p>${codeForm}
      <p class="acct-alt">${ui.showCode ? '' : '<button class="linkbtn" id="acctShowCode">Have a code?</button> '}<button class="linkbtn" id="acctBack">Use a different email</button></p>${note}`;
  }
}

function say(msg: string, err = false): void { ui.msg = msg; ui.err = err; renderAccount(); }

/** Open the settings sheet on the sign-in box. */
export function openAccount(): void {
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
  ui.step = 'code'; say('');
  $q<HTMLInputElement>('#acctCode')?.focus();
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
  const box = $('#acct');
  box.addEventListener('submit', e => {
    e.preventDefault();
    const id = (e.target as HTMLElement).id;
    if (id === 'acctEmailForm') void onEmail();
    if (id === 'acctCodeForm') void onCode();
  });
  box.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button'); if (!t) return;
    if (t.id === 'acctBack') { ui.step = 'email'; ui.showCode = false; say(''); }
    if (t.id === 'acctShowCode') { ui.showCode = true; say(''); $q<HTMLInputElement>('#acctCode')?.focus(); }
    if (t.id === 'signout') {
      store.close?.();
      void signOut();
    }
  });

  watchAuth(async m => {
    if (m) {
      ui.loading = true; renderAccount();
      try {
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
    applySettings(); render(); renderAccount(); refreshSpots();
  });
}
