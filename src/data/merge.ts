// Pure rules for combining settings and stats from this device and the account.
import type { Settings, Stats } from '../engine/types.ts';
import { DEFAULT_SETTINGS, DEFAULT_STATS } from '../config.ts';

/** How many answers a stats object holds. Used to decide which copy is newer. */
export const answered = (s: Stats | null | undefined): number => s ? (s.pt || 0) + (s.rt || 0) + (s.st || 0) : 0;

/** Settings from the account laid over defaults, ignoring anything unknown. */
export function cleanSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const v = (raw as Record<string, unknown>)[k];
      if (v !== undefined && typeof v === typeof DEFAULT_SETTINGS[k]) (out as unknown as Record<string, unknown>)[k] = v;
    }
  }
  if (out.seats !== 6 && out.seats !== 9) out.seats = DEFAULT_SETTINGS.seats;
  return out;
}

export function cleanStats(raw: unknown): Stats {
  const out: Stats = { ...DEFAULT_STATS };
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'number' && isFinite(v)) out[k] = v;
  }
  return out;
}

/** Add two sets of counters (used when a guest's session stats join a new account). */
export function addStats(a: Stats, b: Stats): Stats {
  const out: Stats = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k === 'streak' || k === 'best') continue;
    out[k] = (out[k] || 0) + v;
  }
  out.best = Math.max(a.best || 0, b.best || 0);
  out.streak = b.streak || 0;
  return out;
}

/**
 * Stats to use when a member signs in.
 * - Account has stats: use whichever copy (account or this device's cache for that account) has more answers,
 *   since the last save before closing a tab may not have reached the server.
 * - New account: start from this visit's guest stats, or this device's old stats from before accounts existed.
 */
export function pickMemberStats(remote: Stats | null, cached: Stats | null, guest: Stats | null, legacy: Stats | null): Stats {
  if (remote) return answered(cached) > answered(remote) ? cleanStats(cached) : cleanStats(remote);
  if (cached && answered(cached)) return cleanStats(cached);
  const g = guest && answered(guest) ? cleanStats(guest) : null;
  const l = legacy && answered(legacy) ? cleanStats(legacy) : null;
  if (g && l) return addStats(l, g);
  return g || l || { ...DEFAULT_STATS };
}

/** Settings to use when a member signs in: the account's, else this device's old settings, else defaults. */
export function pickMemberSettings(remote: unknown | null, legacy: unknown | null): Settings {
  if (remote && typeof remote === 'object' && Object.keys(remote).length) return cleanSettings(remote);
  if (legacy) return cleanSettings(legacy);
  return { ...DEFAULT_SETTINGS };
}
