// Shared state for the running app: the current hand, settings, and stats.
import type { Hand, Settings, Stats } from './engine/types.ts';
import { store } from './data/store.ts';
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
