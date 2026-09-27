// Shared state for the running app: the current hand, settings, and stats.
import type { Hand, Settings, Stats } from './engine/types.ts';
import { store, useStore, type Attempt, type Store } from './data/store.ts';
import { DEFAULT_STATS } from './config.ts';

export const app = {
  S: null as Hand | null,
  settings: store.loadSettings() as Settings,
  stats: store.loadStats() as Stats,
  runId: 0,
  lastBtn: Math.floor(Math.random() * 6),
};

export const saveSettings = (): void => store.saveSettings(app.settings);
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

/** Log one answer (kept only for signed-in members). */
export const logAttempt = (a: Attempt): void => store.recordAttempt(a);

/** Guests play with default training settings; signing in unlocks them. */
export const canCustomize = (): boolean => store.mode !== 'guest';
export const storeMode = () => store.mode;
export const memberEmail = (): string => store.email || '';

/** Switch where settings and stats come from (sign-in, sign-out). */
export function switchStore(next: Store): void {
  if (next !== store) store.close?.();
  useStore(next);
  app.settings = next.loadSettings();
  app.stats = next.loadStats();
}
