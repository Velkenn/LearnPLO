// Feedback from dealers, and the owner's stats dashboard (admins only; see
// supabase/migrations/20260927000600_feedback_and_stats.sql).
import { supabase } from './supabase.ts';

/** Send a feedback message. Returns an error message, or null when sent. */
export async function sendFeedback(message: string, email: string | null, context: Record<string, unknown>): Promise<string | null> {
  if (!supabase) return 'Feedback needs accounts, which aren’t set up here.';
  const { error } = await supabase.from('feedback').insert({ message, email: email || null, context });
  if (error) { console.warn('FeltReady: feedback', error); return 'Couldn’t send that. Check your connection and try again.'; }
  return null;
}

/** Whether the signed-in member can see the stats dashboard. */
export async function isAdmin(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('is_admin');
  return !error && data === true;
}

export interface StatsDay { day: string; new_members: number; active: number; answers: number; daily_players: number; daily_avg: number | null }
export interface StatsFeedback { at: string; message: string; email: string | null; member: boolean; context: Record<string, unknown> | null }
export interface Stats {
  today: string; members: number; members_7d: number; answers: number; daily_runs: number;
  days: StatsDay[]; feedback: StatsFeedback[];
}

/** The dashboard's numbers. Throws if the member isn't an admin or the call fails. */
export async function loadStats(): Promise<Stats> {
  if (!supabase) throw new Error('Accounts aren’t set up.');
  const { data, error } = await supabase.rpc('admin_stats');
  if (error) throw error;
  return data as Stats;
}
