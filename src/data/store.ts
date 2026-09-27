// Where settings and stats are saved. Today: this browser's localStorage.
// Later: a Supabase-backed store with the same interface, used when someone signs in.
import type { Settings, Stats } from '../engine/types.ts';
import { DEFAULT_SETTINGS, DEFAULT_STATS } from '../config.ts';

export interface Store {
  loadSettings(): Settings;
  saveSettings(s: Settings): void;
  loadStats(): Stats;
  saveStats(s: Stats): void;
}

function load<T extends object>(key: string, defaults: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? Object.assign({}, defaults, JSON.parse(v)) : { ...defaults };
  } catch { return { ...defaults }; }
}
function save(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: keep going */ }
}

export const localStore: Store = {
  loadSettings: () => load('plo-dd-settings', DEFAULT_SETTINGS),
  saveSettings: s => save('plo-dd-settings', s),
  loadStats: () => load('plo-dd-stats', DEFAULT_STATS),
  saveStats: s => save('plo-dd-stats', s),
};

export let store: Store = localStore;
export function useStore(s: Store): void { store = s; }
