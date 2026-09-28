// Redraws everything from app state: scores, table, ticker, panel, popup, hand history.
import { app, nextHandLabel, storeMode } from '../app.ts';
import { STREETS } from '../config.ts';
import { $, $q } from './dom.ts';
import { renderTable } from './table.ts';
import { quizPanel } from '../drills/potCall.ts';
import { cutPanel } from '../drills/cutPot.ts';
import { readPanel } from '../drills/readHands.ts';
import { renderStrip } from './daily.ts';
import { renderWelcome } from './welcome.ts';

export function renderScores(): void {
  const s = app.stats;
  $('#scores').innerHTML = `<div class="sc"><span>Pots</span><b>${s.pr}/${s.pt}</b></div><div class="sc"><span>Reads</span><b>${s.rr}/${s.rt}</b></div><div class="sc"><span>Side pots</span><b>${s.sr}/${s.st}</b></div><div class="sc"><span>Streak</span><b>${s.streak}</b></div>`;
}

function introHTML(): string {
  return `<h2>You're in the box</h2><p>Six-handed pot limit Omaha. When a player says “Pot,” announce the raise. When someone's all in for less, build the side pot at the end of that round. At showdown, ship each pot to the right hand, and chop it when hands tie.</p>
    ${storeMode() === 'guest' ? `<p class="muted intro-acct">Want a timer, your own blinds, or stats that stick? <button class="linkbtn" id="introSignin">Sign in free</button></p>` : ''}
    <details class="howto"><summary>How to figure the pot</summary>
    <p>The player calls the bet first, then raises the size of the whole pot after that call. So the raise is the last bet plus the pot after the call.</p>
    <p>The 3× rule: three times the last bet, plus everything else out. Don't count the last bet twice, and leave out the raiser's own chips in front of them. ${app.settings.sbFull ? 'With the small blind counted as a full blind, $2/$5 first in is 3 × $5 + $5 = $20.' : 'At $2/$5 first in, that\'s 3 × $5 + $2 = $17.'}</p>
    <p>Side pots: when someone's all in for less, build the side pot at the end of the round. What's already in the middle stays in the main pot. From each bet this round, take the all-in amount for the main pot (dead money from folded players goes in too, up to that amount). Everything left in front is the side pot, which the all-in player can't win.</p>
    <p>At showdown every hand plays exactly two hole cards and three from the board. Four hearts on board with one heart in hand is not a flush.</p></details>`;
}

export function renderPanel(): void {
  const S = app.S; let h: string;
  if (!S) h = introHTML();
  else if (S.mode === 'quiz') h = `<p class="muted" style="margin:0">${S.caption}. Announce the pot to keep the hand going.</p>`;
  else if (S.mode === 'cut') h = `<p class="muted" style="margin:0">${S.caption}. Build the side pot to keep the hand going.</p>`;
  else if (S.sd && (S.mode === 'showdown' || S.mode === 'done')) h = readPanel();
  else if (S.mode === 'done') h = `<h2>Hand's over</h2><p>${S.caption}.</p><button class="btn wide" id="deal">${nextHandLabel()}</button>`;
  else h = `<p class="muted" style="margin-bottom:12px">Follow the action. When someone pots, you announce it.</p>${app.challenge ? '' : '<button class="btn ghost" id="deal">New hand</button>'}`;
  $('#panel').innerHTML = h;
}

function renderTicker(): void {
  const S = app.S;
  $('#street').textContent = !S ? 'Ready' : S.mode === 'showdown' || S.mode === 'done' ? 'Showdown' : STREETS[S.street];
  $('#caption').textContent = !S ? 'Waiting on a deal' : S.caption;
}

function renderLog(): void {
  const S = app.S, ol = $('#log');
  if (!S) { ol.innerHTML = '<li class="muted">No hands yet.</li>'; return; }
  ol.innerHTML = S.log.map(l => `<li class="${l.st ? 'st' : ''}">${l.t}</li>`).join('');
  ol.scrollTop = ol.scrollHeight;
}

/** The question popup for pot calls and side pots. */
export function renderModal(): void {
  const S = app.S, m = $('#modal'), box = $('#modalBox');
  const asking = !!S && (S.mode === 'quiz' || S.mode === 'cut'), show = asking && !S!.peek;
  const wasOpen = m.classList.contains('open');
  let fab = $q('#fab');
  if (asking && S!.peek) {
    if (!fab) {
      fab = document.createElement('button'); fab.id = 'fab'; fab.className = 'btn fab'; fab.textContent = 'Back to the question';
      fab.addEventListener('click', unpeek); document.body.appendChild(fab);
    }
  } else fab?.remove();
  if (!show) { m.classList.remove('open'); box.innerHTML = ''; return; }
  const old = box.querySelector('input'), keep = old ? old.value : '', oid = old ? old.id : '';
  box.innerHTML = S!.mode === 'cut' ? cutPanel() : quizPanel();
  const inp = box.querySelector('input');
  if (inp) {
    if (!oid || inp.id === oid) inp.value = keep;
    if (!wasOpen) setTimeout(() => { try { inp.focus({ preventScroll: true }); } catch { /* ignore */ } }, 60);
  }
  m.classList.add('open'); fitVV();
}

export function unpeek(): void { if (app.S) { app.S.peek = false; renderModal(); renderPanel(); } }

/** Keep the popup above the phone keyboard. */
export function fitVV(): void {
  const vv = window.visualViewport, m = $q('#modal'), box = $q('#modalBox'); if (!vv || !m || !box) return;
  const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  m.style.paddingBottom = `calc(env(safe-area-inset-bottom,0px) + ${10 + kb}px)`;
  box.style.maxHeight = `${Math.round(vv.height * .85)}px`;
}

export function render(): void {
  renderScores(); renderTable(); renderTicker(); renderPanel(); renderModal(); renderLog();
  if (app.challenge) renderStrip();
  renderWelcome();
}
