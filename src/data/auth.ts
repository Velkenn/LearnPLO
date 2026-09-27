// Sign-in with an email link or a 6-digit code. No passwords.
import { supabase } from './supabase.ts';

export interface Member { id: string; email: string }

let current: Member | null = null;
export const member = (): Member | null => current;

/** Calls back with the signed-in member (or null) now and whenever it changes. */
export function watchAuth(cb: (m: Member | null) => void): void {
  if (!supabase) { cb(null); return; }
  let lastId: string | null | undefined;
  const emit = (m: Member | null) => {
    const id = m ? m.id : null;
    if (id === lastId) return;
    lastId = id; current = m; cb(m);
  };
  void supabase.auth.getSession().then(({ data }) => {
    const u = data.session?.user;
    emit(u ? { id: u.id, email: u.email || '' } : null);
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    const u = session?.user;
    // Defer: Supabase asks that other client calls not run inside this callback.
    setTimeout(() => emit(u ? { id: u.id, email: u.email || '' } : null), 0);
    if (u && /access_token=/.test(location.hash)) history.replaceState(history.state, '', location.pathname + location.search);
  });
}

const friendly = (msg: string): string => {
  if (/rate limit|too many/i.test(msg)) return 'Too many sign-in emails for now. Wait a few minutes and try again.';
  if (/expired|invalid/i.test(msg)) return 'That code is wrong or expired. Request a new one.';
  if (/email/i.test(msg) && /valid/i.test(msg)) return 'That email address doesn’t look right.';
  return msg;
};

/** Email a sign-in link (and code). Returns an error message, or null when sent. */
export async function sendLink(email: string): Promise<string | null> {
  if (!supabase) return 'Accounts aren’t set up yet.';
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true },
  });
  return error ? friendly(error.message) : null;
}

/** Sign in with the 6-digit code from the email. Returns an error message, or null on success. */
export async function verifyCode(email: string, code: string): Promise<string | null> {
  if (!supabase) return 'Accounts aren’t set up yet.';
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  return error ? friendly(error.message) : null;
}

export async function signOut(): Promise<void> {
  if (supabase) await supabase.auth.signOut();
}
