// Answering feedback (see supabase/migrations/20261120000000_feedback_replies.sql).
//
// The owner replies from the stats dashboard. The sender sees replies the next time they open a
// game page, and can write back. A member's messages belong to their account; a signed-out
// sender's belong to a random id this browser keeps (made when they first send feedback).
import { supabase } from './supabase.ts';

const KEY = 'fr-feedback';
const get = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** This browser's sender id, if it has sent feedback before. */
export const senderId = (): string | null => {
  const v = get();
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
};

/** This browser's sender id, made the first time it sends feedback. */
export function ensureSenderId(): string {
  const have = senderId();
  if (have) return have;
  const id = uuid();
  try { localStorage.setItem(KEY, id); } catch { /* private mode: replies just won't find their way back */ }
  return id;
}

export interface Reply { at: string; body: string; owner: boolean }
/** One of the sender's messages and its thread. */
export interface Thread { id: number; at: string; message: string; seen_at: string | null; replies: Reply[] }

/** Owner replies the sender hasn't opened yet. */
export const unreadIn = (t: Thread): number =>
  t.replies.filter(r => r.owner && (!t.seen_at || Date.parse(r.at) > Date.parse(t.seen_at))).length;

/** The sender's answered messages, newest first. Null when there's nothing to ask about or the call failed. */
export async function loadMyThreads(member: boolean): Promise<Thread[] | null> {
  const sender = senderId();
  if (!supabase || (!member && !sender)) return null;
  const { data, error } = await supabase.rpc('my_feedback', { p_sender: sender });
  if (error) { console.warn('FeltReady: replies', error); return null; }
  return (data as Thread[]) || [];
}

/** The sender opened their replies. */
export async function markRepliesSeen(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('feedback_seen', { p_sender: senderId() });
  if (error) console.warn('FeltReady: replies seen', error);
}

/** Write back on a thread. Returns an error message, or null when sent. */
export async function writeBack(id: number, body: string): Promise<string | null> {
  if (!supabase) return 'Replies need accounts, which aren’t set up here.';
  const { data, error } = await supabase.rpc('feedback_write_back', { p_id: id, p_sender: senderId(), p_body: body });
  if (error) { console.warn('FeltReady: write back', error); return 'Couldn’t send that. Check your connection and try again.'; }
  return data === true ? null : 'Couldn’t send that one.';
}

// ---- the owner ----

export interface AdminFeedback {
  id: number; at: string; message: string; email: string | null; member: boolean;
  context: Record<string, unknown> | null;
  /** A reply shows up for them in FeltReady (a member, or a guest who sent it after replies existed). */
  in_app: boolean;
  seen_at: string | null; done_at: string | null; replies: Reply[];
}

/** The latest feedback with threads. Null when the replies migration hasn't run yet. */
export async function loadAdminFeedback(): Promise<AdminFeedback[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('admin_feedback');
  if (error) { console.warn('FeltReady: admin feedback', error); return null; }
  return data as AdminFeedback[];
}

/** Reply to a message (this marks it done). Returns an error message, or null when sent. */
export async function replyToFeedback(id: number, body: string): Promise<string | null> {
  if (!supabase) return 'Accounts aren’t set up.';
  const { error } = await supabase.rpc('admin_reply_feedback', { p_id: id, p_body: body });
  if (error) { console.warn('FeltReady: reply', error); return 'Couldn’t send the reply. Try again.'; }
  return null;
}

/** Mark a message handled, or not. Returns an error message, or null. */
export async function setFeedbackDone(id: number, done: boolean): Promise<string | null> {
  if (!supabase) return 'Accounts aren’t set up.';
  const { error } = await supabase.rpc('admin_feedback_done', { p_id: id, p_done: done });
  if (error) { console.warn('FeltReady: feedback done', error); return 'Couldn’t save that. Try again.'; }
  return null;
}
