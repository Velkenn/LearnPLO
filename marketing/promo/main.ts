// FeltReady promo: a seekable motion piece. seek(t) sets every element for time t (seconds),
// so frames can be captured one at a time. Uses FeltReady's own card and chip markup and CSS.
import { cardHTML, chipStacks } from '../../src/ui/cards.ts';

type Suit = 's' | 'h' | 'd' | 'c';
const RANK: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
const parse = (t: string) => ({ r: RANK[t[0]] ?? +t[0], s: t[1] as Suit });
const card = (t: string, cls = '') => cardHTML(parse(t), cls);

export const FPS = 30;
export const DURATION = 33.5;

// ---------- easing ----------
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lin = (t: number, t0: number, t1: number) => clamp((t - t0) / (t1 - t0));
const eo = (x: number) => 1 - Math.pow(1 - x, 3);
const eio = (x: number) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const back = (x: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const mix = (a: number, b: number, p: number) => a + (b - a) * p;
/** 0 → 1 over [t0, t0 + d] with ease-out. */
const inn = (t: number, t0: number, d = .35) => eo(lin(t, t0, t0 + d));
const pop = (t: number, t0: number, d = .4) => back(lin(t, t0, t0 + d));
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

// ---------- stage ----------
const stage = document.getElementById('stage')!;
function obj(html: string, cls = '', parent: HTMLElement = stage): HTMLElement {
  const e = document.createElement('div');
  e.className = 'obj';
  e.innerHTML = `<div class="c ${cls}">${html}</div>`;
  parent.appendChild(e);
  return e;
}
interface P { o?: number; s?: number; sx?: number; rot?: number }
function put(e: HTMLElement, x: number, y: number, p: P = {}): void {
  const o = p.o ?? 1;
  e.style.opacity = String(clamp(o));
  e.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
  e.style.transform = `translate(${x.toFixed(2)}px,${y.toFixed(2)}px) scale(${((p.s ?? 1) * (p.sx ?? 1)).toFixed(4)},${(p.s ?? 1).toFixed(4)}) rotate(${p.rot ?? 0}deg)`;
}
const setText = (e: HTMLElement, sel: string, txt: string) => { const x = e.querySelector(sel); if (x && x.textContent !== txt) x.textContent = txt; };

/** Scene opacity: fade in at a, out at b. */
const scene = (t: number, a: number, b: number, f = .35) => Math.min(lin(t, a, a + f), 1 - lin(t, b - f, b));

// Sound cues for the audio track: [time, kind, count].
export const EVENTS: [number, string, number][] = [];
const ev = (t: number, k: string, n = 1) => EVENTS.push([t, k, n]);

const seatBox = (n: number, stack: string) => `<div class="seat vseat"><div class="sn">Seat ${n}</div><div class="stk">${stack}</div><div class="minis">${'<span class="back"></span>'.repeat(4)}</div></div>`;
/** Stacks of green $25 chips, one count per stack (so a split is easy to see). */
const greens = (...counts: number[]) => `<div class="chipsbox"><span class="stacks" aria-hidden="true">${counts.map(n => `<span class="stack" style="--c:#1F7A40;--e:#F2F2F2">${'<i></i>'.repeat(n - 1)}</span>`).join('')}</span></div>`;
const chips = (amt: number, label = true, cap = 8) => `<div class="chipsbox">${chipStacks(amt, cap)}${label ? `<span class="amt">${money(amt)}</span>` : ''}</div>`;

// ---------- persistent brand mark ----------
const LOGO = `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="#1E6045"/><circle cx="32" cy="32" r="26" fill="none" stroke="#F2E8D0" stroke-width="6.5" stroke-dasharray="10.21 10.21"/><circle cx="32" cy="32" r="19" fill="#1E6045" stroke="#C99B2F" stroke-width="1.6"/><path d="M25.5 20h14v4.8h-8.6v5h7.6v4.8h-7.6V44h-5.4z" fill="#F2E8D0"/></svg>`;
const mark = obj(`<span class="mlogo">${LOGO}</span><span class="wm">Felt<span>Ready</span></span>`, 'mark');

// =====================================================================
// Scene 1: pot call (0 – 8.6)
// =====================================================================
const S1 = { a: 0, b: 8.6 };
const s1cap = obj(`<span>Flop. Pot is $60.</span>`, 'pill');
const s1pot = obj(chips(60, false) + '<span class="amt big">Pot $60</span>', 'potbox');
const s1board = obj(['Kc', '8h', '3s'].map(c => card(c)).join(''), 'boardrow sm');
const s1seat2 = obj(seatBox(2, '$1,480'));
const s1seat5 = obj(seatBox(5, '$2,115'));
const s1seat7 = obj(seatBox(7, '$1,760'), 'glowable');
const s1tag2 = obj('Bets $20', 'tag');
const s1tag5 = obj('Calls $20', 'tag');
const s1bet2 = obj(chips(20));
const s1bet5 = obj(chips(20));
const s1bet7 = obj(chips(140));
const s1bubble = obj('“Pot.”', 'bubble');
const s1panel = obj(`
  <div class="q1"><div class="pq">Seat 7 says “Pot.”</div><div class="ph">What’s the raise?</div>
    <div class="vbar"><i></i></div><div class="tnum">3</div></div>
  <div class="a1"><div class="verdict-good">Pot is $140.</div>
    <div class="eq"><span class="t1"><b>3 × $20</b><small>last bet</small></span><span class="t2"><b>+ $80</b><small>everything else out</small></span><span class="t3"><b>= $140</b><small>raise to</small></span></div>
    <div class="note">The 3× rule. $80 is the $60 pot plus the other $20.</div></div>`, 'panel');

ev(.52, 'chips', 3); ev(1.12, 'chips', 3); ev(1.45, 'whoosh'); ev(2.0, 'tick'); ev(3.0, 'tick'); ev(4.0, 'tick');
ev(5.0, 'ding'); ev(5.55, 'chips', 4);

function s1(t: number): void {
  const o = 1 - lin(t, S1.b - .3, S1.b); // no fade in: the first frame is the hook
  const vis = (e: HTMLElement, x: number, y: number, p: P = {}) => put(e, x, y, { ...p, o: (p.o ?? 1) * o });
  vis(s1cap, 270, 150, { o: 1 });
  vis(s1pot, 270, 432, { s: 1.5 });
  vis(s1board, 270, 540);
  vis(s1seat2, 90, 446, { s: 1.65 });
  vis(s1seat5, 270, 258, { s: 1.65 });
  vis(s1seat7, 450, 446, { s: 1.65 });
  (s1seat7.querySelector('.seat') as HTMLElement).classList.toggle('potting', t > 1.4 && t < 5.1);
  // bets slide from the seat to the bet spot
  const b2 = inn(t, .15, .4), b5 = inn(t, .75, .4), b7 = inn(t, 5.15, .45);
  vis(s1bet2, mix(148, 182, b2), mix(410, 374, b2), { o: lin(t, .15, .25), s: 1.75 });
  vis(s1bet5, 270, mix(318, 352, b5), { o: lin(t, .75, .85), s: 1.75 });
  vis(s1bet7, mix(392, 358, b7), mix(410, 374, b7), { o: lin(t, 5.15, 5.25), s: 1.75 });
  vis(s1tag2, 90, 536, { o: inn(t, .3) * (1 - lin(t, 1.7, 2.0)) });
  vis(s1tag5, 410, 258, { o: inn(t, .9) * (1 - lin(t, 1.7, 2.0)) });
  const bp = pop(t, 1.4, .35);
  vis(s1bubble, 446, 342, { o: lin(t, 1.4, 1.5) * (1 - lin(t, 4.9, 5.2)), s: bp, rot: -4 * (1 - bp) });
  // question panel
  const pp = inn(t, 1.75, .45);
  vis(s1panel, 270, mix(708, 680, pp), { o: pp });
  const q = s1panel.querySelector('.q1') as HTMLElement, a = s1panel.querySelector('.a1') as HTMLElement;
  const ans = lin(t, 4.95, 5.1);
  q.style.opacity = String(1 - ans); a.style.opacity = String(ans);
  const tp = lin(t, 2.0, 5.0);
  (s1panel.querySelector('.vbar i') as HTMLElement).style.transform = `scaleX(${(1 - tp).toFixed(4)})`;
  setText(s1panel, '.tnum', String(Math.max(1, 3 - Math.floor(tp * 3))));
  (a.querySelector('.verdict-good') as HTMLElement).style.transform = `scale(${mix(1.25, 1, eo(lin(t, 5.0, 5.35)))})`;
  (['.t1', '.t2', '.t3'] as const).forEach((sel, k) => {
    const e = a.querySelector(sel) as HTMLElement, p = inn(t, 5.6 + k * .45, .35);
    e.style.opacity = String(p); e.style.transform = `translateY(${(1 - p) * 10}px)`;
  });
  (a.querySelector('.note') as HTMLElement).style.opacity = String(inn(t, 6.9));
}

// =====================================================================
// Scene 2: build the side pot (8.6 – 16.2)
// =====================================================================
const S2 = { a: 8.6, b: 16.2 };
const s2cap = obj('<span>Seat 3 is all in for $100.</span>', 'pill');
const s2head = obj('Build the side pot', 'head');
const s2seats = [obj(seatBox(3, 'All in')), obj(seatBox(5, '$1,865')), obj(seatBox(8, '$2,310'))];
const s2take = [obj(greens(4)), obj(greens(4)), obj(greens(4))];
const s2rest = [null, obj(greens(6)), obj(greens(6))];
const s2lbl = [obj('<span class="amt">All in $100</span>'), obj('<span class="amt">$250</span>'), obj('<span class="amt">$250</span>')];
const s2rule = obj('Take $100 from each bet', 'rule');
const s2main = obj(`<div class="plbl">Main pot</div><div class="pval">+$0</div><div class="pmath">$100 from each of 3 bets</div>`, 'pilelbl');
const s2side = obj(`<div class="plbl">Side pot</div><div class="pval">$0</div><div class="pmath">$150 from Seats 5 and 8</div>`, 'pilelbl');
const s2note = obj('Seat 3 can only win the main pot.', 'note2');
const XS = [110, 270, 430];
ev(9.2, 'chips', 2); ev(9.8, 'chips', 4); ev(10.4, 'chips', 4); ev(10.75, 'whoosh');
ev(11.75, 'chips', 2); ev(11.9, 'chips', 2); ev(12.05, 'chips', 2); ev(12.95, 'chips', 3); ev(13.1, 'chips', 3); ev(13.4, 'ding');

function s2(t: number): void {
  const o = scene(t, S2.a, S2.b);
  const vis = (e: HTMLElement, x: number, y: number, p: P = {}) => put(e, x, y, { ...p, o: (p.o ?? 1) * o });
  vis(s2cap, 270, 150 - 10 * (1 - inn(t, 8.8)), { o: inn(t, 8.8) });
  const hp = pop(t, 10.7, .45);
  vis(s2head, 270, 222, { o: lin(t, 10.7, 10.85), s: mix(.85, 1, hp) });
  const betT = [8.95, 9.55, 10.15];
  XS.forEach((x, k) => {
    vis(s2seats[k], x, 326, { s: 1.5 });
    const b = inn(t, betT[k], .4), boff = k ? 26 : 0;
    const by = mix(326, 452, b);
    // the $100 part moves to the main pot, the rest to the side pot
    const tk = eio(lin(t, 11.5 + k * .15, 12.15 + k * .15));
    const rs = eio(lin(t, 12.6 + (k - 1) * .15, 13.25 + (k - 1) * .15));
    const mainX = 150 + (k - 1) * 54, sideX = 390 + (k === 1 ? -27 : 27);
    vis(s2take[k], mix(x - boff, mainX, tk), mix(by, 640, tk), { o: lin(t, betT[k], betT[k] + .1), s: 1.9 });
    const r = s2rest[k];
    if (r) vis(r, mix(x + 26, sideX, rs), mix(by, 640, rs), { o: lin(t, betT[k], betT[k] + .1), s: 1.9 });
    vis(s2lbl[k], x, by + 46, { o: lin(t, betT[k] + .15, betT[k] + .3) * (1 - lin(t, 11.3, 11.5)), s: 1.5 });
  });
  vis(s2rule, 270, 540, { o: inn(t, 11.0) * (1 - lin(t, 13.6, 13.9)) });
  const mv = Math.round(300 * lin(t, 11.7, 12.4) / 100) * 100, sv = Math.round(300 * lin(t, 12.9, 13.4) / 150) * 150;
  setText(s2main, '.pval', `+${money(mv)}`); setText(s2side, '.pval', money(sv));
  vis(s2main, 150, 722, { o: inn(t, 11.4) });
  vis(s2side, 390, 722, { o: inn(t, 12.5) });
  vis(s2note, 270, 540, { o: inn(t, 13.9) });
}

// =====================================================================
// Scene 3: read the showdown (16.2 – 24.6)
// =====================================================================
const S3 = { a: 16.2, b: 24.6 };
const s3cap = obj('<span>River. Showdown.</span>', 'pill');
const s3q = obj('Who wins?', 'bigq');
const BOARD = ['Ks', '9s', '4d', '7s', '2c'];
const s3board = BOARD.map(c => obj(card(c), 'bcard'));
const HANDS: { seat: number; cards: string[]; tag: string; plays?: number[] }[] = [
  { seat: 3, cards: ['As', 'Qh', '8d', '3c'], tag: 'Ace high' },
  { seat: 5, cards: ['Js', 'Ts', '5d', '5c'], tag: 'Flush, king high', plays: [0, 1] },
  { seat: 8, cards: ['Kh', 'Kd', '6c', '3h'], tag: 'Three kings' },
];
const s3rows = HANDS.map(h => ({
  label: obj(`Seat ${h.seat}`, 'rowlbl'),
  cards: h.cards.map(c => obj(`<div class="flip"><span class="cback"></span>${card(c)}</div>`, 'hcard')),
  tag: obj(h.tag, 'rtag'),
}));
const s3verdict = obj('<div class="vg">Ship it to Seat 5.</div><div class="vs">Omaha plays exactly two hole cards and three from the board.</div>', 'verdict');
const s3pile = obj(chips(1140, false, 6));
ev(16.55, 'card'); ev(16.95, 'card'); ev(17.4, 'card'); ev(17.7, 'card'); ev(18.0, 'card'); ev(18.5, 'whoosh');
ev(18.8, 'tick'); ev(19.8, 'tick'); ev(20.6, 'buzz'); ev(22.45, 'ding'); ev(23.25, 'chips', 6);

function s3(t: number): void {
  const o = scene(t, S3.a, S3.b);
  const vis = (e: HTMLElement, x: number, y: number, p: P = {}) => put(e, x, y, { ...p, o: (p.o ?? 1) * o });
  vis(s3cap, 270, 150, { o: inn(t, 16.35) * (1 - lin(t, 18.3, 18.5)) });
  const qp = pop(t, 18.45, .45);
  vis(s3q, 270, 150, { o: lin(t, 18.45, 18.6) * (1 - lin(t, 22.2, 22.4)), s: mix(.9, 1, qp) });
  // board: flop already out, turn and river dealt
  const W = 66, gap = 8, x0 = 270 - (5 * W + 4 * gap) / 2 + W / 2;
  const dealt = [16.2, 16.2, 16.2, 16.5, 16.9];
  const playsBoard = [0, 1, 3];
  const lift = inn(t, 21.9, .35);
  BOARD.forEach((_, k) => {
    const p = k < 3 ? 1 : inn(t, dealt[k], .3);
    const plays = playsBoard.includes(k);
    const y = 270 + (1 - p) * -40 - (plays ? 10 * lift : 0);
    const e = s3board[k];
    vis(e, x0 + k * (W + gap), y, { o: (k < 3 ? 1 : lin(t, dealt[k], dealt[k] + .12)) * (plays ? 1 : 1 - .55 * lift) });
    (e.querySelector('.card') as HTMLElement).classList.toggle('vplays', plays && lift > .5);
  });
  // hands flip up, then get read
  const flipAt = [17.35, 17.65, 17.95];
  const rowY = [440, 560, 680];
  s3rows.forEach((r, k) => {
    const y = rowY[k], h = HANDS[k];
    const done3 = inn(t, 20.5, .3); // seat 3 read first
    const dim = k === 0 ? done3 : k === 2 ? inn(t, 21.3, .3) : 0;
    const rowO = 1 - .5 * dim;
    vis(r.label, 70, y, { o: inn(t, flipAt[k] - .2) * rowO });
    r.cards.forEach((c, j) => {
      const fp = lin(t, flipAt[k] + j * .05, flipAt[k] + j * .05 + .32);
      const faceUp = fp >= .5;
      const sx = Math.abs(Math.cos(fp * Math.PI));
      const plays = !!h.plays?.includes(j);
      const ly = plays ? 12 * lift : 0;
      vis(c, 168 + j * 62, y - ly, { o: inn(t, flipAt[k] - .25) * (plays || k !== 1 ? rowO : 1 - .5 * lift), sx: Math.max(.02, sx) });
      const f = c.querySelector('.flip') as HTMLElement;
      f.classList.toggle('up', faceUp);
      (c.querySelector('.card') as HTMLElement).classList.toggle('vplays', plays && lift > .5);
    });
    const tagAt = k === 0 ? 20.55 : k === 2 ? 21.35 : 22.0;
    vis(r.tag, 168 + 1.5 * 62, y + 54, { o: inn(t, tagAt) });
    r.tag.querySelector('.c')!.classList.toggle('win', k === 1);
    r.tag.querySelector('.c')!.classList.toggle('lose', k === 0);
  });
  const vp = pop(t, 22.4, .45);
  vis(s3verdict, 270, 150, { o: lin(t, 22.4, 22.55), s: mix(.85, 1, vp) });
  const sh = eio(lin(t, 23.0, 23.6));
  vis(s3pile, mix(270, 470, sh), mix(362, 560, sh), { o: inn(t, 17.0) * (1 - lin(t, 23.55, 23.75)), s: 1.3 });
}

// =====================================================================
// Scene 4: features (24.6 – 29.4)
// =====================================================================
const S4 = { a: 24.6, b: 29.4 };
const s4head = obj('Every answer checked<br>and explained.', 'head2');
const FEATS = ['Pot calls', 'Side pots', 'Showdown reads', '6 or 9 handed', 'Shot clock', 'Daily challenge'];
const s4feats = FEATS.map(f => obj(f, 'feat'));
const s4phone = obj('<div class="phone"><img src="app-pot.jpg" alt=""></div>');
FEATS.forEach((_, k) => ev(25.35 + k * .22, 'tick'));
ev(24.75, 'whoosh');

function s4(t: number): void {
  const o = scene(t, S4.a, S4.b);
  const vis = (e: HTMLElement, x: number, y: number, p: P = {}) => put(e, x, y, { ...p, o: (p.o ?? 1) * o });
  vis(s4head, 270, 150 - 12 * (1 - inn(t, 24.7, .45)), { o: inn(t, 24.7, .45) });
  s4feats.forEach((e, k) => {
    const p = pop(t, 25.35 + k * .22, .35);
    const col = k % 3, row = Math.floor(k / 3);
    vis(e, 104 + col * 166, 250 + row * 52, { o: lin(t, 25.35 + k * .22, 25.45 + k * .22), s: mix(.7, 1, p) });
  });
  const pp = inn(t, 24.8, .7);
  vis(s4phone, 270, mix(1000, 628, pp), { s: mix(1, 1.05, lin(t, 25.4, 29.4)) });
}

// =====================================================================
// Scene 5: end card (29.4 – 33.5)
// =====================================================================
const S5 = { a: 29.4, b: 99 };
const s5logo = obj(LOGO, 'biglogo');
const s5wm = obj('Felt<span>Ready</span>', 'bigwm');
const s5tag = obj('Practice dealing pot limit Omaha.', 'tagline');
const s5free = obj('Free. No account needed to practice.', 'free');
const s5url = obj('feltready.com', 'url');
ev(29.6, 'chips', 3); ev(30.0, 'whoosh'); ev(31.2, 'ding');

function s5(t: number): void {
  const o = lin(t, S5.a, S5.a + .35);
  const vis = (e: HTMLElement, x: number, y: number, p: P = {}) => put(e, x, y, { ...p, o: (p.o ?? 1) * o });
  const lp = pop(t, 29.5, .6);
  vis(s5logo, 270, 350, { s: mix(.2, 1, lp), rot: mix(-200, 0, eo(lin(t, 29.5, 30.1))), o: lin(t, 29.5, 29.65) });
  vis(s5wm, 270, 476 + 14 * (1 - inn(t, 29.95, .45)), { o: inn(t, 29.95, .45) });
  vis(s5tag, 270, 542, { o: inn(t, 30.35, .45) });
  vis(s5free, 270, 582, { o: inn(t, 30.75, .45) });
  const up = pop(t, 31.15, .45), pulse = 1 + .025 * Math.sin(Math.max(0, t - 31.8) * 4);
  vis(s5url, 270, 680, { o: lin(t, 31.15, 31.3), s: mix(.8, 1, up) * pulse });
}

// =====================================================================
export function seek(t: number): void {
  put(mark, 22, 84, { o: 1 - lin(t, 29.1, 29.5) });
  s1(t); s2(t); s3(t); s4(t); s5(t);
}
(window as unknown as Record<string, unknown>).seek = seek;
(window as unknown as Record<string, unknown>).VIDEO = { FPS, DURATION, EVENTS };
seek(Number(new URLSearchParams(location.search).get('t') ?? 0));
