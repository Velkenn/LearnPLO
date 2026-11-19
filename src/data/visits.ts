// Counting signed-out visitors for the owner's stats dashboard: how many came, how many played,
// how far they got, how many hands they played, and how many signed up (see supabase/migrations/20261116100000_visitors.sql).
//
// A signed-out browser gets a random id in localStorage. No cookies, no IP addresses, nothing that
// names a person. Browsers that have ever signed in to a member account aren't counted again.
// Calls go straight to the database API with fetch (no supabase-js), so the home page can use
// this too, and the last batch of answers can still go out as the page closes (keepalive).
// Every failure is ignored: counting must never get in the way of dealing.

const env = import.meta.env ?? {};
const url: string = env.VITE_SUPABASE_URL || '', key: string = env.VITE_SUPABASE_KEY || '';

const ID = 'fr-visitor', MEMBER = 'fr-member';
const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/** Counting is on for this visit (accounts set up, signed out, a person's browser). */
let tracking = false;
let pending = 0, pendingHands = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function call(fn: string, body: Record<string, unknown>, keepalive = false): void {
  fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive,
  }).catch(() => { /* ignore */ });
}

/** This browser has signed in before (now, or on an earlier visit). */
export const wasMember = (): boolean => {
  if (get(MEMBER)) return true;
  try { return Object.keys(localStorage).some(k => /^sb-.+-auth-token$/.test(k)); } catch { return false; }
};

const BOTS = /bot|crawl|spider|slurp|facebookexternalhit|preview|lighthouse|headlesschrome/i;

/** Where the visitor came from: ?utm_source (or ?ref), else the referring site, else null (direct). */
export function sourceOf(search: string, referrer: string, here: string): string | null {
  const q = new URLSearchParams(search);
  const tag = (q.get('utm_source') || q.get('ref') || '').trim().toLowerCase();
  if (tag) return tag.slice(0, 80);
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^(www|old|new|out|m|l|lm|mobile)\./, '');
    if (!host || host === here.replace(/^www\./, '')) return null;
    if (host === 't.co') return 'x.com';
    if (/^(.+\.)?google\.[a-z.]+$/.test(host)) return 'google';
    return host.slice(0, 80);
  } catch { return null; }
}

/** Count this page load if the browser is signed out. Call once per page, on load. */
export function trackVisit(): void {
  if (!url || !key || typeof window === 'undefined') return;
  if (wasMember() || BOTS.test(navigator.userAgent)) return;
  // Coming back from a sign-in email: that's a member arriving, not a visitor.
  if (/access_token=/.test(location.hash)) return;
  let id = get(ID);
  if (!id) { id = crypto.randomUUID(); set(ID, id); }
  if (get(ID) !== id) return; // storage is blocked: every load would look like a new visitor
  tracking = true;
  call('track_visit', { v: id, source: sourceOf(location.search, document.referrer, location.hostname), landing: location.pathname.slice(0, 40) });
  const flush = (): void => { if (document.visibilityState === 'hidden') send(null, true); };
  document.addEventListener('visibilitychange', flush);
  window.addEventListener('pagehide', () => send(null, true));
}

function send(step: 'signin' | 'code' | null, keepalive = false): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!tracking || (!pending && !pendingHands && !step)) return;
  const answers = pending, hands = pendingHands; pending = 0; pendingHands = 0;
  call('track_guest', { v: get(ID), answers, step, hands }, keepalive);
}

/** A guest answered a question. Sent in batches, and when the page is hidden or closed. */
export function countAnswer(): void {
  if (!tracking) return;
  pending++;
  timer ??= setTimeout(() => send(null), 20_000);
}

/** A guest finished a hand. Sent with the answers. */
export function countHand(): void {
  if (!tracking) return;
  pendingHands++;
  timer ??= setTimeout(() => send(null), 20_000);
}

/** A guest reached a step toward signing up: opened the sign-in box, or asked for a code (or tried a passkey). */
export const signinStep = (step: 'signin' | 'code'): void => send(step);

/**
 * Signed in: tie this browser's visits to the account, and stop counting it as a visitor.
 * `rpc` is the signed-in Supabase client's rpc, which carries the member's session.
 */
export async function linkVisitor(rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>): Promise<void> {
  if (pending || pendingHands) send(null);
  tracking = false;
  set(MEMBER, '1');
  const id = get(ID);
  if (!id) return;
  try {
    const { error } = await rpc('link_visitor', { v: id });
    if (error) console.warn('FeltReady: link_visitor', error);
  } catch (e) { console.warn('FeltReady: link_visitor', e); }
}
