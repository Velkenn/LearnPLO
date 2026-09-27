// Weak spots: accuracy and answer times from a member's logged answers, split by drill and by
// situation (re-pots, side pots, chops...), plus the mistakes they make most. No DOM here.
import type { ReadMiss } from '../engine/showdown.ts';
import type { AttemptRow } from './store.ts';

/** Mistake codes logged with wrong answers (see the diagnose functions in src/drills/). */
export type PotMiss = 'sb-rule' | 'added-only' | 'before-call' | 'skipped-call' | 'after-call' | 'shortcut' | 'high' | 'low';
export type CutMiss = 'dead-money' | 'everything' | 'one-share' | 'high' | 'low';

export type Drill = 'pot' | 'cut' | 'read';
export const DRILLS: { kind: Drill; label: string }[] = [
  { kind: 'pot', label: 'Pot calls' },
  { kind: 'cut', label: 'Side pots' },
  { kind: 'read', label: 'Showdown reads' },
];

/** A situation needs this many answers before it can be called a weak spot. */
export const MIN_ANSWERS = 5;
/** Below this accuracy (with enough answers), a situation is a weak spot. */
export const WEAK_BELOW = 0.9;

type Detail = Record<string, unknown>;
const num = (d: Detail, k: string): number | null => typeof d[k] === 'number' ? d[k] as number : null;

interface Situation { key: string; kind: Drill; label: string; test: (d: Detail) => boolean }

/** The situations each drill is broken into. An answer can count toward more than one. */
export const SITUATIONS: Situation[] = [
  { key: 'pot-preflop', kind: 'pot', label: 'Preflop', test: d => num(d, 'street') === 0 && !d.repot },
  { key: 'pot-postflop', kind: 'pot', label: 'Flop, turn, and river', test: d => (num(d, 'street') ?? 0) > 0 && !d.repot },
  { key: 'pot-repot', kind: 'pot', label: 'Re-pots', test: d => d.repot === true },
  { key: 'pot-sbfull', kind: 'pot', label: 'Small blind counted as a full blind', test: d => d.sbFull === true && num(d, 'street') === 0 },
  { key: 'cut-main', kind: 'cut', label: 'Main pot', test: d => d.pot === 'Main pot' },
  { key: 'cut-side', kind: 'cut', label: 'Side pots (two or more all-ins)', test: d => typeof d.pot === 'string' && d.pot !== 'Main pot' },
  { key: 'cut-dead', kind: 'cut', label: 'With dead money', test: d => d.dead === true },
  { key: 'read-single', kind: 'read', label: 'One pot', test: d => num(d, 'pots') === 1 },
  { key: 'read-side', kind: 'read', label: 'Main pot and one side pot', test: d => num(d, 'pots') === 2 },
  { key: 'read-sides', kind: 'read', label: 'Two or more side pots', test: d => (num(d, 'pots') ?? 0) >= 3 },
  { key: 'read-chop', kind: 'read', label: 'Chops', test: d => d.chop === true },
  { key: 'read-multiway', kind: 'read', label: 'Three or more hands', test: d => (num(d, 'contenders') ?? 0) >= 3 },
  { key: 'read-straight', kind: 'read', label: 'Winner has a straight', test: d => num(d, 'hand') === 4 },
  { key: 'read-flush', kind: 'read', label: 'Winner has a flush', test: d => num(d, 'hand') === 5 },
  { key: 'read-boat', kind: 'read', label: 'Winner has a full house or better', test: d => (num(d, 'hand') ?? 0) >= 6 },
];

/** What each mistake code means, in the dealer's words. */
export const MISS_LABELS: Record<Drill, Record<string, string>> = {
  pot: {
    'sb-rule': 'Counted the small blind the wrong way',
    'added-only': 'Said what they add, not the total',
    'before-call': 'Used the pot before the call',
    'skipped-call': 'Skipped adding the call first',
    'after-call': 'Stopped at the pot after the call',
    'shortcut': '3× rule: counted the last bet twice',
    'high': 'Other miscounts',
    'low': 'Other miscounts',
  } satisfies Record<PotMiss, string>,
  cut: {
    'dead-money': 'Left out dead money',
    'everything': 'Took everything in the middle',
    'one-share': 'Took one player’s share',
    'high': 'Other miscounts',
    'low': 'Other miscounts',
  } satisfies Record<CutMiss, string>,
  read: {
    'omaha-rule': 'Missed the two-card rule',
    'wrong-winner': 'Shipped it to the wrong hand',
    'wrong-five': 'Right player, wrong five',
    'missed-chop': 'Missed a chop',
  } satisfies Record<ReadMiss, string>,
};

export interface Line {
  key: string;
  kind: Drill;
  label: string;
  n: number;
  right: number;
  timeouts: number;
  /** Average answer time in ms, over answers that didn't time out. */
  avgMs: number | null;
}
export const accuracy = (l: Pick<Line, 'n' | 'right'>): number => l.n ? l.right / l.n : 0;
export const isWeak = (l: Line): boolean => l.n >= MIN_ANSWERS && accuracy(l) < WEAK_BELOW;

/** generic: a plain miscount (too high or too low) with no specific cause. Listed after the specific ones. */
export interface Miss { kind: Drill; label: string; n: number; generic: boolean }

export interface Report {
  total: number;
  /** When the oldest answer counted was given. */
  since: string | null;
  drills: (Line & { situations: Line[] })[];
  /** Up to three weakest situations, worst first. */
  focus: Line[];
  /** Mistakes by type, most common first. Answers logged before mistake types existed aren't in here. */
  misses: Miss[];
}

function tally(key: string, kind: Drill, label: string, rows: AttemptRow[]): Line {
  let right = 0, timeouts = 0, time = 0, timed = 0;
  for (const r of rows) {
    if (r.correct) right++;
    if (r.timed_out) timeouts++;
    else if (typeof r.ms === 'number') { time += r.ms; timed++; }
  }
  return { key, kind, label, n: rows.length, right, timeouts, avgMs: timed ? time / timed : null };
}

export function weakSpots(rows: AttemptRow[]): Report {
  const drills = DRILLS.map(({ kind, label }) => {
    const mine = rows.filter(r => r.kind === kind);
    const situations = SITUATIONS.filter(s => s.kind === kind)
      .map(s => tally(s.key, kind, s.label, mine.filter(r => s.test(r.detail || {}))))
      .filter(l => l.n > 0);
    return { ...tally(kind, kind, label, mine), situations };
  });

  const focus = drills.flatMap(d => d.situations).filter(isWeak)
    .sort((a, b) => accuracy(a) - accuracy(b) || b.n - a.n)
    .slice(0, 3);

  const counts = new Map<string, Miss>();
  for (const r of rows) {
    const kind = r.kind as Drill;
    if (!MISS_LABELS[kind] || r.correct) continue;
    const code = r.timed_out ? 'time' : typeof r.detail?.miss === 'string' ? r.detail.miss : null;
    const label = code === 'time' ? 'Ran out of time' : code ? MISS_LABELS[kind][code] : null;
    if (!label) continue;
    const id = `${kind}:${label}`;
    const m = counts.get(id) || { kind, label, n: 0, generic: code === 'high' || code === 'low' };
    m.n++; counts.set(id, m);
  }
  const misses = [...counts.values()].sort((a, b) => Number(a.generic) - Number(b.generic) || b.n - a.n);

  const since = rows.reduce<string | null>((a, r) => !a || r.created_at < a ? r.created_at : a, null);
  return { total: rows.length, since, drills, focus, misses };
}
