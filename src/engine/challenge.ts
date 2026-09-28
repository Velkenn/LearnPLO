// Daily challenge: the same five hands for everyone that day. The browser deals them from a seed;
// the server replays the same seed with the dealer's answers to grade them, so a score can't be
// made up on the client. Dealer answers never change how a hand plays out, which is what makes
// the replay line up with what the browser showed.
import type { Hand, PotQ, Settings } from './types.ts';
import { newHand } from './hand.ts';
import { playHand, type Hooks } from './loop.ts';
import { awardPot, buildShowdown, curPot, gradePicks, liveElig, losersOf } from './showdown.ts';
import { seed } from './rng.ts';
import { DEFAULT_SETTINGS } from '../config.ts';

/** Bump when anything that changes how a challenge hand plays out changes (deal, betting, pots). */
export const CHALLENGE_VERSION = 3;
export const CHALLENGE_HANDS = 5;

/** Everyone plays the same table: 2/5, side pots often, up to 2 pot calls, no countdown. */
export const CHALLENGE_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  stakes: '2/5', speed: 'normal', showPot: true, sbFull: false, side: 'often', timer: 'off', potCalls: 2, chipAmt: true,
};

export type ChallengeKind = 'pot' | 'cut' | 'read';
export type ChallengeAnswer =
  | { k: 'pot'; v: number | null }
  | { k: 'cut'; v: number | null }
  | { k: 'read'; holes: Record<string, number[]>; board: number[] };

/**
 * Replays share the one random generator, and a replay pauses at every hook, so two running at
 * once (two dealers submitting at the same moment on the server) would mix up each other's
 * cards. Every replay below takes its turn through this queue.
 */
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** The seed for hand k of a day (0-based). */
export function handSeed(day: number, k: number): number {
  let h = (day ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Deal hand k of a day's challenge. The random generator stays on this hand's seed, so the rest
 * of the hand (computer players, board) plays out the same everywhere. Call seed(null) when done.
 */
export function dealChallengeHand(day: number, k: number): Hand {
  seed(handSeed(day, k));
  return newHand(CHALLENGE_SETTINGS, k % 6);
}

const isInt = (x: unknown, lo: number, hi: number): x is number => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi;
const distinct = (xs: number[]): boolean => new Set(xs).size === xs.length;

/** A read that can be graded without crashing: 3 board cards, 2 hole cards per picked seat. */
export function validRead(a: { holes: unknown; board: unknown }): a is { holes: Record<string, number[]>; board: number[] } {
  const { holes, board } = a;
  if (!Array.isArray(board) || board.length !== 3 || !board.every(b => isInt(b, 0, 4)) || !distinct(board)) return false;
  if (!holes || typeof holes !== 'object' || Array.isArray(holes)) return false;
  const seats = Object.entries(holes as Record<string, unknown>);
  return seats.length >= 1 && seats.length <= 6 && seats.every(([s, h]) =>
    isInt(Number(s), 0, 5) && String(Number(s)) === s && Array.isArray(h) && h.length === 2 && h.every(x => isInt(x, 0, 3)) && distinct(h));
}

export interface ChallengeResult {
  right: number;
  total: number;
  /** Per hand, each question in the order asked. */
  hands: { kind: ChallengeKind; ok: boolean }[][];
  /** The answers didn't line up with the questions (wrong count or kind): don't trust the score. */
  mismatch: boolean;
}

/**
 * Replay a day's hands. With answers, grade them in the order they were asked; without, just
 * list the questions (every one counts as missed).
 */
export const replayChallenge = (day: number, answers?: ChallengeAnswer[][]): Promise<ChallengeResult> =>
  oneAtATime(() => replay(day, answers));

async function replay(day: number, answers?: ChallengeAnswer[][]): Promise<ChallengeResult> {
  const hands: ChallengeResult['hands'] = [];
  let mismatch = !!answers && (!Array.isArray(answers) || answers.length !== CHALLENGE_HANDS);
  try {
    for (let k = 0; k < CHALLENGE_HANDS; k++) {
      const S = dealChallengeHand(day, k);
      const given = answers && Array.isArray(answers[k]) ? answers[k] : [];
      const qs: { kind: ChallengeKind; ok: boolean }[] = [];
      let j = 0;
      const next = <K extends ChallengeKind>(kind: K): Extract<ChallengeAnswer, { k: K }> | null => {
        const a = given[j++] as ChallengeAnswer | undefined;
        if (!a || typeof a !== 'object' || a.k !== kind) { if (answers) mismatch = true; return null; }
        return a as Extract<ChallengeAnswer, { k: K }>;
      };
      const hooks: Hooks = {
        render() {}, sleep: () => Promise.resolve(), current: () => true, actionDelay: () => 0,
        async askPot(_p, q) { const a = next('pot'); qs.push({ kind: 'pot', ok: !!a && a.v === q.raiseTo }); },
        async askCuts(pots) { for (const pt of pots) { const a = next('cut'); qs.push({ kind: 'cut', ok: !!a && a.v === pt.round }); } },
        uncontested() {},
        showdown() {
          // Same order as the table: side pots first, pots with one live hand pay themselves,
          // and anyone who loses a pot mucks before the next one.
          const sd = buildShowdown(S);
          for (sd.step = 0; sd.step < sd.order.length; sd.step++) {
            const pt = curPot(sd);
            if (liveElig(sd, pt).length < 2) { awardPot(S, sd, pt); continue; }
            const a = next('read');
            const ok = !!a && validRead(a) && gradePicks(S, pt, Object.fromEntries(Object.entries(a.holes).map(([s, h]) => [Number(s), h])), a.board).ok;
            qs.push({ kind: 'read', ok });
            awardPot(S, sd, pt);
            losersOf(sd, pt).forEach(i => sd.mucked.add(i));
          }
        },
      };
      await playHand(S, hooks);
      if (answers && j !== given.length) mismatch = true;
      hands.push(qs);
    }
  } finally {
    seed(null);
  }
  const all = hands.flat();
  return { right: all.filter(q => q.ok).length, total: all.length, hands, mismatch };
}

export type Mix = Record<ChallengeKind | 'repot', number>;

/** How many questions of each kind a day's deal asks (re-pots are also counted as pot calls). */
export const challengeMix = (day: number): Promise<Mix> => oneAtATime(() => mix(day));

async function mix(day: number): Promise<Mix> {
  const m: Mix = { pot: 0, cut: 0, read: 0, repot: 0 };
  const key = await keyFor(day, q => { if (q.repotOf) m.repot++; });
  key.flat().forEach(a => { m[a.k]++; });
  return m;
}

/**
 * A deal worth playing: a re-pot, a couple of side-pot cuts, several reads, and on the short
 * side (five random hands with side pots often run 15 to 35 questions; this keeps it to 16-22).
 */
export const goodMix = (m: Mix): boolean => {
  const total = m.pot + m.cut + m.read;
  return m.repot >= 1 && m.cut >= 2 && m.read >= 4 && total >= 16 && total <= 22;
};

/** Starting from a random number, find the next seed whose deal is worth playing. */
export const pickDaySeed = (start: number): Promise<number> => oneAtATime(async () => {
  let s = start >>> 0;
  for (let n = 0; n < 1000; n++, s = (s + 0x9e3779b9) >>> 0) if (goodMix(await mix(s))) return s;
  return start >>> 0;
});

/** The right answers for a day, in the order they're asked (for tests and local stand-ins). */
export const answerKey = (day: number, onPot?: (q: PotQ) => void): Promise<ChallengeAnswer[][]> =>
  oneAtATime(() => keyFor(day, onPot));

async function keyFor(day: number, onPot?: (q: PotQ) => void): Promise<ChallengeAnswer[][]> {
  const key: ChallengeAnswer[][] = [];
  try {
    for (let k = 0; k < CHALLENGE_HANDS; k++) {
      const S = dealChallengeHand(day, k);
      const out: ChallengeAnswer[] = [];
      await playHand(S, {
        render() {}, sleep: () => Promise.resolve(), current: () => true, actionDelay: () => 0,
        async askPot(_p, q) { onPot?.(q); out.push({ k: 'pot', v: q.raiseTo }); },
        async askCuts(pots) { pots.forEach(pt => out.push({ k: 'cut', v: pt.round! })); },
        uncontested() {},
        showdown() {
          const sd = buildShowdown(S);
          for (sd.step = 0; sd.step < sd.order.length; sd.step++) {
            const pt = curPot(sd);
            if (liveElig(sd, pt).length >= 2) {
              const rows = pt.winners!.map(w => sd.rows.find(r => r.i === w)!);
              out.push({ k: 'read', holes: Object.fromEntries(rows.map(r => [String(r.i), r.best.hole])), board: rows[0].best.board });
              losersOf(sd, pt).forEach(i => sd.mucked.add(i));
            }
            awardPot(S, sd, pt);
          }
        },
      });
      key.push(out);
    }
  } finally {
    seed(null);
  }
  return key;
}

/**
 * A short hash of the answer keys for a few fixed days. Two builds with the same fingerprint deal
 * and grade alike, so comparing the server's (GET .../daily?action=selftest) with this one checks
 * that the deployed function matches the browser.
 */
export const challengeFingerprint = (): Promise<string> => oneAtATime(async () => {
  const keys: ChallengeAnswer[][][] = [];
  for (const d of [1, 20260927, 4000000000]) keys.push(await keyFor(d));
  const s = JSON.stringify(keys);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
});
