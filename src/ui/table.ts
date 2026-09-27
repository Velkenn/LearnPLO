// Draws the felt: seats, bets, pot piles, board, dealer button, and chip motion.
import { app } from '../app.ts';
import type { Hand } from '../engine/types.ts';
import { posOf } from '../engine/hand.ts';
import { cutSum, potName } from '../engine/pots.ts';
import { fmt } from '../util.ts';
import { $ } from './dom.ts';
import { cardHTML, chipStacks } from './cards.ts';
import { chipClick } from './sound.ts';

// Positions in % of the table box. Seats go clockwise from the dealer's left; the dealer sits at the bottom.
export const SEAT_XY: [number, number][] = [[19, 76], [11, 40.6], [32.6, 12.2], [67.4, 12.2], [89, 40.6], [81, 76]];
const BET_XY: [number, number][] = [[33, 70], [29, 44], [39, 33], [61, 33], [71, 44], [67, 70]];
const PUCK_XY: [number, number][] = [[4.5, 77], [11, 27.5], [16, 13], [84, 13], [89, 27.5], [95.5, 77]];

export interface Pile { k: number; name: string; amt: number; x: number; y: number; open?: boolean; aw?: boolean }

/** Separate chip piles once pots are cut (during the hand) or at showdown. */
export function piles(S: Hand | null): Pile[] | null {
  if (!S) return null;
  const sd = S.sd;
  let list: Omit<Pile, 'x' | 'y'>[];
  if (sd) {
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
  const layouts: Record<number, [number, number][]> = {
    1: [[50, 41]], 2: [[35, 41], [62, 41]], 3: [[50, 29], [35, 42], [65, 42]], 4: [[36, 29], [64, 29], [36, 42], [64, 42]],
  };
  const XY = layouts[list.length] || list.map((_, j) => [20 + 60 * j / (list.length - 1), 41] as [number, number]);
  return list.map((x, j) => ({ ...x, x: XY[j][0], y: XY[j][1] })).filter(x => !x.aw);
}

/** After a pot is read: the winners' hole cards and the board cards that play. */
function shownPlay(S: Hand): { holeBy: Record<number, number[]>; board: number[] } | null {
  const sd = S.sd; if (!sd || sd.phase !== 'result') return null;
  for (let st = sd.step; st >= 0; st--) {
    const k = sd.order[st], res = sd.results[k];
    if (res && !res.auto) {
      const pt = sd.pots[k], holeBy: Record<number, number[]> = {};
      pt.winners!.forEach(w => { holeBy[w] = sd.rows.find(r => r.i === w)!.best.hole; });
      return { holeBy, board: sd.rows.find(r => r.i === pt.winners![0])!.best.board };
    }
  }
  return null;
}

// Printed on the felt near the dealer, curved along the rail like a casino's name.
// The viewBox matches the table box (100 wide, 120 tall), so % positions map to x and 1.2 × y.
const PRINT = `<svg class="print" viewBox="0 0 100 120" aria-hidden="true">
  <defs><path id="printArc1" d="M17 60A33 41 0 0 0 83 60"/><path id="printArc2" d="M11 60A39 47 0 0 0 89 60"/></defs>
  <text class="print-brand"><textPath href="#printArc1" startOffset="50%" text-anchor="middle">FeltReady</textPath></text>
  <text class="print-game"><textPath href="#printArc2" startOffset="50%" text-anchor="middle">Pot limit Omaha</textPath></text>
</svg>`;

export function renderTable(): void {
  const S = app.S, settings = app.settings, t = $('#table');
  let h = `<div class="rail"><div class="felt"></div></div>${PRINT}<div class="dealer">Dealer</div>`;
  if (!S) {
    SEAT_XY.forEach(([x, y], i) => { h += `<div class="seat idle" style="left:${x}%;top:${y}%"><div class="sn">Seat ${i + 1}</div></div>`; });
    h += `<div class="board">${'<span class="slot"></span>'.repeat(5)}</div>`;
    t.innerHTML = h; return;
  }
  const lbl = settings.chipAmt !== false;
  const reveal = !!S.sd;
  const wonSet = S.sd ? new Set(S.sd.pots.filter(pt => pt.awarded).flatMap(pt => pt.winners!)) : new Set<number>();
  const play = shownPlay(S);
  const muck = S.sd ? S.sd.mucked : null;
  S.players.forEach(p => {
    const [x, y] = SEAT_XY[p.i], pos = posOf(S, p), gone = p.folded || (muck && muck.has(p.i));
    const potting = (S.mode === 'quiz' && S.quiz && S.quiz.q.seat === p.i) ||
      (S.mode === 'cut' && S.cq && p.allin && !p.folded && p.totalIn === S.cq.pots[S.cq.j].level);
    const cls = ['seat', gone ? 'folded' : '', S.acting === p.i && S.mode === 'running' ? 'acting' : '', potting ? 'potting' : '', wonSet.has(p.i) ? 'win' : ''].join(' ');
    const minis = gone ? '' : reveal
      ? p.hole.map((c, k) => cardHTML(c, 'xs' + (play ? (play.holeBy[p.i] && play.holeBy[p.i].includes(k) ? ' plays' : ' sits') : ''))).join('')
      : '<span class="back"></span>'.repeat(4);
    h += `<div class="${cls}" style="left:${x}%;top:${y}%"><div class="sn">Seat ${p.i + 1}${pos === 'SB' || pos === 'BB' ? ` <span class="badge">${pos}</span>` : ''}</div><div class="stk">${p.allin ? 'All in' : fmt(p.stack)}</div><div class="minis">${minis}</div></div>`;
    if (p.committed > 0) {
      const [bx, by] = BET_XY[p.i];
      h += `<div class="bet" style="left:${bx}%;top:${by}%" aria-label="${fmt(p.committed)} bet">${chipStacks(p.committed, 8)}${lbl ? `<span class="amt">${fmt(p.committed)}</span>` : ''}</div>`;
    }
  });
  const [px, py] = PUCK_XY[S.btn];
  h += `<div class="puck" style="left:${px}%;top:${py}%" title="Dealer button">D</div>`;

  const left = S.sd ? S.pot - S.sd.pots.filter(pt => pt.awarded).reduce((a, pt) => a + pt.amount, 0) : (S.mode === 'done' ? 0 : S.pot);
  const moving = (S.sweep && S.sweep.length) || (S.ship && S.ship.length) || 0;
  const pl = piles(S);
  const tgt = pl && pl.length ? pl[pl.length - 1] : { x: 50, y: 41 };
  if (S.sweep && S.sweep.length) S.sweep.forEach(sw => {
    const [bx, by] = BET_XY[sw.i];
    h += `<div class="bet sweep" style="left:${bx}%;top:${by}%;--tx:${tgt.x}%;--ty:${tgt.y}%" aria-hidden="true">${chipStacks(sw.amt, 8)}</div>`;
  });
  const justCut = S.justCut; S.justCut = false;
  if (pl) pl.forEach(x => {
    h += `<div class="pot pile${justCut ? ' split' : ''}" style="left:${x.x}%;top:${x.y}%">${chipStacks(x.amt, 5)}<span class="amt">${x.name.replace(' pot', '')}${x.open && !settings.showPot ? '' : ' ' + fmt(x.amt)}</span></div>`;
  });
  else if (left > 0) h += `<div class="pot${S.sweep && S.sweep.length ? ' landing' : ''}">${chipStacks(left, 6)}${settings.showPot || S.sd ? `<span class="amt">Pot ${fmt(left)}</span>` : ''}</div>`;
  if (S.ship && S.ship.length) S.ship.forEach((sh, k) => {
    const [sx, sy] = SEAT_XY[sh.i];
    h += `<div class="bet ship" style="--fx:${sh.fx || 50}%;--fy:${sh.fy || 41}%;--x:${sx}%;--y:${sy}%;animation-delay:${k * 120}ms" aria-hidden="true">${chipStacks(Math.max(1, sh.amt || 0), 6)}</div>`;
  });
  S.sweep = null; S.ship = null;
  if (moving) setTimeout(() => chipClick(moving > 1 ? 4 : 3), 60);

  const fresh = S.fresh || []; S.fresh = null;
  h += `<div class="board${play ? ' reading' : ''}">${[0, 1, 2, 3, 4].map(k => S.board[k]
    ? cardHTML(S.board[k], (fresh.includes(k) ? 'deal' : '') + (play ? (play.board.includes(k) ? ' plays' : ' sits') : ''), fresh.includes(k) ? `style="animation-delay:${fresh.indexOf(k) * 90}ms"` : '')
    : '<span class="slot"></span>').join('')}</div>`;
  t.innerHTML = h;
}
