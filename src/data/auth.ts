// Sign-in with an emailed 6-digit code (or the email's link), or a passkey. No passwords.
import { supabase, supabaseKey, supabaseUrl } from './supabase.ts';
import { inAppBrowser } from './browser.ts';

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

// ---- passkeys (Face ID, Touch ID, a phone's screen lock, or a password manager) ----
// Turned on in Supabase under Authentication → Passkeys (relying party ID feltready.com).
// A member signs in once with an emailed code, then adds a passkey from the account box.

export interface PasskeyInfo { id: string; friendly_name?: string; created_at: string; last_used_at?: string }

/** This browser can use passkeys: WebAuthn, a secure page, and not an app's built-in browser. */
export const browserCanUsePasskeys = (): boolean =>
  typeof window !== 'undefined' && !!window.PublicKeyCredential && window.isSecureContext && !inAppBrowser(navigator.userAgent);

let passkeysOn: Promise<boolean> | null = null;
/** Passkeys are switched on for the project (the public auth settings say so) and usable here. Asked once per visit. */
export function passkeysAvailable(): Promise<boolean> {
  if (!supabase || !browserCanUsePasskeys()) return Promise.resolve(false);
  passkeysOn ??= fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseKey } })
    .then(r => (r.ok ? r.json() : null))
    .then(j => !!j?.passkeys_enabled)
    .catch(() => false);
  return passkeysOn;
}

/** Turn a passkey error into something to show, or '' when the dealer just closed the prompt. */
export function passkeyMessage(error: unknown): string {
  const e = error as { name?: string; code?: string; message?: string; cause?: { name?: string } } | null;
  if (!e) return '';
  if (e.name === 'NotAllowedError' || e.cause?.name === 'NotAllowedError' || e.name === 'AbortError' || e.code === 'ERROR_CEREMONY_ABORTED') return '';
  switch (e.code) {
    case 'webauthn_credential_not_found': return 'That passkey isn’t on a FeltReady account anymore. Sign in with an emailed code, then add a passkey again.';
    case 'webauthn_credential_exists':
    case 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED': return 'This device already has a passkey for your account.';
    case 'too_many_passkeys': return 'Your account has as many passkeys as it can hold.';
    case 'passkey_disabled': return 'Passkey sign-in isn’t turned on right now. Use an emailed code.';
    case 'webauthn_challenge_expired': return 'That took too long. Try again.';
    case 'email_not_confirmed': return 'Confirm your email first: sign in once with an emailed code.';
  }
  return 'The passkey didn’t work. Try again, or use an emailed code.';
}

/** Sign in with a passkey. Returns a message to show, '' if the prompt was closed, or null on success. */
export async function passkeySignIn(): Promise<string | null> {
  if (!supabase) return 'Accounts aren’t set up yet.';
  try {
    const { error } = await supabase.auth.signInWithPasskey();
    return error ? passkeyMessage(error) : null;
  } catch (e) { return passkeyMessage(e); }
}

/** Add a passkey to the signed-in account. Same returns as passkeySignIn. */
export async function addPasskey(): Promise<string | null> {
  if (!supabase) return 'Accounts aren’t set up yet.';
  try {
    const { error } = await supabase.auth.registerPasskey();
    return error ? passkeyMessage(error) : null;
  } catch (e) { return passkeyMessage(e); }
}

/** The signed-in account's passkeys, or null if they couldn't be loaded. */
export async function listPasskeys(): Promise<PasskeyInfo[] | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.passkey.list();
    return error ? null : (data as PasskeyInfo[]);
  } catch { return null; }
}
