// Shared state for the running app: the current hand, settings, stats, and a daily challenge run.
import type { Hand, Settings, Stats } from './engine/types.ts';
import { store, useStore, type Attempt, type Store } from './data/store.ts';
import { DEFAULT_STATS } from './config.ts';
import { CHALLENGE_HANDS, CHALLENGE_SETTINGS, type ChallengeAnswer } from './engine/challenge.ts';
import { seed } from './engine/rng.ts';

/** A daily challenge in progress. Answers are kept per hand, in the order asked, for the server to grade. */
export interface ChallengeRun {
  day: string;
  seed: number;
  startedAt: string;
  /** Hand being played (0-based); -1 before the first deal. */
  hand: number;
  /** The current hand has finished. */
  handDone: boolean;
  answers: ChallengeAnswer[][];
  /** Whether each answer was right, as the table graded it (the server's grade is what counts). */
  results: boolean[][];
  /** The server graded it; the results show when the dealer taps "See your results". */
  submitted?: boolean;
}

export const app = {
  S: null as Hand | null,
  settings: store.loadSettings() as Settings,
  stats: store.loadStats() as Stats,
  runId: 0,
  lastBtn: Math.floor(Math.random() * 6),
  challenge: null as ChallengeRun | null,
};

/** Save settings. During a challenge only the comfort settings (sound, four-color deck) are saved. */
export const saveSettings = (): void => {
  if (app.challenge) store.saveSettings({ ...store.loadSettings(), sound: app.settings.sound, four: app.settings.four });
  else store.saveSettings(app.settings);
};
export const saveStats = (): void => store.saveStats(app.stats);

/** Count one answer toward the streak and save. */
export function bump(ok: boolean): void {
  const st = app.stats;
  if (ok) { st.streak++; st.best = Math.max(st.best, st.streak); } else st.streak = 0;
  saveStats();
}

/** Add an answer time. kind: p = pot calls, b = side-pot cuts, r = reads. */
export function recordTime(kind: 'p' | 'b' | 'r', ms: number | null): void {
  if (ms == null) return;
  const st = app.stats;
  st[kind + 'time'] = (st[kind + 'time'] || 0) + ms;
  st[kind + 'n'] = (st[kind + 'n'] || 0) + 1;
}

export function resetStats(): void { app.stats = { ...DEFAULT_STATS }; saveStats(); }

/** Log one answer (kept only for signed-in members). Challenge answers are tagged with the day. */
export const logAttempt = (a: Attempt): void =>
  store.recordAttempt(app.challenge ? { ...a, detail: { ...a.detail, daily: app.challenge.day } } : a);

/** Keep a challenge answer for grading. No-op outside a challenge. */
export function challengeAnswer(a: ChallengeAnswer, ok: boolean): void {
  const c = app.challenge; if (!c || c.hand < 0 || c.handDone) return;
  c.answers[c.hand].push(a); c.results[c.hand].push(ok);
}

/** Begin a challenge run: everyone's table uses the same settings (sound and deck colors stay yours). */
export function beginChallenge(day: string, daySeed: number, startedAt: string): void {
  app.challenge = {
    day, seed: daySeed, startedAt, hand: -1, handDone: true,
    answers: Array.from({ length: CHALLENGE_HANDS }, () => []),
    results: Array.from({ length: CHALLENGE_HANDS }, () => []),
  };
  app.settings = { ...CHALLENGE_SETTINGS, sound: app.settings.sound, four: app.settings.four };
}

/** Back to normal play with your own settings. */
export function endChallenge(): void {
  if (!app.challenge) return;
  app.challenge = null;
  seed(null);
  app.settings = store.loadSettings();
}

/** The last challenge hand is over and the answers can go to the server. */
export const challengeComplete = (): boolean =>
  !!app.challenge && app.challenge.hand === CHALLENGE_HANDS - 1 && app.challenge.handDone;

/** Label for the buttons that deal the next hand. */
export function nextHandLabel(): string {
  const c = app.challenge;
  if (!c) return 'Next hand';
  return c.hand < CHALLENGE_HANDS - 1 ? `Next hand (${c.hand + 2} of ${CHALLENGE_HANDS})` : 'See your results';
}

/** Guests play with default training settings; signing in unlocks them. Challenges use fixed ones. */
export const canCustomize = (): boolean => store.mode !== 'guest' && !app.challenge;
export const storeMode = () => store.mode;
export const memberEmail = (): string => store.email || '';

/** Switch where settings and stats come from (sign-in, sign-out). Ends any challenge run. */
export function switchStore(next: Store): void {
  if (next !== store) store.close?.();
  useStore(next);
  app.challenge = null;
  seed(null);
  app.settings = next.loadSettings();
  app.stats = next.loadStats();
}
