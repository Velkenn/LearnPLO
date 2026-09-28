// First visit: one screen that says what FeltReady is, above the table. It goes away for good
// once the visitor deals a hand or opens the daily challenge, and never shows to members or to
// anyone who has already answered questions on this device.
import { app, startedBefore, storeMode } from '../app.ts';
import { accountsOn } from '../data/supabase.ts';
import { $ } from './dom.ts';
import { startHand } from '../game.ts';
import { openDaily } from './daily.ts';

const KEY = 'plo-dd-welcomed';
const seen = (): boolean => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export function dismissWelcome(): void {
  try { localStorage.setItem(KEY, '1'); } catch { /* private window */ }
  $('#welcome').hidden = true;
}

export function renderWelcome(): void {
  const box = $('#welcome');
  const show = !app.S && !seen() && storeMode() !== 'member' && !startedBefore();
  if (!show) { if (app.S && !box.hidden) dismissWelcome(); box.hidden = true; return; }
  if (!box.hidden && box.innerHTML) return;
  box.innerHTML = `<h2>Practice dealing pot limit Omaha</h2>
    <p>A six-handed hand plays out on its own. You’re the dealer:</p>
    <ul class="welcome-list">
      <li><b>Call the pot.</b> A player says “Pot” and you announce the raise.</li>
      <li><b>Build side pots.</b> Someone’s all in for less, so you split this round’s bets into the main pot and a side pot.</li>
      <li><b>Read the showdown.</b> Pick the winning hand and ship it, or chop it.</li>
    </ul>
    <p class="muted">Every answer is checked and explained. Free, and no account needed to practice.</p>
    <div class="welcome-go"><button class="btn" id="welcomeDeal">Deal a hand</button>${accountsOn ? '<button class="btn ghost" id="welcomeDaily">Today’s challenge</button>' : ''}</div>`;
  box.hidden = false;
}

export function initWelcome(): void {
  $('#welcome').addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button'); if (!t) return;
    if (t.id === 'welcomeDeal') { dismissWelcome(); startHand(); window.scrollTo({ top: 0, behavior: 'auto' }); }
    if (t.id === 'welcomeDaily') { dismissWelcome(); openDaily(); }
  });
  renderWelcome();
}
