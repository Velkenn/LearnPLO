// Schools and card rooms: the instructor's calls (see supabase/migrations/20261116000000_schools.sql).
// Every call is a security definer function that checks the caller is one of the school's
// owners or instructors; the tables themselves aren't reachable through the API.
import type { GameId } from '../config.ts';
import { supabase } from './supabase.ts';

export type OrgRole = 'owner' | 'instructor';

export interface ClassSummary {
  id: string;
  name: string;
  join_code: string;
  code_expires_at: string | null;
  active: boolean;
  created_at: string;
  /** Students in the class now. */
  students: number;
}

export interface Org {
  id: string;
  name: string;
  kind: 'school' | 'card_room';
  role: OrgRole;
  seat_limit: number | null;
  seats_used: number;
  classes: ClassSummary[];
}

/** One drill's numbers for one student, since they joined. */
export interface DrillLine { game: GameId; kind: string; answers: number; right: number; avg_ms: number | null }
export interface MissLine { game: GameId; kind: string; miss: string; count: number }

export interface StudentStats {
  answers: number;
  right: number;
  answers_7d: number;
  last_at: string | null;
  drills: DrillLine[];
  misses: MissLine[];
}

export interface Student {
  user_id: string;
  name: string;
  joined_at: string;
  left_at: string | null;
  /** Null once they've left: the school no longer sees their answers. */
  stats: StudentStats | null;
}

export interface Roster {
  class: { id: string; name: string; join_code: string; code_expires_at: string | null; active: boolean };
  org: { id: string; name: string; seat_limit: number | null; seats_used: number };
  students: Student[];
}

async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Accounts aren’t set up.');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}

/** The schools the signed-in member runs or teaches at, with their classes. Empty for everyone else. */
export const myOrgs = (): Promise<Org[]> => call<Org[] | null>('my_orgs').then(o => o || []);

/** Whether the signed-in member runs or teaches at any school. False on any error. */
export const isInstructor = (): Promise<boolean> => myOrgs().then(o => o.length > 0, () => false);

export const classRoster = (classId: string): Promise<Roster> => call<Roster>('class_roster', { class: classId });

export const createClass = (orgId: string, name: string): Promise<{ id: string; name: string; join_code: string }> =>
  call('create_class', { org: orgId, class_name: name });

export const renameClass = (classId: string, name: string): Promise<void> => call('set_class', { class: classId, class_name: name });

/** Close a class to new students (students in it stay), or reopen it. */
export const setClassOpen = (classId: string, open: boolean): Promise<void> => call('set_class', { class: classId, is_active: open });

/** A new join code; the old one stops working. */
export const newClassCode = (classId: string): Promise<string> => call('new_class_code', { class: classId });

export const removeStudent = (classId: string, userId: string): Promise<void> => call('remove_student', { class: classId, student: userId });

/** Postgres's permission error, which the functions raise for anyone outside the school. */
export const notAllowed = (e: unknown): boolean => (e as { code?: string } | null)?.code === '42501';
