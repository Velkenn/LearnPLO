// Drill: someone is all in for less. Cut the main pot (and any further side pots) before the next card.
import { app, bump, logAttempt, recordTime } from '../app.ts';
import type { Pot } from '../engine/types.ts';
import { STREETS } from '../config.ts';
import { active, seatName } from '../engine/hand.ts';
import { commitCuts, cutSum, outAbove, potName } from '../engine/pots.ts';
import { fmt, potRef, seatList } from '../util.ts';
import type { CutMiss } from '../data/weakSpots.ts';
import { $q, readAmount } from '../ui/dom.ts';
import { buzz } from '../ui/sound.ts';
import { timeLine, timerHTML, timerStart, timerStop } from '../ui/timer.ts';
import { render } from '../ui/render.ts';

/** Hook for the hand loop: pause until every pot in `pots` is cut. */
export function askCuts(pots: Pot[]): Promise<void> {
  const S = app.S!;
  S.cq = { pots, j: 0, ans: [] }; S.mode = 'cut'; S.peek = false;
  S.caption = `Cutting ${potRef(pots[0])}`;
  render();
  timerStart('build', () => gradeCut(true));
  return new Promise(res => { S.cutResolve = () => { S.mode = 'running'; S.cq = null; S.peek = false; res(); }; });
}

const nextCardName = (): string => { const st = app.S!.street; return st < 3 ? `before the ${STREETS[st + 1].toLowerCase()}` : 'before the showdown'; };

/** Name the likely mistake behind a wrong cut, with a short code for the weak spots page. */
export function cutDiag(v: number, pt: Pot): { miss: CutMiss; text: string } {
  const S = app.S!;
  const deadParts = pt.parts.filter(x => x.folded), dead = deadParts.reduce((a, x) => a + x.amt, 0);
  const everything = outAbove(S, pt.prev).reduce((a, x) => a + x.amt, 0);
  const share = pt.level - pt.prev;
  if (dead > 0 && v === pt.amount - dead) return { miss: 'dead-money', text: `You left out ${fmt(dead)} of dead money from the folded player${deadParts.length > 1 ? 's' : ''}.` };
  if (v === everything) return { miss: 'everything', text: `That's everything in the middle. This pot stops at the all-in.` };
  if (v === share) return { miss: 'one-share', text: `That's one player's share. Take ${fmt(share)} from each player in the pot.` };
  return v > pt.amount ? { miss: 'high', text: `Too high by ${fmt(v - pt.amount)}.` } : { miss: 'low', text: `Too low by ${fmt(pt.amount - v)}.` };
}

export function gradeCut(timeout: boolean): void {
  const S = app.S, cq = S && S.cq; if (!S || !cq || S.mode !== 'cut') return;
  const pt = cq.pots[cq.j]; if (cq.ans[cq.j]) return;
  const inp = $q<HTMLInputElement>('#bp'); const v = readAmount(inp);
  if (!timeout && isNaN(v)) { inp?.focus(); return; }
  const ms = timerStop(), ok = !timeout && v === pt.amount;
  const d = ok || timeout ? null : cutDiag(v, pt);
  cq.ans[cq.j] = { v, ok, timeout, ms: timeout ? null : ms, diag: d ? d.text : '' }; if (!timeout) recordTime('b', ms);
  app.stats.st++; if (ok) app.stats.sr++; bump(ok); buzz(ok);
  logAttempt({ kind: 'cut', correct: ok, timedOut: timeout, ms: timeout ? null : ms, detail: { answer: timeout ? null : v, amount: pt.amount, pot: pt.name, street: S.street, dead: pt.parts.some(x => x.folded), ...(d && { miss: d.miss }) } });
  commitCuts(S, [pt]); S.justCut = true;
  S.log.push({ t: `${pt.name} cut: ${fmt(pt.amount)} (${seatList(pt.elig)})` });
  S.caption = `${pt.name} is ${fmt(pt.amount)}`;
  render();
  ($q('#cont2') || $q('#cutDone'))?.focus({ preventScroll: true });
}

export function nextCut(): void {
  const cq = app.S!.cq!; cq.j++;
  app.S!.caption = `Cutting ${potRef(cq.pots[cq.j])}`;
  render();
  timerStart('build', () => gradeCut(true));
  $q('#bp')?.focus({ preventScroll: true });
}

export function finishCuts(): void { timerStop(); app.S?.cutResolve?.(); render(); }

/** "Capped at Seat 4's all-in of $145. 3 × $145 + $5 dead from Seat 1 = $440" */
export function potExplain(pt: Pot, k: number): string {
  const S = app.S!;
  const live = pt.parts.filter(x => !x.folded), dead = pt.parts.filter(x => x.folded);
  const capper = S.players.find(p => !p.folded && p.allin && p.totalIn === pt.level && pt.elig.includes(p.i));
  const head = k === 0
    ? (capper ? `Capped at ${seatName(capper)}'s all-in of ${fmt(pt.level)}.` : `Everyone still in put in at least ${fmt(pt.level)}.`)
    : `What ${seatList(pt.elig)} put in above ${fmt(pt.prev)}${capper ? `, up to ${seatName(capper)}'s all-in of ${fmt(pt.level)}` : ''}.`;
  const per: Record<number, number[]> = {};
  live.forEach(x => { per[x.amt] = (per[x.amt] || []).concat(x.i); });
  const terms = Object.keys(per).map(Number).sort((a, b) => b - a)
    .map(a => per[a].length > 1 ? `${per[a].length} × ${fmt(a)}` : `${fmt(a)} (Seat ${per[a][0] + 1})`);
  dead.forEach(d => terms.push(`${fmt(d.amt)} dead from Seat ${d.i + 1}`));
  return `${head} ${terms.join(' + ')} = <b>${fmt(pt.amount)}</b>`;
}

interface Row { i: number; folded: boolean; allin: boolean; amt: number; cap?: boolean }
const outList = (rows: Row[]): string => rows.map(x =>
  `<div class="lrow${x.folded ? ' dead' : ''}"><span>Seat ${x.i + 1}${x.folded ? ' (folded, dead)' : x.cap ? ' (all in)' : ''}</span><b>${fmt(x.amt)}</b></div>`).join('');

export function cutPanel(): string {
  const S = app.S!, cq = S.cq!, pt = cq.pots[cq.j], a = cq.ans[cq.j], first = pt.idx === 0;
  const rows: Row[] = outAbove(S, pt.prev).sort((x, y) => (Number(x.folded) - Number(y.folded)) || (x.amt - y.amt));
  const capper = S.players.find(p => !p.folded && p.allin && p.totalIn === pt.level);
  rows.forEach(r => { if (capper && r.i === capper.i) r.cap = true; });
  const prevPot = first ? null : S.cuts[pt.idx! - 1];
  let h = `<h2 id="qtitle">Cut ${potRef(pt)}</h2>`;
  if (!a) {
    const capAmt = pt.level - pt.prev;
    h += `<p class="muted">${capper ? `${seatName(capper)} is all in for ${first ? fmt(capAmt) : `${fmt(capAmt)} more`}. ` : ''}Cut ${potRef(pt)} ${nextCardName()}.</p>
    ${timerHTML('build')}<div class="recap"><div class="lhead">${first ? 'In for the hand' : `In above ${potRef(prevPot!)}`}</div>${outList(rows)}</div>
    <div class="ans"><span class="cur">$</span><input id="bp" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="${pt.name}" aria-label="${pt.name} amount"><button class="btn" id="checkPots">Cut it</button></div>
    <button class="peek" id="peek">Look at the table</button>`;
    return h;
  }
  h += a.ok ? `<div class="verdict good">Right. ${pt.name} is ${fmt(pt.amount)}.</div>`
    : `<div class="verdict bad">${a.timeout ? 'Time. ' : ''}${pt.name} is ${fmt(pt.amount)}.${a.timeout ? '' : `<span>You had ${fmt(a.v)}. ${a.diag}</span>`}</div>`;
  h += timeLine('b', a.ms);
  h += `<p>${potExplain(pt, pt.idx!)}</p>`;
  const take = pt.level - pt.prev;
  h += `<div class="recap"><div class="lhead">Take ${fmt(take)} from each stack</div>${rows.map(r => {
    const rest = Math.max(0, r.amt - take);
    return `<div class="lrow${r.folded ? ' dead' : ''}${rest ? '' : ' gone'}"><span>Seat ${r.i + 1}${r.folded ? ' (dead)' : ''}</span><b>${fmt(r.amt)} − ${fmt(Math.min(r.amt, take))} = ${fmt(rest)}</b></div>`;
  }).join('')}</div>`;
  if (cq.j + 1 < cq.pots.length) {
    h += `<button class="btn wide" id="cont2">Cut ${potRef(cq.pots[cq.j + 1])}</button>`;
  } else {
    const open = S.pot - cutSum(S), n = S.cuts.length, oname = potName(n, n + 1);
    const still = active(S).filter(p => p.totalIn > pt.level).map(p => p.i);
    h += `<p class="built">What's left starts ${oname.toLowerCase() === 'side pot' ? 'the side pot' : oname.toLowerCase()}: <b>${fmt(open)}</b>. ${still.length ? `${seatList(still)} ${still.length > 1 ? 'keep' : 'keeps'} playing for it.` : ''}</p>
    <button class="btn wide" id="cutDone">Back to the action</button>`;
  }
  return h;
}
