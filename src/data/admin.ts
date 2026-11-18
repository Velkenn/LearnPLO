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

export interface StatsDay {
  day: string; visitors?: number; new_members: number;
  /** Members who answered, and their answers. */
  active: number; answers: number;
  /** Signed-out visitors' answers that day, and everyone who answered (members and visitors). Missing until the visitor_days migration has run. */
  guest_answers?: number; players?: number;
  /** Hands played to the end that day, members and visitors (missing until the hands migration has run). */
  hands?: number;
  daily_players: number; daily_avg: number | null;
}
export interface StatsFeedback { at: string; message: string; email: string | null; member: boolean; context: Record<string, unknown> | null }
/** Signed-out visitors over the last 7 days (Central time), and how far they got. */
export interface VisitorStats {
  visitors: number; played: number; opened_signin: number; sent_code: number; signed_up: number;
  /** Came back on another day without signing up. */
  came_back: number;
  /** Visitors who didn't sign up, by how many questions they answered: 0, 1–9, 10–49, 50+. */
  left_after: { none: number; few: number; some: number; lots: number };
  sources: { source: string; visitors: number; played: number; signed_up: number }[];
}
export interface Stats {
  today: string; members: number; members_7d: number; daily_runs: number;
  /** Members' answers, and signed-out visitors' answers (missing until the visitor_days migration has run). */
  answers: number; guest_answers?: number;
  /** Hands played to the end, members and visitors (missing until the hands migration has run). */
  hands?: number;
  days: StatsDay[]; feedback: StatsFeedback[];
  /** Missing until the visitors migration has run. */
  visitors?: VisitorStats;
}

/** The dashboard's numbers. Throws if the member isn't an admin or the call fails. */
export async function loadStats(): Promise<Stats> {
  if (!supabase) throw new Error('Accounts aren’t set up.');
  const { data, error } = await supabase.rpc('admin_stats');
  if (error) throw error;
  return data as Stats;
}
