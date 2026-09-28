// Drill: someone is all in for less. Build the side pot before the next card: from each bet this
// round, the all-in amount goes in the main pot (the pot already in the middle is the main pot)
// and the rest starts the side pot. The dealer says what the main pot takes from this round.
import { app, bump, challengeAnswer, logAttempt, recordTime } from '../app.ts';
import type { Pot } from '../engine/types.ts';
import { STREETS } from '../config.ts';
import { active, seatName } from '../engine/hand.ts';
import { commitCuts, cutSum, potName, roundBets } from '../engine/pots.ts';
import { capF, fmt, potRef, seatList } from '../util.ts';
import type { CutMiss } from '../data/weakSpots.ts';
import { $q, readAmount } from '../ui/dom.ts';
import { buzz } from '../ui/sound.ts';
import { timeLine, timerHTML, timerStart, timerStop } from '../ui/timer.ts';
import { render } from '../ui/render.ts';

/** Hook for the hand loop: pause until the dealer has built the side pot(s). */
export function askCuts(pots: Pot[]): Promise<void> {
  const S = app.S!;
  S.cq = { pots, j: 0, ans: [] }; S.mode = 'cut'; S.peek = false;
  S.caption = 'Building the side pot';
  render();
  timerStart('build', () => gradeCut(true));
  return new Promise(res => { S.cutResolve = () => { S.mode = 'running'; S.cq = null; S.peek = false; res(); }; });
}

const nextCardName = (): string => { const st = app.S!.street; return st < 3 ? `before the ${STREETS[st + 1].toLowerCase()}` : 'before the showdown'; };

/** Where this round starts counting for a player in this pot: the round's start, or the pot below. */
const from = (pt: Pot, i: number): number => Math.max(pt.prev, app.S!.streetStart[i] ?? 0);
/** What this pot takes from one player's bet this round (the all-in amount, for anyone who covered it). */
const takeFor = (pt: Pot, i: number): number => Math.max(0, pt.level - from(pt, i));
const roundOf = (pt: Pot): number => pt.round ?? pt.amount;
const middleOf = (pt: Pot): number => pt.amount - roundOf(pt);
const capperOf = (pt: Pot) => app.S!.players.find(p => !p.folded && p.allin && p.totalIn === pt.level && pt.elig.includes(p.i));

/** Name the likely mistake behind a wrong answer, with a short code for the weak spots page. */
export function cutDiag(v: number, pt: Pot): { miss: CutMiss; text: string } {
  const S = app.S!, round = roundOf(pt), middle = middleOf(pt);
  const parts = pt.roundParts ?? pt.parts;
  const deadParts = parts.filter(x => x.folded), dead = deadParts.reduce((a, x) => a + x.amt, 0);
  const everything = roundBets(S, pt.prev).reduce((a, x) => a + x.amt, 0);
  const capper = capperOf(pt), take = capper ? takeFor(pt, capper.i) : 0;
  const live = parts.filter(x => !x.folded).length;
  const handShare = pt.level - pt.prev;
  if (middle > 0 && v === pt.amount) return { miss: 'with-middle', text: `That counts the ${fmt(middle)} already in the middle. It stays in ${potRef(pt)}; only this round's bets get split now.` };
  if (dead > 0 && v === round - dead) return { miss: 'dead-money', text: `You left out ${fmt(dead)} of dead money from the folded player${deadParts.length > 1 ? 's' : ''}.` };
  if (handShare !== take && (v === handShare * live || v === handShare * live + dead)) return { miss: 'hand-total', text: `That uses the ${fmt(handShare)} they started the hand with. Earlier rounds are already in the middle, so use this round's bet: ${fmt(take)}.` };
  if (v === everything) return { miss: 'everything', text: `That's every bet this round. ${capF(potRef(pt))} only takes ${fmt(take)} from each; the rest starts the side pot.` };
  if (v === take) return { miss: 'one-share', text: `That's one player's bet. Take ${fmt(take)} from each bet and add them up.` };
  return v > round ? { miss: 'high', text: `Too high by ${fmt(v - round)}.` } : { miss: 'low', text: `Too low by ${fmt(round - v)}.` };
}

export function gradeCut(timeout: boolean): void {
  const S = app.S, cq = S && S.cq; if (!S || !cq || S.mode !== 'cut') return;
  const pt = cq.pots[cq.j]; if (cq.ans[cq.j]) return;
  const inp = $q<HTMLInputElement>('#bp'); const v = readAmount(inp);
  if (!timeout && isNaN(v)) { inp?.focus(); return; }
  const round = roundOf(pt);
  const ms = timerStop(), ok = !timeout && v === round;
  const d = ok || timeout ? null : cutDiag(v, pt);
  cq.ans[cq.j] = { v, ok, timeout, ms: timeout ? null : ms, diag: d ? d.text : '' }; if (!timeout) recordTime('b', ms);
  app.stats.st++; if (ok) app.stats.sr++; bump(ok); buzz(ok);
  challengeAnswer({ k: 'cut', v: timeout ? null : v }, ok);
  logAttempt({ kind: 'cut', correct: ok, timedOut: timeout, ms: timeout ? null : ms, detail: { answer: timeout ? null : v, amount: round, total: pt.amount, middle: middleOf(pt), pot: pt.name, street: S.street, dead: (pt.roundParts ?? pt.parts).some(x => x.folded), ...(d && { miss: d.miss }) } });
  commitCuts(S, [pt]); S.justCut = true;
  S.log.push({ t: `${pt.name}: ${fmt(round)} from this round${middleOf(pt) ? ` + ${fmt(middleOf(pt))} in the middle` : ''} = ${fmt(pt.amount)} (${seatList(pt.elig)})` });
  S.caption = `${pt.name} is ${fmt(pt.amount)}`;
  render();
  ($q('#cont2') || $q('#cutDone'))?.focus({ preventScroll: true });
}

export function nextCut(): void {
  const cq = app.S!.cq!; cq.j++;
  app.S!.caption = 'Building the side pot';
  render();
  timerStart('build', () => gradeCut(true));
  $q('#bp')?.focus({ preventScroll: true });
}

export function finishCuts(): void { timerStop(); app.S?.cutResolve?.(); render(); }

/** "Take $100 from each bet: 3 × $100 + $40 dead from Seat 1 = $340." */
export function potExplain(pt: Pot): string {
  const parts = pt.roundParts ?? pt.parts;
  const live = parts.filter(x => !x.folded), dead = parts.filter(x => x.folded);
  const capper = capperOf(pt), take = capper ? takeFor(pt, capper.i) : Math.max(...live.map(x => x.amt));
  const per: Record<number, number[]> = {};
  live.forEach(x => { per[x.amt] = (per[x.amt] || []).concat(x.i); });
  const terms = Object.keys(per).map(Number).sort((a, b) => b - a)
    .map(a => per[a].length > 1 ? `${per[a].length} × ${fmt(a)}` : `${fmt(a)} (Seat ${per[a][0] + 1})`);
  dead.forEach(d => terms.push(`${fmt(d.amt)} dead from Seat ${d.i + 1}`));
  const head = capper ? `${seatName(capper)} is all in for ${fmt(take)} this round, so take ${fmt(take)} from each bet:` : `Take ${fmt(take)} from each bet:`;
  const middle = middleOf(pt);
  return `${head} ${terms.join(' + ')} = <b>${fmt(roundOf(pt))}</b>.${middle ? ` With the ${fmt(middle)} already in the middle, ${potRef(pt)} is <b>${fmt(pt.amount)}</b>.` : ''}`;
}

interface Row { i: number; folded: boolean; allin: boolean; amt: number; cap?: boolean }
const outList = (rows: Row[]): string => rows.map(x =>
  `<div class="lrow${x.folded ? ' dead' : ''}"><span>Seat ${x.i + 1}${x.folded ? ' (folded, dead)' : x.cap ? ' (all in)' : ''}</span><b>${fmt(x.amt)}</b></div>`).join('');

export function cutPanel(): string {
  const S = app.S!, cq = S.cq!, pt = cq.pots[cq.j], a = cq.ans[cq.j], first = cq.j === 0;
  const rows: Row[] = roundBets(S, pt.prev).sort((x, y) => (Number(x.folded) - Number(y.folded)) || (x.amt - y.amt));
  const capper = capperOf(pt);
  rows.forEach(r => { if (capper && r.i === capper.i) r.cap = true; });
  const prevPot = first ? null : cq.pots[cq.j - 1];
  const middle = middleOf(pt), take = capper ? takeFor(pt, capper.i) : 0;
  const into = pt.idx === 0 ? 'the main pot' : potRef(pt);
  let h = `<h2 id="qtitle">Build the side pot</h2>`;
  if (!a) {
    h += `<p class="muted">${capper ? `${seatName(capper)} is all in for ${fmt(take)}${first ? ' this round' : ' more'}. ` : ''}How much of this round's bets goes in ${into}? Build it ${nextCardName()}.</p>
    ${timerHTML('build')}<div class="recap">${middle ? `<div class="lrow"><span>Already in the middle (${pt.idx === 0 ? 'main pot' : pt.name.toLowerCase()})</span><b>${fmt(middle)}</b></div>` : ''}<div class="lhead">${first ? 'Bets this round' : `Left in front after ${potRef(prevPot!)}`}</div>${outList(rows)}</div>
    <div class="ans"><span class="cur">$</span><input id="bp" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="Into ${pt.idx === 0 ? 'main pot' : pt.name.toLowerCase()}" aria-label="Amount from this round into ${into}"><button class="btn" id="checkPots">Build it</button></div>
    <button class="peek" id="peek">Look at the table</button>`;
    return h;
  }
  const round = roundOf(pt);
  h += a.ok ? `<div class="verdict good">Right. ${fmt(round)} goes in ${into}.</div>`
    : `<div class="verdict bad">${a.timeout ? 'Time. ' : ''}${fmt(round)} goes in ${into}.${a.timeout ? '' : `<span>You had ${fmt(a.v)}. ${a.diag}</span>`}</div>`;
  h += timeLine('b', a.ms);
  h += `<p>${potExplain(pt)}</p>`;
  h += `<div class="recap"><div class="lhead">Take ${fmt(take)} from each bet</div>${rows.map(r => {
    const t = Math.min(r.amt, takeFor(pt, r.i)), rest = r.amt - t;
    return `<div class="lrow${r.folded ? ' dead' : ''}${rest ? '' : ' gone'}"><span>Seat ${r.i + 1}${r.folded ? ' (dead)' : ''}</span><b>${fmt(r.amt)} − ${fmt(t)} = ${fmt(rest)}</b></div>`;
  }).join('')}</div>`;
  if (cq.j + 1 < cq.pots.length) {
    h += `<button class="btn wide" id="cont2">Next: ${potRef(cq.pots[cq.j + 1])}</button>`;
  } else {
    const open = S.pot - cutSum(S), n = S.cuts.length, oname = potName(n, n + 1);
    const still = active(S).filter(p => p.totalIn > pt.level).map(p => p.i);
    h += `<p class="built">What's left in front is ${oname.toLowerCase() === 'side pot' ? 'the side pot' : oname.toLowerCase()}: <b>${fmt(open)}</b>. ${still.length ? `${seatList(still)} ${still.length > 1 ? 'keep' : 'keeps'} playing for it.` : ''}</p>
    <button class="btn wide" id="cutDone">Back to the action</button>`;
  }
  return h;
}
