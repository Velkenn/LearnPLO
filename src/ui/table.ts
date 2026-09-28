// Draws the felt: seats, bets, pot piles, board, dealer button, and chip motion.
import { app, nextHandLabel } from '../app.ts';
import type { Card, Hand } from '../engine/types.ts';
import { posOf, tableSize } from '../engine/hand.ts';
import { rowBest } from '../engine/showdown.ts';
import { GAMES } from '../config.ts';
import { game, isBomb } from '../page.ts';
import { cutSum, potName } from '../engine/pots.ts';
import { fmt } from '../util.ts';
import { $ } from './dom.ts';
import { cardHTML, chipStacks } from './cards.ts';
import { chipClick } from './sound.ts';

// Positions in % of the table box (a tall table, 1 wide by 1.6 high). Seats go clockwise from the
// dealer's left; the dealer sits at the bottom. Each table size has its own seat, bet, and
// dealer-button spots. A seat's spot is the middle of its player icon and name plate.
type XY = [number, number];
/** piles: where separate pots sit, by how many there are. dblBet and dblPiles: the same, clear of two boards. */
interface Layout { seat: XY[]; bet: XY[]; dblBet: XY[]; puck: XY[]; piles: Record<number, XY[]>; dblPiles: Record<number, XY[]> }
const PILES: Record<number, XY[]> = { 1: [[50, 42]], 2: [[37, 42], [63, 42]], 3: [[50, 31], [36, 42], [64, 42]], 4: [[37, 31], [63, 31], [37, 42], [63, 42]] };
const LAYOUTS: Record<number, Layout> = {
  6: {
    seat: [[17, 81], [11, 44], [24, 11], [76, 11], [89, 44], [83, 81]],
    bet: [[32, 74], [29, 48.5], [34, 27], [66, 27], [71, 48.5], [68, 74]],
    dblBet: [[32, 76], [28, 39], [34, 27], [66, 27], [72, 39], [68, 76]],
    puck: [[34, 89], [21, 35], [37, 8], [63, 8], [79, 35], [66, 89]],
    piles: PILES,
    dblPiles: PILES,
  },
  9: {
    seat: [[26, 85], [10, 68], [10, 45], [19, 20], [50, 8], [81, 20], [90, 45], [90, 68], [74, 85]],
    bet: [[37, 79], [27, 70], [26, 46], [32, 33], [50, 24], [68, 33], [74, 46], [73, 70], [63, 79]],
    dblBet: [[37, 79], [26, 73], [26, 44], [32, 33], [50, 24], [68, 33], [74, 44], [74, 73], [63, 79]],
    puck: [[38, 90], [10, 57.5], [9, 33], [31, 14], [36, 6], [69, 14], [91, 33], [90, 57.5], [62, 90]],
    piles: PILES,
    dblPiles: PILES,
  },
};

/** The last thing each seat did this betting round, as a tag under its name plate. */
const TAGS: Record<string, string> = { folds: 'Fold', checks: 'Check', calls: 'Call', bets: 'Bet', raises: 'Raise', pots: 'Pot', 're-pots': 'Re-pot' };
function lastActions(S: Hand): Map<number, string> {
  const out = new Map<number, string>();
  for (let k = S.log.length - 1; k >= 0; k--) {
    const e = S.log[k];
    if (e.st) break;
    const m = /^Seat (\d+) \([^)]*\) ([a-z-]+)/.exec(e.t);
    if (!m || out.has(+m[1] - 1)) continue;
    const tag = / all in/.test(e.t) ? 'All in' : TAGS[m[2]];
    if (tag) out.set(+m[1] - 1, tag);
  }
  return out;
}
const tagClass = (t: string): string => ({ Fold: 'fold', Check: 'check', Call: 'call', 'All in': 'allin' } as Record<string, string>)[t] ?? 'raise';

/** A plain player icon (head and shoulders), tinted per seat. */
const PERSON = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="15" r="7.5"/><path d="M5.5 38c1.2-8.3 7.2-13 14.5-13s13.3 4.7 14.5 13z"/></svg>';
const TINTS = ['#3F6E8C', '#8C5A3F', '#5E7A3F', '#7A4F86', '#3F8078', '#8C7A3F', '#86504F', '#4F5E86', '#6B6B6B'];
const avatar = (i: number): string => `<span class="disc" style="--tint:${TINTS[i % TINTS.length]}">${PERSON}</span>`;
/** The layout for a table of n seats (six-handed if there's no layout for n). */
export const layoutFor = (n: number): Layout => LAYOUTS[n] ?? LAYOUTS[6];

/** k: the pot's index. b: which board's half (double board, once the pot is split). */
export interface Pile { k: number; b?: 0 | 1; name: string; amt: number; x: number; y: number; open?: boolean; aw?: boolean }

/** Separate chip piles once pots are cut (during the hand) or at showdown. */
export function piles(S: Hand | null): Pile[] | null {
  if (!S) return null;
  const sd = S.sd;
  let list: Omit<Pile, 'x' | 'y'>[];
  if (sd && sd.splits) {
    // Double board: a pot is one pile until it's split, then a pile for each board's half.
    list = [];
    sd.pots.forEach((pt, k) => {
      // Pots are split one at a time, so "Top" and "Bottom" are always the pot being dealt with.
      if (sd.splits![k] || pt.halves!.some(h => h.awarded)) pt.halves!.forEach(h => list.push({ k, b: h.board, name: h.board ? 'Bottom' : 'Top', amt: h.amount, aw: h.awarded }));
      else list.push({ k, name: pt.name, amt: pt.amount, aw: pt.awarded });
    });
    list = list.filter(x => !x.aw);
    if (list.length < 2 && !list.some(x => x.b != null)) return null;
  } else if (sd) {
    if (sd.pots.length < 2) return null;
    list = sd.pots.map((pt, k) => ({ k, name: pt.name, amt: pt.amount, aw: pt.awarded }));
  } else {
    if (!S.cuts.length) return null;
    const n = S.cuts.length;
    list = S.cuts.map((c, k) => ({ k, name: c.name, amt: c.amount }));
    const pending = S.mode === 'cut' && !!S.cq && S.cq.pots.some(x => !S.cuts.includes(x));
    const rest = S.pot - cutSum(S);
    if (rest > 0) list.push({ k: n, name: pending ? 'Still out' : potName(n, n + 1), amt: rest, open: !pending });
  }
  const L = layoutFor(S.players.length), layouts = isBomb ? L.dblPiles : L.piles;
  const spots = layouts[list.length] || list.map((_, j) => [20 + 60 * j / (list.length - 1), 42] as XY);
  return list.map((x, j) => ({ ...x, x: spots[j][0], y: spots[j][1] })).filter(x => !x.aw);
}

/** After a pot is read: the winners' hole cards and the board cards that play (on board `on`). */
function shownPlay(S: Hand): { holeBy: Record<number, number[]>; board: number[]; on: 0 | 1 } | null {
  const sd = S.sd; if (!sd || sd.phase !== 'result') return null;
  if (sd.reads) {
    const b = sd.part, pt = sd.pots[sd.order[sd.step]];
    if (b !== 0 && b !== 1) return null;
    const res = sd.reads[`${sd.order[sd.step]}-${b}`];
    if (!res || res.auto) return null;
    const h = pt.halves![b], holeBy: Record<number, number[]> = {};
    h.winners.forEach(w => { holeBy[w] = rowBest(sd.rows.find(r => r.i === w)!, b).hole; });
    return { holeBy, board: rowBest(sd.rows.find(r => r.i === h.winners[0])!, b).board, on: b };
  }
  for (let st = sd.step; st >= 0; st--) {
    const k = sd.order[st], res = sd.results[k];
    if (res && !res.auto) {
      const pt = sd.pots[k], holeBy: Record<number, number[]> = {};
      pt.winners!.forEach(w => { holeBy[w] = sd.rows.find(r => r.i === w)!.best.hole; });
      return { holeBy, board: sd.rows.find(r => r.i === pt.winners![0])!.best.board, on: 0 };
    }
  }
  return null;
}

// Printed on the felt near the dealer, curved along the bottom of the rail like a casino's name.
// The viewBox matches the table box (100 wide, 160 tall), so % positions map to x and 1.6 × y.
const PRINT = `<svg class="print" viewBox="0 0 100 160" aria-hidden="true">
  <defs><path id="printArc1" d="M27 106A23 23 0 0 0 73 106"/><path id="printArc2" d="M20 106A30 30 0 0 0 80 106"/></defs>
  <text class="print-brand"><textPath href="#printArc1" startOffset="50%" text-anchor="middle">FeltReady</textPath></text>
  <text class="print-game"><textPath href="#printArc2" startOffset="50%" text-anchor="middle">${GAMES[game].name}</textPath></text>
</svg>`;

export function renderTable(): void {
  const S = app.S, settings = app.settings, t = $('#table');
  const L = layoutFor(S ? S.players.length : tableSize(settings));
  const bets = isBomb ? L.dblBet : L.bet;
  t.classList.toggle('ring9', L === LAYOUTS[9]);
  t.classList.toggle('dbl', isBomb);
  let h = `<div class="rail"><div class="felt"></div></div>${PRINT}<div class="dealer">Dealer</div>`;
  if (!S) {
    L.seat.forEach(([x, y], i) => { h += `<div class="seat idle${x < 50 ? ' l' : ''}" style="left:${x}%;top:${y}%">${avatar(i)}<div class="plate"><div class="sn">Seat ${i + 1}</div></div></div>`; });
    h += `${emptyBoards()}${dealButton('Deal a hand')}`;
    t.innerHTML = h; return;
  }
  const lbl = settings.chipAmt !== false;
  const reveal = !!S.sd;
  const wonSet = S.sd ? new Set(S.sd.pots.filter(pt => pt.awarded).flatMap(pt => pt.winners!)) : new Set<number>();
  const play = shownPlay(S);
  const muck = S.sd ? S.sd.mucked : null;
  const acts = S.sd ? new Map<number, string>() : lastActions(S);
  S.players.forEach(p => {
    const [x, y] = L.seat[p.i], pos = posOf(S, p), gone = p.folded || (muck && muck.has(p.i));
    const potting = (S.mode === 'quiz' && S.quiz && S.quiz.q.seat === p.i) ||
      (S.mode === 'cut' && S.cq && p.allin && !p.folded && p.totalIn === S.cq.pots[S.cq.j].level);
    const cls = ['seat', x < 50 ? 'l' : '', gone ? 'folded' : '', S.acting === p.i && S.mode === 'running' ? 'acting' : '', potting ? 'potting' : '', wonSet.has(p.i) ? 'win' : '', reveal && !gone ? 'shows' : ''].join(' ');
    // Face down, the cards fan out behind the player; at showdown they turn up over the icon.
    const cards = gone ? '' : reveal
      ? `<div class="fan up">${p.hole.map((c, k) => cardHTML(c, 'fc' + (play ? (play.holeBy[p.i] && play.holeBy[p.i].includes(k) ? ' plays' : ' sits') : ''))).join('')}</div>`
      : `<div class="fan">${'<span class="back"></span>'.repeat(4)}</div>`;
    const blind = !S.bottom && (pos === 'SB' || pos === 'BB'); // bomb pots have no blinds
    const tag = p.folded ? 'Fold' : potting && S.mode === 'quiz' ? 'Pot' : acts.get(p.i);
    h += `<div class="${cls}" style="left:${x}%;top:${y}%">${cards}${avatar(p.i)}<div class="plate"><div class="sn">Seat ${p.i + 1}${blind ? ` <span class="badge">${pos}</span>` : ''}</div><div class="stk">${p.allin ? 'All in' : fmt(p.stack)}</div></div>${tag && !S.sd ? `<div class="tag ${tagClass(tag)}">${tag}</div>` : ''}</div>`;
    if (p.committed > 0) {
      const [bx, by] = bets[p.i];
      h += `<div class="bet" style="left:${bx}%;top:${by}%" aria-label="${fmt(p.committed)} bet">${chipStacks(p.committed, 8)}${lbl ? `<span class="amt">${fmt(p.committed)}</span>` : ''}</div>`;
    }
  });
  const [px, py] = L.puck[S.btn];
  h += `<div class="puck" style="left:${px}%;top:${py}%" title="Dealer button">D</div>`;

  const left = S.sd ? S.pot - S.sd.pots.filter(pt => pt.awarded).reduce((a, pt) => a + pt.amount, 0) : (S.mode === 'done' ? 0 : S.pot);
  const moving = (S.sweep && S.sweep.length) || (S.ship && S.ship.length) || 0;
  const pl = piles(S);
  const tgt = pl && pl.length ? pl[pl.length - 1] : { x: 50, y: 42 };
  if (S.sweep && S.sweep.length) S.sweep.forEach(sw => {
    const [bx, by] = bets[sw.i];
    h += `<div class="bet sweep" style="left:${bx}%;top:${by}%;--tx:${tgt.x}%;--ty:${tgt.y}%" aria-hidden="true">${chipStacks(sw.amt, 8)}</div>`;
  });
  const justCut = S.justCut; S.justCut = false;
  if (pl) pl.forEach(x => {
    h += `<div class="pot pile${justCut ? ' split' : ''}" style="left:${x.x}%;top:${x.y}%">${chipStacks(x.amt, 5)}<span class="amt">${x.name.replace(' pot', '')}${x.open && !settings.showPot ? '' : ' ' + fmt(x.amt)}</span></div>`;
  });
  else if (left > 0) h += `<div class="pot${S.sweep && S.sweep.length ? ' landing' : ''}">${chipStacks(left, 6)}${settings.showPot || S.sd ? `<span class="amt">Pot ${fmt(left)}</span>` : ''}</div>`;
  if (S.ship && S.ship.length) S.ship.forEach((sh, k) => {
    const [sx, sy] = L.seat[sh.i];
    h += `<div class="bet ship" style="--fx:${sh.fx || 50}%;--fy:${sh.fy || 42}%;--x:${sx}%;--y:${sy}%;animation-delay:${k * 120}ms" aria-hidden="true">${chipStacks(Math.max(1, sh.amt || 0), 6)}</div>`;
  });
  S.sweep = null; S.ship = null;
  if (moving) setTimeout(() => chipClick(moving > 1 ? 4 : 3), 60);

  const fresh = S.fresh || []; S.fresh = null;
  const freshB = S.freshB || []; S.freshB = null;
  /** One board: cards dealt so far, the ones that play lifted after a read, the rest dimmed. */
  const boardHTML = (cards: Card[], which: 0 | 1, fr: number[], delay0: number, cls: string): string => {
    const on = play && play.on === which;
    return `<div class="board${cls}${on ? ' reading' : ''}">${[0, 1, 2, 3, 4].map(k => cards[k]
      ? cardHTML(cards[k], (fr.includes(k) ? 'deal' : '') + (play ? (on && play.board.includes(k) ? ' plays' : ' sits') : ''), fr.includes(k) ? `style="animation-delay:${delay0 + fr.indexOf(k) * 90}ms"` : '')
      : '<span class="slot"></span>').join('')}</div>`;
  };
  if (S.bottom) {
    // The board being read stands out; the other one fades back.
    const b = S.sd && (S.sd.part === 0 || S.sd.part === 1) && S.mode === 'showdown' ? S.sd.part : null;
    h += boardHTML(S.board, 0, fresh, 0, ` b-top${b === 1 ? ' away' : ''}`);
    h += boardHTML(S.bottom, 1, freshB, fresh.length * 90 + 60, ` b-bot${b === 0 ? ' away' : ''}`);
  } else h += boardHTML(S.board, 0, fresh, 0, '');
  if (S.mode === 'done') h += dealButton(nextHandLabel());
  t.innerHTML = h;
}

/** Empty card spots before the first deal: one board, or two for double board. */
const emptyBoards = (): string => {
  const slots = '<span class="slot"></span>'.repeat(5);
  return isBomb ? `<div class="board b-top">${slots}</div><div class="board b-bot">${slots}</div>` : `<div class="board">${slots}</div>`;
};

/** The deal button sits on the felt under the board, so starting a hand never needs a scroll. */
const dealButton = (label: string): string => `<button class="btn tdeal" data-deal>${label}</button>`;
