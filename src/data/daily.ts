// Talking to the daily challenge server (supabase/functions/daily). Grading and timing happen there.
import { supabase } from './supabase.ts';
import { CHALLENGE_VERSION, type ChallengeAnswer } from '../engine/challenge.ts';

export interface BoardRow { rank: number; name: string; right: number; total: number; ms: number; me: boolean }
export interface Board { day: string; players: number; top: BoardRow[]; me: BoardRow | null }
export interface DailyResult { right: number; total: number; ms: number }

export type StartReply =
  | { status: 'name' }
  | { status: 'play'; day: string; name: string; seed: number; version: number; hands: number; startedAt: string }
  | { status: 'done'; day: string; name: string; result: DailyResult; board: Board };
export interface SubmitReply { status: 'done'; day: string; result: DailyResult; board: Board }

/** A message that can be shown as is, plus the server's error code ('version', 'name', ...). */
export class DailyError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new DailyError('The daily challenge needs accounts, which aren’t set up here.', 'off');
  const { data, error } = await supabase.functions.invoke('daily', { body });
  if (error) {
    let message = 'Couldn’t reach the challenge server. Check your connection and try again.', code = 'network';
    // Errors from the function come back as JSON with a message meant for the dealer.
    const res = (error as { context?: Response }).context;
    if (res && typeof res.json === 'function') {
      try { const j = await res.json(); if (j?.message) { message = j.message; code = j.error || 'server'; } } catch { /* not JSON */ }
    }
    throw new DailyError(message, code);
  }
  return data as T;
}

export const loadBoard = (): Promise<Board> => call<Board>({ action: 'board' });
/** Start (or resume) today's run. Pass a name to set the leaderboard name first. */
export const startDaily = (name?: string): Promise<StartReply> => call<StartReply>({ action: 'start', ...(name != null && { name }) });
export const submitDaily = (day: string, answers: ChallengeAnswer[][]): Promise<SubmitReply> =>
  call<SubmitReply>({ action: 'submit', day, version: CHALLENGE_VERSION, answers });
