// Ways to sign in: Google or Apple (Supabase's OAuth flow), an email and password, an emailed code
// (its length is set in Supabase; the box takes 6 to 10 digits) or the email's link, or a passkey.
// Accounts with the same email are one account: Supabase links a Google or Apple sign-in to the
// account that already uses that address (Apple's "Hide My Email" addresses are their own account).
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

/** Sign in with the code from the email. Returns an error message, or null on success. */
export async function verifyCode(email: string, code: string): Promise<string | null> {
  if (!supabase) return 'Accounts aren’t set up yet.';
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  return error ? friendly(error.message) : null;
}

// ---- Google and Apple ----
// Each is switched on in Supabase under Authentication → Sign In / Providers. The buttons only show
// once it is, so the code can ship first. Not offered in an app's built-in browser: Google refuses
// to sign in there, and a sign-in there doesn't last anyway (the account box says so).

export type Provider = 'google' | 'apple';
export const PROVIDERS: Provider[] = ['google', 'apple'];
export const providerName = (p: Provider): string => (p === 'google' ? 'Google' : 'Apple');

/** The providers switched on for the project and usable in this browser, in button order. */
export function providersAvailable(): Promise<Provider[]> {
  if (!supabase || typeof navigator === 'undefined' || inAppBrowser(navigator.userAgent)) return Promise.resolve([]);
  return authSettings().then(j => PROVIDERS.filter(p => !!j?.external?.[p]));
}

const TRIED = 'fr-oauth';
/** Off to Google or Apple. The page comes back here signed in (watchAuth sees it). Returns an error, or null while leaving. */
export async function oauthSignIn(p: Provider): Promise<string | null> {
  if (!supabase) return 'Accounts aren’t set up yet.';
  try { sessionStorage.setItem(TRIED, p); } catch { /* ignore */ }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: p,
    options: { redirectTo: location.origin + location.pathname + location.search },
  });
  return error ? `Couldn’t reach ${providerName(p)}. Try again, or use your email.` : null;
}

/**
 * Back from Google or Apple without signing in: what to say ('' if they just cancelled), or null
 * if this isn't such a visit. Clears the error from the address bar.
 */
export function oauthReturnError(): string | null {
  let tried: string | null = null;
  try { tried = sessionStorage.getItem(TRIED); sessionStorage.removeItem(TRIED); } catch { /* ignore */ }
  const params = new URLSearchParams(location.hash.slice(1) + '&' + location.search.slice(1));
  const code = params.get('error');
  if (!code) return null;
  history.replaceState(history.state, '', location.pathname);
  const why = params.get('error_description') || '';
  const name = tried === 'google' || tried === 'apple' ? providerName(tried) : 'that account';
  if (/email/i.test(why)) return `${name} didn’t share an email address, and FeltReady needs one. Try another way to sign in.`;
  if (/denied|cancel/i.test(code)) return ''; // they backed out
  return `Signing in with ${name} didn’t finish. Try again, or use your email.`;
}

// ---- email and password ----
// Accounts made with an emailed code have no password. They sign in with a code, then set one
// from the account box. Forgot a password? Same thing: an emailed code, then set a new one.

const pwFriendly = (msg: string, code?: string): string => {
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'Wrong email or password. If you’ve always signed in with a code, you don’t have a password yet: email yourself a code, then set one.';
  if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return 'Confirm your email first. Look for the email from FeltReady, or email yourself a code.';
  if (code === 'user_already_exists' || /already registered/i.test(msg)) return 'That email already has an account. Sign in instead, or email yourself a code.';
  if (code === 'weak_password' || /password should|weak/i.test(msg)) return 'Pick a longer password: at least 8 characters, with letters and numbers.';
  if (code === 'signup_disabled') return 'New accounts are paused right now. Try again later.';
  if (code === 'reauthentication_needed') return 'For your security, sign out, sign back in with an emailed code, and then set your password.';
  if (code === 'same_password') return 'That’s already your password.';
  return friendly(msg);
};

/** Shortest password the sign-up box takes. */
export const MIN_PASSWORD = 8;

/** Sign in with an email and password. Returns an error message, or null on success. */
export async function passwordSignIn(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Accounts aren’t set up yet.';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? pwFriendly(error.message, (error as { code?: string }).code) : null;
}

/**
 * Make an account with an email and password. `confirm` is true when Supabase wants the email
 * confirmed first ("Confirm email" on): it sent an email with a link and a code. Otherwise the
 * new member is signed in.
 */
export async function passwordSignUp(email: string, password: string): Promise<{ error: string | null; confirm: boolean }> {
  if (!supabase) return { error: 'Accounts aren’t set up yet.', confirm: false };
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) return { error: pwFriendly(error.message, (error as { code?: string }).code), confirm: false };
  // With "Confirm email" on, an address that already has an account comes back with no identities.
  if (!data.session && data.user && !data.user.identities?.length) return { error: pwFriendly('already registered'), confirm: false };
  return { error: null, confirm: !data.session };
}

/** Confirm a new account with the code from its confirmation email. Returns an error message, or null on success. */
export async function verifySignupCode(email: string, code: string): Promise<string | null> {
  if (!supabase) return 'Accounts aren’t set up yet.';
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'signup' });
  return error ? friendly(error.message) : null;
}

/** Set or change the signed-in member's password. Returns an error message, or null when saved. */
export async function setPassword(password: string): Promise<string | null> {
  if (!supabase) return 'Accounts aren’t set up yet.';
  const { error } = await supabase.auth.updateUser({ password });
  return error ? pwFriendly(error.message, (error as { code?: string }).code) : null;
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

/** The project's public auth settings, asked once per visit (null if they couldn't be read). */
interface AuthSettings { passkeys_enabled?: boolean; external?: Record<string, boolean> }
let settings: Promise<AuthSettings | null> | null = null;
function authSettings(): Promise<AuthSettings | null> {
  if (!supabase) return Promise.resolve(null);
  settings ??= fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseKey } })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);
  return settings;
}

/** Passkeys are switched on for the project (the public auth settings say so) and usable here. */
export function passkeysAvailable(): Promise<boolean> {
  if (!supabase || !browserCanUsePasskeys()) return Promise.resolve(false);
  return authSettings().then(j => !!j?.passkeys_enabled);
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
