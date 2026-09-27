// Game constants and defaults. Change table stakes, speeds, and timer lengths here.
import type { Settings, Stakes, Speed, Stats, TimerLevel } from './engine/types.ts';

/** This game's id in the attempts log. */
export const GAME = 'plo';

export const POS =['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'] as const;
export const STREETS = ['Preflop', 'Flop', 'Turn', 'River'] as const;

/** [small blind, big blind, smallest bet unit] */
export const STAKES: Record<Stakes, [number, number, number]> = {
  '1/2': [1, 2, 1], '2/5': [2, 5, 5], '5/10': [5, 10, 5], '25/50': [25, 50, 25],
};

/** Milliseconds between player actions. */
export const SPEEDS: Record<Speed, number> = { slow: 1150, normal: 650, fast: 260 };

/** Seconds allowed per question at each timer level. */
export const TIMERS: Record<TimerLevel, { pot: number; build: number; read: number } | null> = {
  off: null,
  relaxed: { pot: 20, build: 45, read: 30 },
  standard: { pot: 12, build: 30, read: 20 },
  fast: { pot: 7, build: 20, read: 12 },
};

export const DEFAULT_SETTINGS: Settings = {
  stakes: '2/5', speed: 'normal', four: false, showPot: true, sbFull: false,
  side: 'some', timer: 'off', potCalls: 1, chipAmt: true, sound: true,
};

export const DEFAULT_STATS: Stats = { pr: 0, pt: 0, rr: 0, rt: 0, sr: 0, st: 0, streak: 0, best: 0 };
