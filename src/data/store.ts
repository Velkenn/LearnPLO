// Where settings, stats, and answers are saved.
//
//  local  – accounts aren't set up in this build: everything lives in this browser (the original behavior).
//  guest  – accounts are on, nobody is signed in: default settings, stats for this visit only.
//  member – signed in: settings and stats sync to Supabase; every answer is logged.
import type { Settings, Stats } from '../engine/types.ts';
import { DEFAULT_SETTINGS, DEFAULT_STATS } from '../config.ts';
import { supabase } from './supabase.ts';
import { cleanSettings, cleanStats, pickMemberSettings, pickMemberStats } from './merge.ts';

export type StoreMode = 'local' | 'guest' | 'member';

export interface Attempt {
  kind: 'pot' | 'cut' | 'read';
  correct: boolean;
  timedOut: boolean;
  ms: number | null;
  detail?: Record<string, unknown>;
}

export interface Store {
  mode: StoreMode;
  email?: string;
  loadSettings(): Settings;
  saveSettings(s: Settings): void;
  loadStats(): Stats;
  saveStats(s: Stats): void;
  recordAttempt(a: Attempt): void;
  /** Send anything pending and stop syncing (on sign-out). */
  close?(): void;
}

// ---- browser storage helpers (all failures are ignored: private windows, blocked storage) ----
function read(storage: 'local' | 'session', key: string): unknown | null {
  try { const v = (storage === 'local' ? localStorage : sessionStorage).getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function write(storage: 'local' | 'session', key: string, value: unknown): void {
  try { (storage === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

const K = {
  settings: 'plo-dd-settings',           // local mode, and legacy data from before accounts
  stats: 'plo-dd-stats',
  comfort: 'plo-dd-comfort',             // guest: sound and four-color deck
  guestStats: 'plo-dd-guest-stats',      // guest: this visit (sessionStorage)
  memberSettings: (id: string) => `plo-dd-m-settings-${id}`,
  memberStats: (id: string) => `plo-dd-m-stats-${id}`,
  queue: (id: string) => `plo-dd-m-queue-${id}`,
};

// ---- local: accounts not configured ----
export const localStore: Store = {
  mode: 'local',
  loadSettings: () => cleanSettings(read('local', K.settings)),
  saveSettings: s => write('local', K.settings, s),
  loadStats: () => cleanStats(read('local', K.stats)),
  saveStats: s => write('local', K.stats, s),
  recordAttempt: () => { /* not kept */ },
};

// ---- guest: accounts on, signed out ----
export const guestStore: Store = {
  mode: 'guest',
  loadSettings: () => {
    const c = read('local', K.comfort) as Partial<Settings> | null;
    return { ...DEFAULT_SETTINGS, sound: c?.sound ?? DEFAULT_SETTINGS.sound, four: c?.four ?? DEFAULT_SETTINGS.four };
  },
  saveSettings: s => write('local', K.comfort, { sound: s.sound, four: s.four }),
  loadStats: () => cleanStats(read('session', K.guestStats)),
  saveStats: s => write('session', K.guestStats, s),
  recordAttempt: () => { /* guests aren't logged */ },
};

// ---- member: signed in ----
function debounce(fn: () => void, ms: number): { run: () => void; flush: () => void } {
  let t: ReturnType<typeof setTimeout> | null = null;
  return {
    run: () => { if (t) clearTimeout(t); t = setTimeout(() => { t = null; fn(); }, ms); },
    flush: () => { if (t) { clearTimeout(t); t = null; fn(); } },
  };
}

/** Load a member's settings and stats from Supabase and return a store that keeps them in sync. */
export async function memberStore(id: string, email: string): Promise<Store> {
  const sb = supabase!;
  const [s, t] = await Promise.all([
    sb.from('user_settings').select('data').eq('user_id', id).maybeSingle(),
    sb.from('user_stats').select('data').eq('user_id', id).maybeSingle(),
  ]);
  const remoteSettings = s.data ? (s.data as { data: unknown }).data : null;
  const remoteStats = t.data ? cleanStats((t.data as { data: unknown }).data) : null;
  let settings = pickMemberSettings(remoteSettings, read('local', K.memberSettings(id)) ?? read('local', K.settings));
  let stats = pickMemberStats(remoteStats, read('local', K.memberStats(id)) as Stats | null, read('session', K.guestStats) as Stats | null, read('local', K.stats) as Stats | null);

  const pushSettings = debounce(() => {
    void sb.from('user_settings').upsert({ user_id: id, data: settings, updated_at: new Date().toISOString() });
  }, 700);
  const pushStats = debounce(() => {
    void sb.from('user_stats').upsert({ user_id: id, data: stats, updated_at: new Date().toISOString() });
  }, 1500);

  // Answers wait in a small queue so nothing is lost offline; the queue is sent in batches.
  let sending = false;
  const flushQueue = debounce(async () => {
    if (sending) return;
    const q = (read('local', K.queue(id)) as Record<string, unknown>[] | null) || [];
    if (!q.length) return;
    sending = true;
    const { error } = await sb.from('attempts').insert(q.map(r => ({ ...r, user_id: id })));
    sending = false;
    if (!error) {
      const now = (read('local', K.queue(id)) as unknown[] | null) || [];
      write('local', K.queue(id), now.slice(q.length));
    }
  }, 2000);

  const flushAll = () => { pushSettings.flush(); pushStats.flush(); flushQueue.flush(); };
  const onHidden = () => { if (document.hidden) flushAll(); };
  const onOnline = () => flushQueue.run();
  addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', onHidden);
  addEventListener('online', onOnline);

  // First sign-in on this account: save what we picked right away.
  if (!remoteSettings) pushSettings.run();
  if (!remoteStats) pushStats.run();
  flushQueue.run();

  return {
    mode: 'member',
    email,
    loadSettings: () => ({ ...settings }),
    saveSettings: next => { settings = { ...next }; write('local', K.memberSettings(id), settings); pushSettings.run(); },
    loadStats: () => ({ ...stats }),
    saveStats: next => { stats = { ...next }; write('local', K.memberStats(id), stats); pushStats.run(); },
    recordAttempt: a => {
      const q = (read('local', K.queue(id)) as unknown[] | null) || [];
      q.push({ kind: a.kind, correct: a.correct, timed_out: a.timedOut, ms: a.ms == null ? null : Math.round(a.ms), detail: a.detail ?? null, created_at: new Date().toISOString() });
      write('local', K.queue(id), q.slice(-500));
      flushQueue.run();
    },
    close: () => {
      flushAll();
      removeEventListener('pagehide', flushAll);
      document.removeEventListener('visibilitychange', onHidden);
      removeEventListener('online', onOnline);
    },
  };
}

/** Clear this visit's guest stats (after they've been folded into an account). */
export function clearGuestStats(): void { write('session', K.guestStats, DEFAULT_STATS); }

export let store: Store = supabase ? guestStore : localStore;
export function useStore(s: Store): void { store = s; }
