// Drill: a player says "Pot" and the dealer announces the raise.
import { app, bump, logAttempt, recordTime } from '../app.ts';
import type { Player, PotQ } from '../engine/types.ts';
import { posOf, seatName } from '../engine/hand.ts';
import { fmt } from '../util.ts';
import type { PotMiss } from '../data/weakSpots.ts';
import { $q, readAmount } from '../ui/dom.ts';
import { buzz } from '../ui/sound.ts';
import { timeLine, timerHTML, timerStart, timerStop } from '../ui/timer.ts';
import { render, renderModal, renderScores } from '../ui/render.ts';

/** Hook for the hand loop: pause until the dealer has announced the pot. */
export function askPot(p: Player, q: PotQ): Promise<void> {
  const S = app.S!;
  S.mode = 'quiz'; S.quiz = { q, answered: false };
  S.caption = q.repotOf ? `${seatName(p)} re-pots` : `${seatName(p)} says “Pot”`;
  S.log.push({ t: `${seatName(p)} (${posOf(S, p)}) says “Pot”` });
  render();
  timerStart('pot', () => gradeQuiz(true));
  return new Promise(res => { S.quizResolve = () => { S.mode = 'running'; S.quiz = null; S.peek = false; res(); }; });
}

export function gradeQuiz(timeout: boolean): void {
  const S = app.S;
  if (!S || S.mode !== 'quiz' || !S.quiz || S.quiz.answered) return;
  const inp = $q<HTMLInputElement>('#ans');
  const v = readAmount(inp);
  if (!timeout && isNaN(v)) { inp?.focus(); return; }
  const ms = timerStop();
  const Q = S.quiz, q = Q.q;
  Q.answered = true; Q.timeout = timeout; Q.val = v; Q.ok = !timeout && v === q.raiseTo;
  if (!timeout) { Q.ms = ms; recordTime('p', ms); }
  app.stats.pt++; if (Q.ok) app.stats.pr++; bump(Q.ok); buzz(Q.ok);
  const d = Q.ok || timeout ? null : diagnose(v, q);
  Q.diag = d ? d.text : '';
  logAttempt({ kind: 'pot', correct: Q.ok, timedOut: timeout, ms: timeout ? null : ms, detail: { answer: timeout ? null : v, raiseTo: q.raiseTo, street: q.street, repot: !!q.repotOf, sbFull: S.sbFull, ...(d && { miss: d.miss }) } });
  renderModal(); renderScores();
  $q('#cont')?.focus({ preventScroll: true });
}

export function continueQuiz(): void { app.S?.quizResolve?.(); render(); }

/** Name the likely mistake behind a wrong answer, with a short code for the weak spots page. */
export function diagnose(v: number, q: PotQ): { miss: PotMiss; text: string } {
  const S = app.S!, n = `Seat ${q.seat + 1}`;
  if (q.sbAlt != null && v === q.sbAlt) return { miss: 'sb-rule', text: S.sbFull
    ? `That counts the small blind as ${fmt(S.sb)}. With the rounding rule on, it counts as a full ${fmt(S.bb)}.`
    : `That counts the small blind as a full ${fmt(S.bb)}. With the rounding rule off, it counts as the ${fmt(S.sb)} actually posted.` };
  if (q.mine > 0 && v === q.addNow) return { miss: 'added-only', text: `That's what ${n} adds. Announce the total.` };
  if (v === q.total) return { miss: 'before-call', text: `That's the pot before the call. They call first, then raise the size of the new pot.` };
  if (q.toCall > 0 && v === q.cb + q.total) return { miss: 'skipped-call', text: `You raised by the current pot but skipped adding the ${fmt(q.toCall)} call to the pot first.` };
  if (v === q.after) return { miss: 'after-call', text: `That's the pot after the call. The raise goes on top of the ${fmt(q.cb)} they're matching.` };
  if (v === 3 * q.cb + q.total) return { miss: 'shortcut', text: `Close. With the 3× shortcut, "everything else" leaves out the last bet itself${q.mine ? ` and ${n}'s own ${fmt(q.mine)}` : ''}.` };
  return v > q.raiseTo ? { miss: 'high', text: `Too high by ${fmt(v - q.raiseTo)}.` } : { miss: 'low', text: `Too low by ${fmt(q.raiseTo - v)}.` };
}

export function quizPanel(): string {
  const S = app.S!, settings = app.settings, Q = S.quiz!, q = Q.q, n = `Seat ${q.seat + 1}`, lbl = settings.chipAmt !== false;
  const outs = lbl ? q.bets.map(b => `Seat ${b.i + 1} ${fmt(b.amt)}${b.folded ? ' (folded)' : ''}`).join(', ') : 'count the chips in front of each player';
  const middle = q.street === 0 ? 'nothing yet (preflop)' : settings.showPot ? fmt(q.middle) : 'your count';
  let h = `<h2 id="qtitle">${q.repotOf ? `${n} (${q.pos}) re-pots` : `${n} (${q.pos}): “Pot.”`}</h2>`;
  if (!Q.answered) {
    h += `<p class="muted">${q.repotOf ? `Seat ${q.repotOf.seat + 1} potted it to ${fmt(q.repotOf.to)}. ${n} pots it back. ` : ''}Announce the raise.</p>
    ${timerHTML('pot')}<div class="recap">In the middle: ${middle}<br>Out in front: ${outs}</div>
    <div class="ans"><span class="cur">$</span><input id="ans" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="Raise to" aria-label="Pot raise amount"><button class="btn" id="checkPot">Announce</button></div>
    <button class="peek" id="peek">Look at the table</button>`;
    return h;
  }
  h += Q.ok ? `<div class="verdict good">Good. Pot is ${fmt(q.raiseTo)}.</div>`
    : Q.timeout ? `<div class="verdict bad">Time. Pot is ${fmt(q.raiseTo)}.</div>`
      : `<div class="verdict bad">Pot is ${fmt(q.raiseTo)}.<span>You said ${fmt(Q.val!)}. ${Q.diag}</span></div>`;
  h += timeLine('p', Q.ms);
  const parts: string[] = [];
  if (q.middle > 0) parts.push(`${fmt(q.middle)} in the middle`);
  q.bets.forEach(b => parts.push(q.adj && b.i === q.sbSeat
    ? `${fmt(S.bb)} from Seat ${b.i + 1} (small blind rounded up from ${fmt(b.amt)})`
    : `${fmt(b.amt)} from Seat ${b.i + 1}${b.folded ? ' (folded)' : ''}`));
  h += `<ol class="steps">
    <li>Count it down: ${parts.join(' + ')} = <b>${fmt(q.total)}</b></li>
    <li>${q.toCall > 0 ? `${n} calls ${fmt(q.toCall)} first${q.mine ? `, since they already have ${fmt(q.mine)} out` : ''}: ${fmt(q.total)} + ${fmt(q.toCall)} = <b>${fmt(q.after)}</b>` : `${n} has nothing to call, so the pot stays <b>${fmt(q.after)}</b>`}</li>
    <li>Then they raise the size of the pot: ${fmt(q.cb)} + ${fmt(q.after)} = <b>${fmt(q.raiseTo)}</b></li>
  </ol>
  <p class="shortcut"><span class="k">The 3× rule:</span>Three times the last bet, plus everything else out${q.mine ? `, not counting ${n}'s own ${fmt(q.mine)}` : ''}. 3 × ${fmt(q.cb)} + ${fmt(q.rest)} = <b>${fmt(q.raiseTo)}</b>.${q.mine ? ` ${n} puts in ${fmt(q.addNow)} more.` : ''}</p>
  <button class="btn wide" id="cont">Back to the action</button>`;
  return h;
}
