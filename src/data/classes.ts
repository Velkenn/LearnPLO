// Classes, from the student's side: join with a code from an instructor, see the classes you're
// in, and leave one (see supabase/migrations/20261116000000_schools.sql). The join calls answer
// { ok: false, error } instead of failing, so a wrong code still counts toward the guessing limit.
import { supabase } from './supabase.ts';

export type JoinError = 'too_many_tries' | 'not_found' | 'expired' | 'closed' | 'full' | 'bad_name';

export interface ClassPreview {
  ok: boolean;
  error: JoinError | null;
  class?: { id: string; name: string };
  org?: { name: string; kind: 'school' | 'card_room' };
  already_in?: boolean;
}

export interface JoinResult {
  ok: boolean;
  error?: JoinError;
  class?: { id: string; name: string };
  org?: { name: string; kind: 'school' | 'card_room' };
}

export interface MyClass {
  class_id: string;
  class_name: string;
  org_name: string;
  org_kind: 'school' | 'card_room';
  /** The name the instructor sees. */
  name: string;
  joined_at: string;
}

/** The longest name a student can give their instructor. */
export const MAX_NAME = 40;

async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Accounts aren’t set up.');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}

export const classPreview = (code: string): Promise<ClassPreview> => call<ClassPreview>('class_preview', { code });
export const joinClass = (code: string, name: string): Promise<JoinResult> => call<JoinResult>('join_class', { code, student_name: name });
export const myClasses = (): Promise<MyClass[]> => call<MyClass[] | null>('my_classes').then(c => c || []);
export const leaveClass = (classId: string): Promise<void> => call('leave_class', { class: classId });

/** What to tell a student about each error. */
export const JOIN_ERRORS: Record<JoinError, string> = {
  too_many_tries: 'Too many codes that didn’t match. Wait an hour, then try again.',
  not_found: 'That code doesn’t match a class. Check it with your instructor.',
  expired: 'That code has expired. Ask your instructor for a new one.',
  closed: 'That class isn’t taking new students right now. Ask your instructor.',
  full: 'That school has no open seats right now. Ask your instructor.',
  bad_name: 'Enter the name your instructor knows you by (up to 40 characters).',
};
