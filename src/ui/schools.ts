// The pilot request form on the For schools page (/schools/). A request goes into the feedback
// table like any other message, tagged context.kind = 'pilot', so it shows on the owner's stats
// dashboard with the rest. The form is drawn once; sending only updates the button and the
// message under it, so nothing typed is ever wiped.
import { accountsOn } from '../data/supabase.ts';
import { sendFeedback } from '../data/admin.ts';
import { $, $q } from './dom.ts';
import { KINDS, SIZES, checkPilot, pilotMessage, type PilotRequest } from '../data/pilot.ts';

const opt = (v: string, label: string): string => `<option value="${v}">${label}</option>`;

function formHTML(): string {
  return `<form id="pilotReq" novalidate>
    <div class="fld"><label for="pName">Your name</label><input id="pName" maxlength="80" autocomplete="name" required></div>
    <div class="fld"><label for="pOrg">School or card room</label><input id="pOrg" maxlength="120" autocomplete="organization" required></div>
    <div class="fld"><label for="pKind">It’s a</label><select id="pKind">${Object.entries(KINDS).map(([v, l]) => opt(v, l)).join('')}</select></div>
    <div class="fld"><label for="pEmail">Email</label><input id="pEmail" type="email" maxlength="200" autocomplete="email" inputmode="email" required></div>
    <div class="fld"><label for="pSize">Students in a class <span class="opt">(optional)</span></label><select id="pSize">${opt('', 'Choose')}${SIZES.map(s => opt(s, s)).join('')}</select></div>
    <div class="fld"><label for="pNotes">What games do you teach, and anything else I should know <span class="opt">(optional)</span></label><textarea id="pNotes" rows="4" maxlength="1500"></textarea></div>
    <button class="btn" type="submit" id="pSend">Ask about a pilot</button>
    <p class="acct-msg err" id="pMsg" role="alert" hidden></p>
  </form>`;
}

const val = (id: string): string => ($q<HTMLInputElement>(`#${id}`)?.value || '').trim();

function say(msg: string): void {
  const m = $('#pMsg');
  m.textContent = msg;
  m.hidden = !msg;
}

async function send(e: Event): Promise<void> {
  e.preventDefault();
  const btn = $q<HTMLButtonElement>('#pSend')!;
  if (btn.disabled) return;
  const r: PilotRequest = {
    name: val('pName'), org: val('pOrg'), kind: (val('pKind') || 'school') as PilotRequest['kind'],
    email: val('pEmail'), size: val('pSize'), notes: val('pNotes'),
  };
  const bad = checkPilot(r);
  if (bad) { say(bad.msg); $q<HTMLInputElement>(`#${bad.field}`)?.focus(); return; }
  say('');
  btn.disabled = true; btn.textContent = 'Sending…';
  const err = await sendFeedback(pilotMessage(r), r.email, {
    kind: 'pilot', page: 'schools', name: r.name, org: r.org, org_kind: r.kind, size: r.size || null,
    width: window.innerWidth, ua: navigator.userAgent.slice(0, 180),
  });
  if (err) { btn.disabled = false; btn.textContent = 'Ask about a pilot'; say(err); return; }
  $('#pilotForm').innerHTML = `<p class="sch-sent" role="status"><b>Thanks, got it.</b>I’ll email ${r.email.replace(/[&<>"]/g, '')} to set up ${r.org.replace(/[&<>"]/g, '')}.</p>`;
}

export function initSchools(): void {
  const box = $('#pilotForm');
  if (!accountsOn) {
    box.innerHTML = `<p>The pilot form needs accounts, which aren’t set up on this copy of FeltReady.</p>`;
    return;
  }
  box.innerHTML = formHTML();
  $('#pilotReq').addEventListener('submit', e => { void send(e); });
  // A fix clears the last complaint, so it doesn't sit under a form that's now right.
  $('#pilotReq').addEventListener('input', () => say(''));
}
