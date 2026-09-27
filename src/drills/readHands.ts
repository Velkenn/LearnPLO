// Drill: read the showdown. Pick the winning five (or each winner in a chop), side pots first.
import { app, bump, challengeAnswer, logAttempt, nextHandLabel, recordTime } from '../app.ts';
import { handOver } from '../game.ts';
import type { Pot } from '../engine/types.ts';
import { bestAny, cmp, describe } from '../engine/cards.ts';
import { posOf } from '../engine/hand.ts';
import { awardPot, buildShowdown, curPot, gradePicks, liveElig, losersOf, muckAfter, readMiss, type ReadMiss } from '../engine/showdown.ts';
import { capF, fmt, potRef, seatList } from '../util.ts';
import { $q, reducedMotion } from '../ui/dom.ts';
import { cardBtn, cardHTML } from '../ui/cards.ts';
import { buzz } from '../ui/sound.ts';
import { timeLine, timerHTML, timerStart, timerStop } from '../ui/timer.ts';
import { render, renderPanel } from '../ui/render.ts';
import { piles } from '../ui/table.ts';

const scrollToPanel = (smooth = false): void =>
  $q('#panel')?.scrollIntoView({ behavior: smooth && !reducedMotion() ? 'smooth' : 'auto', block: 'start' });

/** Hook for the hand loop: two or more hands are live at the end. */
export function startShowdown(): void {
  const S = app.S!;
  S.sd = buildShowdown(S);
  S.sel = { holes: {}, board: [] };
  S.mode = 'showdown'; S.acting = null;
  enterRead();
  render();
  scrollToPanel(true);
}

/** Pay a pot and send its chips flying to the winners. */
function pay(pt: Pot): void {
  const S = app.S!, sd = S.sd!;
  const src = (piles(S) || []).find(x => x.k === sd.pots.indexOf(pt)) || { x: 50, y: 41 };
  awardPot(S, sd, pt);
  S.ship = (S.ship || []).concat(pt.winners!.map(i => ({ i, amt: pt.share!, fx: src.x, fy: src.y })));
}

function enterRead(): void {
  const S = app.S!, sd = S.sd!;
  sd.phase = 'read'; S.sel = { holes: {}, board: [] };
  while (sd.step < sd.order.length && liveElig(sd, curPot(sd)).length < 2) {
    pay(curPot(sd)); sd.results[sd.order[sd.step]] = { auto: true, ok: true }; sd.step++;
  }
  if (sd.step >= sd.order.length) { sd.step = sd.order.length - 1; finishShowdown(); return; }
  S.caption = sd.pots.length > 1 ? `Reading ${potRef(curPot(sd))}` : 'Read the hands';
  timerStart('read', () => gradeHand(true));
}

function finishShowdown(): void {
  const S = app.S!, sd = S.sd!;
  sd.phase = 'result'; S.mode = 'done';
  handOver();
  S.caption = sd.pots.length > 1 ? 'All pots shipped'
    : `${seatList(sd.pots[0].winners!)} ${sd.pots[0].winners!.length > 1 ? 'chop' : 'takes'} ${fmt(sd.pots[0].amount)}`;
}

export function toggleSel(kind: 'board' | 'hole', seat: number | null, idx: number): void {
  const sel = app.S!.sel;
  if (kind === 'board') {
    const k = sel.board.indexOf(idx);
    if (k >= 0) sel.board.splice(k, 1); else { sel.board.push(idx); if (sel.board.length > 3) sel.board.shift(); }
  } else if (seat != null) {
    const arr = sel.holes[seat] || (sel.holes[seat] = []);
    const k = arr.indexOf(idx);
    if (k >= 0) arr.splice(k, 1); else { arr.push(idx); if (arr.length > 2) arr.shift(); }
    if (!arr.length) delete sel.holes[seat];
  }
  renderPanel();
}

export function gradeHand(timeout: boolean): void {
  const S = app.S, sd = S && S.sd; if (!S || !sd || S.mode !== 'showdown' || sd.phase !== 'read') return;
  const sel = S.sel, pt = curPot(sd), seats = Object.keys(sel.holes).map(Number);
  if (!timeout && (sel.board.length !== 3 || !seats.length || seats.some(s => sel.holes[s].length !== 2))) return;
  const ms = timerStop(); let ok = false, miss: ReadMiss | null = null;
  if (timeout) sd.results[sd.order[sd.step]] = { timeout: true, ok: false };
  else {
    const g = gradePicks(S, pt, sel.holes, sel.board); ok = g.ok;
    if (!ok) miss = readMiss(S, sd, pt, g.picks).miss;
    sd.results[sd.order[sd.step]] = { picks: g.picks, ok, ms }; recordTime('r', ms);
  }
  app.stats.rt++; if (ok) app.stats.rr++; bump(ok); buzz(ok);
  challengeAnswer({ k: 'read', holes: timeout ? {} : Object.fromEntries(seats.map(s => [String(s), [...sel.holes[s]]])), board: timeout ? [] : [...sel.board] }, ok);
  logAttempt({ kind: 'read', correct: ok, timedOut: timeout, ms: timeout ? null : ms, detail: { chop: pt.winners!.length > 1, hand: pt.top![0], pots: sd.pots.length, contenders: liveElig(sd, pt).length, ...(miss && { miss }) } });
  pay(pt); sd.phase = 'result';
  const rest = sd.order.slice(sd.step + 1);
  const gone = muckAfter(sd, pt);
  if (!rest.some(k => liveElig(sd, sd.pots[k], gone).length > 1)) {
    rest.forEach(k => { pay(sd.pots[k]); sd.results[k] = { auto: true, ok: true }; });
    finishShowdown();
  } else S.caption = `${seatList(pt.winners!)} ${pt.winners!.length > 1 ? 'chop' : 'takes'} ${potRef(pt)}`;
  render();
  scrollToPanel();
}

export function nextPot(): void {
  const S = app.S!, sd = S.sd!, pt = curPot(sd), lost = losersOf(sd, pt);
  lost.forEach(i => sd.mucked.add(i));
  if (lost.length) S.log.push({ t: `${seatList(lost)} ${lost.length > 1 ? 'muck' : 'mucks'}. Lost ${potRef(pt)}, so ${lost.length > 1 ? 'they can\'t' : 'can\'t'} win the rest.` });
  sd.step++; enterRead(); render(); scrollToPanel();
}

export function readPanel(): string {
  const S = app.S!, sd = S.sd!, sel = S.sel, pt = curPot(sd), multi = sd.pots.length > 1;
  const res = sd.results[sd.order[sd.step]];
  const le = liveElig(sd, pt);
  const elig = sd.rows.filter(r => le.includes(r.i));
  const out = sd.rows.filter(r => !pt.elig.includes(r.i));
  const mucked = sd.rows.filter(r => pt.elig.includes(r.i) && sd.mucked.has(r.i)).map(r => r.i);
  const winners = pt.winners!;
  let h = `<h2>${multi ? `${pt.name}, ${fmt(pt.amount)}` : 'Read the hands'}</h2>`;
  if (!res) {
    h += timerHTML('read');
    h += `<p class="muted">${multi ? `${seatList(le)} ${le.length > 1 ? 'are' : 'is'} in this pot. ` : ''}Tap the two hole cards and three board cards that play for the winner. If it's a chop, tap each winner's two cards.</p>`;
    h += `<div class="sdrow"><h3>Board</h3><div class="cards">${S.board.map((c, k) => cardBtn(c, sel.board.includes(k) ? 'on' : '', `data-k="board" data-i="${k}" aria-pressed="${sel.board.includes(k)}"`)).join('')}</div></div>`;
    elig.forEach(r => {
      const p = S.players[r.i], mine = sel.holes[p.i] || [];
      h += `<div class="sdrow"><h3>Seat ${p.i + 1} <span class="badge">${posOf(S, p)}</span></h3><div class="cards">${p.hole.map((c, k) => { const on = mine.includes(k); return cardBtn(c, on ? 'on' : '', `data-k="hole" data-s="${p.i}" data-i="${k}" aria-pressed="${on}"`); }).join('')}</div></div>`;
    });
    if (mucked.length) h += `<p class="muted" style="margin-top:8px">${seatList(mucked)} mucked after losing the bigger pot.</p>`;
    if (out.length) h += `<p class="muted" style="margin-top:8px">${seatList(out.map(r => r.i))} ${out.length > 1 ? 'aren\'t' : 'isn\'t'} in this one. All in for less.</p>`;
    const seats = Object.keys(sel.holes).map(Number);
    const ready = sel.board.length === 3 && seats.length > 0 && seats.every(s => sel.holes[s].length === 2);
    const status = `Board ${sel.board.length}/3${seats.length ? ', ' + seats.map(s => `Seat ${s + 1} ${sel.holes[s].length}/2`).join(', ') : ''}`;
    h += `<div class="selbar"><span class="muted">${status}</span><button class="btn" id="gradeBtn" ${ready ? '' : 'disabled'}>${seats.length > 1 ? 'Chop it' : 'Ship it'}</button></div>`;
    return h;
  }
  const wn = seatList(winners), split = winners.length > 1, wd = describe(pt.top!);
  const both = winners.length === 2 ? 'both' : 'all';
  const odd = pt.odd ? ` The odd ${fmt(pt.odd.amt)} goes to Seat ${pt.odd.seat + 1}, first left of the button.` : '';
  let v: string;
  if (res.timeout) v = `<div class="verdict bad">Time. ${split ? `Chop it between ${wn}` : `It goes to ${wn}`}.<span>${capF(wd)}.${odd}</span></div>`;
  else if (res.ok) v = `<div class="verdict good">${split ? `Chop it.<span>${wn} ${both} have ${wd}.${odd}</span>` : `Ship it to ${wn}.<span>${capF(wd)}.</span>`}</div>`;
  else {
    const picks = res.picks || [];
    const m = readMiss(S, sd, pt, picks);
    const missed = winners.filter(w => !picks.some(x => x.seat === w));
    let msg: string, why: string;
    if (m.miss === 'omaha-rule' || m.miss === 'wrong-winner') {
      const pr = sd.rows.find(r => r.i === m.seat)!;
      msg = split ? `Chop it between ${wn}.` : `It goes to ${wn}.`;
      why = `${capF(wd)} beats Seat ${m.seat + 1}'s best, ${describe(pr.best.score)}.`;
      if (m.miss === 'omaha-rule') why += ` It can look like ${describe(bestAny([...S.players[m.seat].hole, ...S.board]))}, but in Omaha a player must use exactly two hole cards and three from the board.`;
      why += odd;
    } else if (m.miss === 'wrong-five') {
      const b = picks.find(x => x.seat === m.seat)!; msg = 'Right player, wrong five.';
      why = `Those cards make ${describe(b.score)}. Seat ${b.seat + 1}'s best five make ${wd}.`;
    } else {
      msg = `It's a chop.`;
      why = `${seatList(missed)} ${missed.length > 1 ? 'have' : 'has'} ${wd} too. Split it between ${wn}.${odd}`;
    }
    v = `<div class="verdict bad">${msg}<span>${why}</span></div>`;
  }
  h += v + timeLine('r', res.ms);
  [...elig].sort((a, b) => cmp(b.best.score, a.best.score)).forEach(r => {
    const p = S.players[r.i], win = winners.includes(r.i);
    const got = win ? pt.share! + (pt.odd && pt.odd.seat === r.i ? pt.odd.amt : 0) : 0;
    h += `<div class="sdrow"><h3>Seat ${p.i + 1} <span class="badge">${posOf(S, p)}</span>${win ? `<span class="wtag">${split ? 'Chops' : 'Takes'} ${fmt(got)}</span>` : ''}</h3>
      <div class="cards">${p.hole.map((c, k) => cardHTML(c, 'md ' + (r.best.hole.includes(k) ? (win ? 'used' : '') : 'dim'))).join('')}</div>
      <div class="best"><span class="muted">Plays</span><span class="cards">${r.best.cards.map(c => cardHTML(c, 'sm')).join('')}</span><span>${describe(r.best.score)}</span></div></div>`;
  });
  if (S.mode !== 'done') {
    const gone = muckAfter(sd, pt);
    let nk = sd.step + 1;
    while (nk < sd.order.length && liveElig(sd, sd.pots[sd.order[nk]], gone).length < 2) nk++;
    const nxt = nk < sd.order.length ? sd.pots[sd.order[nk]] : null;
    const lost = losersOf(sd, pt);
    if (lost.length && nxt) h += `<p class="muted" style="margin-top:12px">${seatList(lost)} lost ${potRef(pt)}, so ${lost.length > 1 ? 'they muck' : 'that hand mucks'}. ${lost.length > 1 ? 'They' : 'It'} can't win ${potRef(nxt)} either.</p>`;
    h += `<button class="btn wide" id="nextPot" style="margin-top:12px">${nxt ? `Now ${potRef(nxt)}` : 'Finish'}</button>`;
  } else {
    if (multi) h += `<div class="recap" style="margin-top:12px">${sd.pots.map(p => `${p.name}, ${fmt(p.amount)}: ${seatList(p.winners!)}`).join('<br>')}</div>`;
    h += `<button class="btn wide" id="deal" style="margin-top:12px">${nextHandLabel()}</button>`;
  }
  return h;
}
