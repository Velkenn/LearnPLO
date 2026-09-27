// Where settings, stats, and answers are saved.
//
//  local  – accounts aren't set up in this build: everything lives in this browser (the original behavior).
//  guest  – accounts are on, nobody is signed in: default settings, stats for this visit only.
//  member – signed in: settings and stats sync to Supabase; every answer is logged.
import type { Settings, Stats } from '../engine/types.ts';
import { DEFAULT_SETTINGS, DEFAULT_STATS, GAME } from '../config.ts';
import { supabase } from './supabase.ts';
import { answered, cleanSettings, cleanStats, pickMemberSettings, pickMemberStats } from './merge.ts';

export type StoreMode = 'local' | 'guest' | 'member';

export interface Attempt {
  kind: 'pot' | 'cut' | 'read';
  correct: boolean;
  timedOut: boolean;
  ms: number | null;
  detail?: Record<string, unknown>;
}

/** One logged answer as it comes back from the attempts table. */
export interface AttemptRow {
  kind: string;
  correct: boolean;
  timed_out: boolean;
  ms: number | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

/** How many recent answers the weak spots page looks at. */
export const ATTEMPTS_WINDOW = 1000;

export interface Store {
  mode: StoreMode;
  email?: string;
  loadSettings(): Settings;
  saveSettings(s: Settings): void;
  loadStats(): Stats;
  saveStats(s: Stats): void;
  recordAttempt(a: Attempt): void;
  /** Members only: this game's latest answers, newest first (answers not yet sent included). */
  loadAttempts?(): Promise<AttemptRow[]>;
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
  // If either read failed (offline, server hiccup), run from this device's copy and don't
  // treat the account as new, so defaults never overwrite what's saved on the server.
  const loaded = !s.error && !t.error;
  if (!loaded) console.warn('FeltReady: could not load account data', s.error ?? t.error);
  const remoteSettings = s.data ? (s.data as { data: unknown }).data : null;
  const remoteStats = t.data ? cleanStats((t.data as { data: unknown }).data) : null;
  let settings = pickMemberSettings(remoteSettings, read('local', K.memberSettings(id)) ?? read('local', K.settings));
  let stats = pickMemberStats(remoteStats, read('local', K.memberStats(id)) as Stats | null, read('session', K.guestStats) as Stats | null, read('local', K.stats) as Stats | null);

  // Supabase queries only run when awaited, so each push awaits its request.
  // A failed push stays marked and is retried on the next change or when the connection returns.
  const upsert = async (table: 'user_settings' | 'user_stats', data: Settings | Stats): Promise<boolean> => {
    const { error } = await sb.from(table).upsert({ user_id: id, data, updated_at: new Date().toISOString() });
    if (error) console.warn(`FeltReady: saving ${table} failed`, error);
    return !error;
  };
  let settingsDirty = false, statsDirty = false;
  const pushSettings = debounce(async () => { settingsDirty = true; if (await upsert('user_settings', settings)) settingsDirty = false; }, 700);
  const pushStats = debounce(async () => { statsDirty = true; if (await upsert('user_stats', stats)) statsDirty = false; }, 1500);

  // Answers wait in a small queue so nothing is lost offline; the queue is sent in batches.
  // Rows queued before the game column existed get the table default ('plo').
  const queued = (): Record<string, unknown>[] => (read('local', K.queue(id)) as Record<string, unknown>[] | null) || [];
  const send = async (): Promise<void> => {
    const q = queued();
    if (!q.length) return;
    const { error } = await sb.from('attempts').insert(q.map(r => ({ ...r, user_id: id })));
    if (error) { console.warn('FeltReady: saving answers failed', error); return; }
    write('local', K.queue(id), queued().slice(q.length));
  };
  // One send at a time; callers share the one in flight.
  let sending: Promise<void> | null = null;
  const sendQueue = (): Promise<void> => {
    sending ??= send()
      .catch(e => { console.warn('FeltReady: saving answers failed', e); })
      .finally(() => { sending = null; });
    return sending;
  };
  const flushQueue = debounce(sendQueue, 2000);

  const flushAll = () => { pushSettings.flush(); pushStats.flush(); flushQueue.flush(); };
  const onHidden = () => { if (document.hidden) flushAll(); };
  const onOnline = () => { if (settingsDirty) pushSettings.run(); if (statsDirty) pushStats.run(); flushQueue.run(); };
  addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', onHidden);
  addEventListener('online', onOnline);

  // New account, or this device has answers the server missed: save what we picked right away.
  if (loaded && !remoteSettings) pushSettings.run();
  if (loaded && (!remoteStats || answered(stats) > answered(remoteStats))) pushStats.run();
  flushQueue.run(); // also sends answers left over from an earlier visit

  return {
    mode: 'member',
    email,
    loadSettings: () => ({ ...settings }),
    saveSettings: next => { settings = { ...next }; write('local', K.memberSettings(id), settings); pushSettings.run(); },
    loadStats: () => ({ ...stats }),
    saveStats: next => { stats = { ...next }; write('local', K.memberStats(id), stats); pushStats.run(); },
    recordAttempt: a => {
      const q = (read('local', K.queue(id)) as unknown[] | null) || [];
      q.push({ game: GAME, kind: a.kind, correct: a.correct, timed_out: a.timedOut, ms: a.ms == null ? null : Math.round(a.ms), detail: a.detail ?? null, created_at: new Date().toISOString() });
      write('local', K.queue(id), q.slice(-500));
      flushQueue.run();
    },
    loadAttempts: async () => {
      // Send what's waiting first so the page counts the answers just given.
      flushQueue.flush();
      await sendQueue();
      const { data, error } = await sb.from('attempts')
        .select('kind, correct, timed_out, ms, detail, created_at')
        .eq('game', GAME)
        .order('created_at', { ascending: false })
        .limit(ATTEMPTS_WINDOW);
      if (error) throw error;
      // Anything still queued (the send failed) counts too.
      const pending = queued().filter(r => (r.game ?? GAME) === GAME).reverse() as unknown as AttemptRow[];
      return [...pending, ...((data ?? []) as AttemptRow[])].slice(0, ATTEMPTS_WINDOW);
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
