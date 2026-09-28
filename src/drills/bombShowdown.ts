// Drill: a double board showdown. Pot by pot, side pots first: split the pot between the boards
// (the odd chip goes to the top board), then read the top board, then the bottom board. Anyone
// who loses a board of a bigger pot can't win that board of the smaller pots.
import { app, bump, logAttempt, nextHandLabel, recordTime } from '../app.ts';
import { handOver } from '../game.ts';
import type { Pot, Showdown } from '../engine/types.ts';
import { bestAny, cmp, describe } from '../engine/cards.ts';
import { posOf } from '../engine/hand.ts';
import { boardCards, curPot, gradePicks, readMiss, rowBest, type ReadMiss } from '../engine/showdown.ts';
import { BOARD_NAMES, awardHalf, buildBombShowdown, contested, liveOn, losersOn, markGone, needsSplit, scooper, splitMiss, splitPot } from '../engine/bomb.ts';
import { capF, fmt, potRef, seatList } from '../util.ts';
import { $q, readAmount, reducedMotion } from '../ui/dom.ts';
import { cardBtn, cardHTML } from '../ui/cards.ts';
import { buzz } from '../ui/sound.ts';
import { timeLine, timerHTML, timerStart, timerStop } from '../ui/timer.ts';
import { render } from '../ui/render.ts';
import { piles } from '../ui/table.ts';

const scrollToPanel = (smooth = false): void =>
  $q('#panel')?.scrollIntoView({ behavior: smooth && !reducedMotion() ? 'smooth' : 'auto', block: 'start' });
const key = (sd: Showdown, b: 0 | 1): string => `${sd.order[sd.step]}-${b}`;
const potIdx = (sd: Showdown): number => sd.order[sd.step];
/** "the top board" or "the top board of the side pot". */
const boardRef = (sd: Showdown, pt: Pot, b: 0 | 1): string => `the ${BOARD_NAMES[b]}${sd.pots.length > 1 ? ` of ${potRef(pt)}` : ''}`;

/** Hook for the hand loop: two or more hands are live at the end. */
export function startBombShowdown(): void {
  const S = app.S!;
  S.sd = buildBombShowdown(S);
  S.sel = { holes: {}, board: [] };
  S.mode = 'showdown'; S.acting = null;
  enterPot();
  render();
  scrollToPanel(true);
}

/** Pay one board's half and send the chips to the winners. */
function pay(pt: Pot, b: 0 | 1): void {
  const S = app.S!, sd = S.sd!, k = sd.pots.indexOf(pt);
  const src = (piles(S) || []).find(x => x.k === k && (x.b === b || x.b == null)) || { x: 50, y: 36 };
  const h = awardHalf(S, sd, pt, b);
  S.ship = (S.ship || []).concat(h.winners.map(i => ({ i, amt: h.share!, fx: src.x, fy: src.y })));
}

/** Move to the current pot: ask for the split, or pay a pot that has only one player left in it. */
function enterPot(): void {
  const S = app.S!, sd = S.sd!;
  while (sd.step < sd.order.length) {
    const pt = curPot(sd);
    if (needsSplit(sd, pt)) {
      sd.part = 'split'; sd.phase = 'read';
      S.caption = `Split ${potRef(pt)}`;
      timerStart('split', () => gradeSplit(true));
      return;
    }
    pay(pt, 0); pay(pt, 1); sd.step++;
  }
  sd.step = sd.order.length - 1;
  finish();
}

/** Read one board of the current pot, or pay it if only one hand can win it. */
function enterBoard(b: 0 | 1): void {
  const S = app.S!, sd = S.sd!, pt = curPot(sd);
  sd.part = b;
  if (!contested(sd, pt, b)) {
    pay(pt, b); sd.reads![key(sd, b)] = { auto: true, ok: true };
    if (b === 0) { enterBoard(1); return; }
    sd.step++; enterPot(); return;
  }
  sd.phase = 'read'; S.sel = { holes: {}, board: [] };
  S.caption = `Reading the ${BOARD_NAMES[b]}`;
  timerStart('read', () => gradeBombRead(true));
}

function finish(): void {
  const S = app.S!, sd = S.sd!;
  sd.phase = 'result'; S.mode = 'done';
  handOver();
  const pt = sd.pots[0], w = sd.pots.length === 1 ? scooper(pt) : null;
  S.caption = sd.pots.length > 1 ? 'All pots shipped' : w != null ? `Seat ${w + 1} scoops ${fmt(pt.amount)}` : 'Both boards shipped';
}

/** Is there anything left for the dealer after this board is read (a later board or split)? */
function moreToDo(sd: Showdown, pt: Pot, b: 0 | 1): boolean {
  const gone: [Set<number>, Set<number>] = [new Set(sd.gone![0]), new Set(sd.gone![1])];
  losersOn(sd, pt, b).forEach(i => gone[b].add(i));
  if (b === 0 && liveOn(sd, pt, 1, gone[1]).length > 1) return true;
  return sd.order.slice(sd.step + 1).some(k => {
    const p = sd.pots[k], x = liveOn(sd, p, 0, gone[0]), y = liveOn(sd, p, 1, gone[1]);
    return x.length > 1 || y.length > 1 || x[0] !== y[0];
  });
}

export function gradeSplit(timeout: boolean): void {
  const S = app.S, sd = S && S.sd; if (!S || !sd || S.mode !== 'showdown' || sd.part !== 'split' || sd.phase !== 'read') return;
  const inp = $q<HTMLInputElement>('#sp'); const v = readAmount(inp);
  if (!timeout && isNaN(v)) { inp?.focus(); return; }
  const pt = curPot(sd), [top, bottom] = splitPot(pt.amount);
  const ms = timerStop(), ok = !timeout && v === top;
  const d = ok || timeout ? null : splitMiss(v, pt.amount);
  sd.splits![potIdx(sd)] = { v: timeout ? null : v, ok, timeout, ms: timeout ? null : ms, diag: d ? d.text : '' };
  if (!timeout) recordTime('h', ms);
  app.stats.ht = (app.stats.ht || 0) + 1; if (ok) app.stats.hr = (app.stats.hr || 0) + 1; bump(ok); buzz(ok);
  logAttempt({ kind: 'split', correct: ok, timedOut: timeout, ms: timeout ? null : ms, detail: { answer: timeout ? null : v, amount: pt.amount, top, odd: top !== bottom, pot: pt.name, pots: sd.pots.length, ...(d && { miss: d.miss }) } });
  S.log.push({ t: `${pt.name} (${fmt(pt.amount)}) split: ${fmt(top)} to the top board, ${fmt(bottom)} to the bottom board` });
  sd.phase = 'result'; S.justCut = true;
  S.caption = `Top ${fmt(top)}, bottom ${fmt(bottom)}`;
  render();
  $q('#nextPart')?.focus({ preventScroll: true });
}

export function gradeBombRead(timeout: boolean): void {
  const S = app.S, sd = S && S.sd; if (!S || !sd || S.mode !== 'showdown' || sd.phase !== 'read' || sd.part === 'split' || sd.part == null) return;
  const b = sd.part, sel = S.sel, pt = curPot(sd), h = pt.halves![b], seats = Object.keys(sel.holes).map(Number);
  if (!timeout && (sel.board.length !== 3 || !seats.length || seats.some(s => sel.holes[s].length !== 2))) return;
  const ms = timerStop(); let ok = false, miss: ReadMiss | null = null;
  if (timeout) sd.reads![key(sd, b)] = { timeout: true, ok: false };
  else {
    const g = gradePicks(S, h, sel.holes, sel.board, boardCards(S, b)); ok = g.ok;
    if (!ok) miss = readMiss(S, sd, h, g.picks, b).miss;
    sd.reads![key(sd, b)] = { picks: g.picks, ok, ms }; recordTime('r', ms);
  }
  app.stats.rt++; if (ok) app.stats.rr++; bump(ok); buzz(ok);
  logAttempt({ kind: 'read', correct: ok, timedOut: timeout, ms: timeout ? null : ms, detail: { board: b, chop: h.winners.length > 1, hand: h.top[0], pots: sd.pots.length, contenders: liveOn(sd, pt, b).length, ...(miss && { miss }) } });
  const more = moreToDo(sd, pt, b);
  pay(pt, b); sd.phase = 'result';
  if (!more) {
    // Nothing else needs the dealer: pay what's left and finish.
    markGone(sd, pt, b);
    if (b === 0) pay(pt, 1);
    sd.order.slice(sd.step + 1).forEach(k => { pay(sd.pots[k], 0); pay(sd.pots[k], 1); });
    finish();
  } else S.caption = `${seatList(h.winners)} ${h.winners.length > 1 ? 'chop' : 'takes'} the ${BOARD_NAMES[b]}`;
  render();
  scrollToPanel();
}

/** The button under a split or a read: on to the next board, or the next pot. */
export function nextPart(): void {
  const S = app.S!, sd = S.sd!, pt = curPot(sd), part = sd.part;
  if (part === 'split') enterBoard(0);
  else if (part != null) {
    const lost = markGone(sd, pt, part);
    if (lost.length) S.log.push({ t: `${seatList(lost)} lost ${boardRef(sd, pt, part)}, so ${lost.length > 1 ? 'they can\'t' : 'can\'t'} win the ${BOARD_NAMES[part]} of the smaller pots.` });
    if (part === 0) enterBoard(1); else { sd.step++; enterPot(); }
  }
  render(); scrollToPanel();
}

/** What the dealer does next, for the button label. */
function nextLabel(sd: Showdown, pt: Pot, b: 0 | 1): string {
  if (b === 0 && contested(sd, pt, 1)) return 'Now the bottom board';
  const gone: [Set<number>, Set<number>] = [new Set(sd.gone![0]), new Set(sd.gone![1])];
  losersOn(sd, pt, b).forEach(i => gone[b].add(i));
  const nk = sd.order.slice(sd.step + 1).find(k => {
    const p = sd.pots[k], x = liveOn(sd, p, 0, gone[0]), y = liveOn(sd, p, 1, gone[1]);
    return x.length > 1 || y.length > 1 || x[0] !== y[0];
  });
  return nk != null ? `Now ${potRef(sd.pots[nk])}` : 'Finish';
}

function splitHTML(): string {
  const S = app.S!, sd = S.sd!, pt = curPot(sd), multi = sd.pots.length > 1, [top, bottom] = splitPot(pt.amount);
  const a = sd.splits![potIdx(sd)];
  const players = [...new Set([...liveOn(sd, pt, 0), ...liveOn(sd, pt, 1)])].sort((x, y) => x - y);
  let h = `<h2>Split ${potRef(pt)}, ${fmt(pt.amount)}</h2>`;
  if (!a) {
    h += timerHTML('split');
    h += `<p class="muted">Two boards, so ${potRef(pt)} splits in half: one half for each board, and the odd chip goes to the top board.${multi ? ` ${seatList(players)} ${players.length > 1 ? 'are' : 'is'} in this pot.` : ''} How much goes to the top board?</p>
      <div class="ans"><span class="cur">$</span><input id="sp" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="Top board" aria-label="Amount for the top board"><button class="btn" id="splitBtn">Split it</button></div>`;
    return h;
  }
  h += a.ok ? `<div class="verdict good">Right. ${fmt(top)} to the top board, ${fmt(bottom)} to the bottom.</div>`
    : `<div class="verdict bad">${a.timeout ? 'Time. ' : ''}${fmt(top)} to the top board, ${fmt(bottom)} to the bottom.${a.timeout ? '' : `<span>You had ${fmt(a.v!)}. ${a.diag}</span>`}</div>`;
  h += timeLine('h', a.ms);
  h += `<p>${top === bottom ? `${fmt(pt.amount)} ÷ 2 = <b>${fmt(top)}</b> for each board.` : `${fmt(pt.amount)} doesn't split evenly: ${fmt(bottom)} for each board, and the odd ${fmt(top - bottom)} goes to the top board. Top board <b>${fmt(top)}</b>, bottom board <b>${fmt(bottom)}</b>.`}</p>`;
  h += `<button class="btn wide" id="nextPart">${contested(sd, pt, 0) ? 'Read the top board' : contested(sd, pt, 1) ? 'Read the bottom board' : 'Ship both halves'}</button>`;
  return h;
}

function readHTML(b: 0 | 1): string {
  const S = app.S!, sd = S.sd!, sel = S.sel, pt = curPot(sd), h = pt.halves![b], cards = boardCards(S, b);
  const res = sd.reads![key(sd, b)];
  // Paid itself (only one hand could win it) and that ended the hand.
  if (res?.auto) return `<h2>Hand's over</h2><p>${S.caption}.</p>${recapHTML()}`;
  const le = liveOn(sd, pt, b);
  const elig = sd.rows.filter(r => le.includes(r.i));
  const out = sd.rows.filter(r => !pt.elig.includes(r.i));
  const lostBigger = sd.rows.filter(r => pt.elig.includes(r.i) && sd.gone![b].has(r.i)).map(r => r.i);
  const winners = h.winners;
  let html = `<h2>${capF(boardRef(sd, pt, b))}, ${fmt(h.amount)}</h2>`;
  if (!res) {
    html += timerHTML('read');
    html += `<p class="muted">Tap the two hole cards and three ${b ? 'bottom' : 'top'}-board cards that play for the winner. If it's a chop, tap each winner's two cards.</p>`;
    html += `<div class="sdrow"><h3>${capF(BOARD_NAMES[b])}</h3><div class="cards">${cards.map((c, k) => cardBtn(c, sel.board.includes(k) ? 'on' : '', `data-k="board" data-i="${k}" aria-pressed="${sel.board.includes(k)}"`)).join('')}</div></div>`;
    elig.forEach(r => {
      const p = S.players[r.i], mine = sel.holes[p.i] || [];
      html += `<div class="sdrow"><h3>Seat ${p.i + 1} <span class="badge">${posOf(S, p)}</span></h3><div class="cards">${p.hole.map((c, k) => { const on = mine.includes(k); return cardBtn(c, on ? 'on' : '', `data-k="hole" data-s="${p.i}" data-i="${k}" aria-pressed="${on}"`); }).join('')}</div></div>`;
    });
    if (lostBigger.length) html += `<p class="muted" style="margin-top:8px">${seatList(lostBigger)} lost the ${BOARD_NAMES[b]} of a bigger pot, so ${lostBigger.length > 1 ? 'they can\'t' : 'can\'t'} win this one.</p>`;
    if (out.length) html += `<p class="muted" style="margin-top:8px">${seatList(out.map(r => r.i))} ${out.length > 1 ? 'aren\'t' : 'isn\'t'} in this pot. All in for less.</p>`;
    const seats = Object.keys(sel.holes).map(Number);
    const ready = sel.board.length === 3 && seats.length > 0 && seats.every(s => sel.holes[s].length === 2);
    const status = `Board ${sel.board.length}/3${seats.length ? ', ' + seats.map(s => `Seat ${s + 1} ${sel.holes[s].length}/2`).join(', ') : ''}`;
    html += `<div class="selbar"><span class="muted">${status}</span><button class="btn" id="gradeBtn" ${ready ? '' : 'disabled'}>${seats.length > 1 ? 'Chop it' : 'Ship it'}</button></div>`;
    return html;
  }
  const wn = seatList(winners), split = winners.length > 1, wd = describe(h.top);
  const both = winners.length === 2 ? 'both' : 'all';
  const odd = h.odd ? ` The odd ${fmt(h.odd.amt)} goes to Seat ${h.odd.seat + 1}, first left of the button.` : '';
  let v: string;
  if (res.timeout) v = `<div class="verdict bad">Time. ${split ? `Chop it between ${wn}` : `It goes to ${wn}`}.<span>${capF(wd)}.${odd}</span></div>`;
  else if (res.ok) v = `<div class="verdict good">${split ? `Chop it.<span>${wn} ${both} have ${wd} on the ${BOARD_NAMES[b]}.${odd}</span>` : `Ship it to ${wn}.<span>${capF(wd)} on the ${BOARD_NAMES[b]}.</span>`}</div>`;
  else {
    const picks = res.picks || [];
    const m = readMiss(S, sd, h, picks, b);
    const missed = winners.filter(w => !picks.some(x => x.seat === w));
    let msg: string, why: string;
    if (m.miss === 'omaha-rule' || m.miss === 'wrong-winner') {
      const pr = sd.rows.find(r => r.i === m.seat)!;
      msg = split ? `Chop it between ${wn}.` : `It goes to ${wn}.`;
      why = `${capF(wd)} beats Seat ${m.seat + 1}'s best on the ${BOARD_NAMES[b]}, ${describe(rowBest(pr, b).score)}.`;
      if (m.miss === 'omaha-rule') why += ` It can look like ${describe(bestAny([...S.players[m.seat].hole, ...cards]))}, but in Omaha a player must use exactly two hole cards and three from the board.`;
      why += odd;
    } else if (m.miss === 'wrong-five') {
      const pk = picks.find(x => x.seat === m.seat)!; msg = 'Right player, wrong five.';
      why = `Those cards make ${describe(pk.score)}. Seat ${pk.seat + 1}'s best five on the ${BOARD_NAMES[b]} make ${wd}.`;
    } else {
      msg = `It's a chop.`;
      why = `${seatList(missed)} ${missed.length > 1 ? 'have' : 'has'} ${wd} too. Split it between ${wn}.${odd}`;
    }
    v = `<div class="verdict bad">${msg}<span>${why}</span></div>`;
  }
  html += v + timeLine('r', res.ms);
  [...elig].sort((x, y) => cmp(rowBest(y, b).score, rowBest(x, b).score)).forEach(r => {
    const p = S.players[r.i], win = winners.includes(r.i), best = rowBest(r, b);
    const got = win ? h.share! + (h.odd && h.odd.seat === r.i ? h.odd.amt : 0) : 0;
    html += `<div class="sdrow"><h3>Seat ${p.i + 1} <span class="badge">${posOf(S, p)}</span>${win ? `<span class="wtag">${split ? 'Chops' : 'Takes'} ${fmt(got)}</span>` : ''}</h3>
      <div class="cards">${p.hole.map((c, k) => cardHTML(c, 'md ' + (best.hole.includes(k) ? (win ? 'used' : '') : 'dim'))).join('')}</div>
      <div class="best"><span class="muted">Plays</span><span class="cards">${best.cards.map(c => cardHTML(c, 'sm')).join('')}</span><span>${describe(best.score)}</span></div></div>`;
  });
  if (S.mode !== 'done') {
    const lost = losersOn(sd, pt, b), label = nextLabel(sd, pt, b);
    if (lost.length && sd.step + 1 < sd.order.length) {
      html += `<p class="muted" style="margin-top:12px">${seatList(lost)} lost ${boardRef(sd, pt, b)}, so ${lost.length > 1 ? 'they' : 'that hand'} can't win the ${BOARD_NAMES[b]} of a smaller pot.</p>`;
    }
    html += `<button class="btn wide" id="nextPart" style="margin-top:12px">${label}</button>`;
  } else html += recapHTML();
  return html;
}

/** After the last pot: who took what, board by board, and the deal button. */
function recapHTML(): string {
  const sd = app.S!.sd!;
  const line = (pt: Pot): string => {
    const w = scooper(pt);
    if (w != null) return `${pt.name}, ${fmt(pt.amount)}: Seat ${w + 1}${pt.elig.length > 1 ? ' scoops' : ''}`;
    const [a, b] = pt.halves!;
    return `${pt.name}, ${fmt(pt.amount)}: top ${seatList(a.winners)}, bottom ${seatList(b.winners)}`;
  };
  return `<div class="recap" style="margin-top:12px">${sd.pots.map(line).join('<br>')}</div>
    <button class="btn wide" id="deal" style="margin-top:12px">${nextHandLabel()}</button>`;
}

export function bombPanel(): string {
  const sd = app.S!.sd!;
  if (sd.part === 'split' && app.S!.mode !== 'done') return splitHTML();
  if (sd.part === 0 || sd.part === 1) return readHTML(sd.part);
  // A hand that finished without a question at showdown (everything paid itself).
  return `<h2>Hand's over</h2><p>${app.S!.caption}.</p>${recapHTML()}`;
}
