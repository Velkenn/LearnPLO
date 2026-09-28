// Stand-in for @supabase/supabase-js, for browser tests without a network or a real account.
// e2e/stub/build.sh swaps it in. The URL picks who you are:
//   ?stub=member   signed in as a member with a few hundred sample answers per game and a daily challenge server
//   (anything else) signed out; a passkey sign-in then signs you in as that member
// Passkeys only show when /auth/v1/settings says they're on; tests fake that with page.route.
// The daily challenge grades with the real engine, like supabase/functions/daily does.
import { CHALLENGE_HANDS, CHALLENGE_VERSION, pickDaySeed, replayChallenge } from '../../src/engine/challenge.ts';

const mode = new URLSearchParams(location.search).get('stub');
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'dealer@example.com' };
let session = mode === 'member' || sessionStorage.getItem('stub-signed-in') ? { user, access_token: 'stub-token' } : null;
const listeners = [];
const passkeys = JSON.parse(sessionStorage.getItem('stub-passkeys') || '[]');
function signIn() {
  session = { user, access_token: 'stub-token' };
  sessionStorage.setItem('stub-signed-in', '1');
  listeners.forEach(cb => cb('SIGNED_IN', session));
}
window.__inserted = [];   // attempts rows sent
window.__feedback = [];   // feedback rows sent

// ---- sample answers for the weak spots page (pot limit Omaha, or bomb pots) ----
function rows(game) {
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = []; const t0 = Date.UTC(2026, 8, 20);
  const add = (kind, pRight, detail, ms) => {
    const correct = r() < pRight, timed_out = !correct && r() < 0.15;
    const { missPool, ...d } = detail;
    out.push({ kind, correct, timed_out, ms: timed_out ? null : Math.round(ms * (0.6 + r() * 0.8)),
      detail: correct || timed_out ? d : { ...d, miss: missPool[Math.floor(r() * missPool.length)] },
      created_at: new Date(t0 + out.length * 60000).toISOString() });
  };
  const potMiss = ['skipped-call', 'skipped-call', 'after-call', 'shortcut', 'high', 'low'];
  if (game === 'bomb') {
    for (let i = 0; i < 60; i++) add('pot', 0.9, { street: 1 + (i % 3), repot: i % 5 === 0, missPool: potMiss }, 9000);
    for (let i = 0; i < 20; i++) add('cut', 0.8, { pot: 'Main pot', dead: i % 2 === 0, missPool: ['dead-money', 'one-share'] }, 15000);
    for (let i = 0; i < 50; i++) add('split', i % 3 ? 0.95 : 0.6, { odd: i % 3 === 0, pot: i % 4 ? 'Main pot' : 'Side pot', amount: 375, top: 188, missPool: ['odd-chip', 'odd-chip', 'whole'] }, 5000);
    for (let i = 0; i < 70; i++) add('read', i % 2 ? 0.78 : 0.92, { board: i % 2, pots: 1 + (i % 3 === 0), chop: i % 9 === 0, contenders: 3, hand: [3, 4, 5, 6][i % 4], missPool: ['wrong-winner', 'omaha-rule', 'wrong-five'] }, 16000);
    return out.reverse();
  }
  for (let i = 0; i < 90; i++) add('pot', 0.94, { street: 0, repot: false, sbFull: i % 3 === 0, missPool: potMiss }, 7000);
  for (let i = 0; i < 70; i++) add('pot', 0.9, { street: 1 + (i % 3), repot: false, missPool: potMiss }, 9000);
  for (let i = 0; i < 24; i++) add('pot', 0.62, { street: 1 + (i % 3), repot: true, missPool: potMiss }, 12000);
  for (let i = 0; i < 30; i++) add('cut', 0.87, { pot: 'Main pot', dead: i % 2 === 0, missPool: ['dead-money', 'everything', 'one-share'] }, 14000);
  for (let i = 0; i < 9; i++) add('cut', 0.55, { pot: i % 2 ? 'Side pot 1' : 'Side pot 2', dead: false, missPool: ['one-share', 'low'] }, 21000);
  for (let i = 0; i < 80; i++) add('read', 0.93, { pots: 1, chop: false, contenders: 2 + (i % 2), hand: [2, 3, 4, 5, 6][i % 5], missPool: ['omaha-rule', 'wrong-five'] }, 15000);
  for (let i = 0; i < 12; i++) add('read', 0.58, { pots: 1, chop: true, contenders: 2, hand: 4, missPool: ['missed-chop'] }, 18000);
  for (let i = 0; i < 14; i++) add('read', 0.8, { pots: 2 + (i % 2), chop: false, contenders: 3, hand: 5, missPool: ['wrong-winner', 'omaha-rule'] }, 20000);
  return out.reverse(); // newest first
}

function query(table) {
  let result = { data: null, error: null }, game = 'plo';
  const q = {
    select() {
      if (table === 'attempts') result = { get data() { return [...window.__inserted.filter(r => (r.game ?? 'plo') === game).reverse(), ...rows(game)]; }, error: null };
      return q;
    },
    eq(col, v) { if (col === 'game') game = v; return q; }, order() { return q; }, limit() { return q; },
    maybeSingle() { result = { data: null, error: null }; return q; },
    upsert() { return q; },
    insert(v) { (table === 'feedback' ? window.__feedback : window.__inserted).push(...[].concat(v)); return q; },
    then(res, rej) { return new Promise(r => setTimeout(() => r(result), 150)).then(res, rej); },
  };
  return q;
}

// ---- daily challenge server (kept for the visit in sessionStorage, so a reload resumes) ----
const DAY = '2026-09-27';
const state = () => JSON.parse(sessionStorage.getItem('stub-daily') || '{}');
const save = s => sessionStorage.setItem('stub-daily', JSON.stringify(s));
const others = [
  { name: 'Rita at Shuffle', right: 19, total: 19, ms: 301000 },
  { name: 'boxman_dave', right: 18, total: 19, ms: 262000 },
  { name: 'Lupe', right: 18, total: 19, ms: 344000 },
  { name: 'NewDealer22', right: 12, total: 19, ms: 512000 },
];
function board() {
  const s = state();
  const all = [...others.map(o => ({ ...o, me: false }))];
  if (s.result) all.push({ name: s.name, ...s.result, me: true });
  all.sort((a, b) => b.right - a.right || a.ms - b.ms);
  const top = all.map((r, i) => ({ rank: i + 1, ...r }));
  return { day: DAY, players: all.length, top, me: top.find(r => r.me) || null };
}
const fail = (status, error, message) => ({ data: null, error: { message, context: new Response(JSON.stringify({ error, message }), { status }) } });
async function daily(body) {
  await new Promise(r => setTimeout(r, 200));
  const s = state();
  if (body.action === 'board') return { data: board(), error: null };
  if (!session) return fail(401, 'sign-in', 'Sign in to play the daily challenge.');
  if (body.action === 'start') {
    // Tests can pretend the server's engine differs from this browser's.
    if (window.__stubServerPrint && body.fingerprint !== window.__stubServerPrint) {
      return fail(409, 'engine', 'This browser deals the challenge hands differently from our server, so a run here couldn’t be graded. We’ve been notified. Try the latest Safari or Chrome.');
    }
    if (body.name !== undefined) {
      const n = String(body.name).trim();
      if (n.length < 2 || n.length > 24) return fail(400, 'name', 'Use 2 to 24 letters, numbers, or spaces for your leaderboard name.');
      s.name = n; save(s);
    }
    if (!s.name) return { data: { status: 'name' }, error: null };
    if (s.result) return { data: { status: 'done', day: DAY, name: s.name, result: s.result, board: board() }, error: null };
    s.seed ??= await pickDaySeed(12345); s.startedAt ??= new Date().toISOString(); save(s);
    return { data: { status: 'play', day: DAY, name: s.name, seed: s.seed, version: CHALLENGE_VERSION, hands: CHALLENGE_HANDS, startedAt: s.startedAt }, error: null };
  }
  if (body.action === 'submit') {
    if (body.version !== CHALLENGE_VERSION) return fail(409, 'version', 'FeltReady was updated. Reload the page to get the latest version.');
    if (!s.startedAt) return fail(404, 'not-started', 'Start the challenge first.');
    if (!s.result) {
      const g = await replayChallenge(s.seed, body.answers);
      if (g.mismatch) return fail(422, 'mismatch', 'Those answers don’t match today’s hands. Reload the page and try again.');
      s.result = { right: g.right, total: g.total, ms: Date.now() - Date.parse(s.startedAt) }; save(s);
      window.__graded = g;
    }
    return { data: { status: 'done', day: DAY, result: s.result, board: board() }, error: null };
  }
  return fail(400, 'action', 'Unknown action.');
}

export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: cb => { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithOtp: async () => ({ error: null }), verifyOtp: async () => ({ error: null }),
      signOut: async () => { session = null; sessionStorage.removeItem('stub-signed-in'); listeners.forEach(cb => cb('SIGNED_OUT', null)); return { error: null }; },
      // Passkeys: no real WebAuthn ceremony, just the outcome. A passkey added earlier in the visit signs in.
      signInWithPasskey: async () => {
        await new Promise(r => setTimeout(r, 100));
        if (!passkeys.length) return { data: null, error: { code: 'webauthn_credential_not_found', message: 'not found' } };
        signIn(); return { data: { session, user }, error: null };
      },
      registerPasskey: async () => {
        await new Promise(r => setTimeout(r, 100));
        if (!session) return { data: null, error: { code: 'session_missing', message: 'no session' } };
        const k = { id: `pk-${passkeys.length + 1}`, friendly_name: 'iCloud Keychain', created_at: new Date().toISOString() };
        passkeys.push(k); sessionStorage.setItem('stub-passkeys', JSON.stringify(passkeys));
        return { data: k, error: null };
      },
      passkey: { list: async () => ({ data: session ? passkeys.slice() : null, error: session ? null : { message: 'no session' } }) },
    },
    from: query,
    // The stand-in member is an admin, so the stats dashboard can be tested.
    rpc: async name => {
      await new Promise(r => setTimeout(r, 100));
      if (!session) return { data: null, error: { code: '42501', message: 'not allowed' } };
      if (name === 'is_admin') return { data: true, error: null };
      if (name === 'admin_stats') {
        const today = '2026-09-27';
        const days = Array.from({ length: 14 }, (_, i) => {
          const d = new Date(Date.UTC(2026, 8, 27 - i)).toISOString().slice(0, 10);
          return { day: d, new_members: i < 3 ? 3 - i : 0, active: i < 5 ? 6 - i : 0, answers: i < 5 ? 240 - i * 40 : 0, daily_players: i < 2 ? 5 - i : 0, daily_avg: i < 2 ? 84 : null };
        });
        const feedback = [...window.__feedback].reverse().map(f => ({ at: new Date().toISOString(), message: f.message, email: f.email ?? user.email, member: !!session, context: f.context }))
          .concat([{ at: '2026-09-27T20:15:00Z', message: 'At my room the small blind counts as a full blind preflop. Glad that is a setting!', email: 'lupe@example.com', member: true, context: { mode: 'member', hand: 'done', width: 390 } }]);
        return { data: { today, members: 14, members_7d: 6, answers: 1480, daily_runs: 9, days, feedback }, error: null };
      }
      return { data: null, error: { message: 'unknown rpc' } };
    },
    functions: { invoke: async (name, { body }) => name === 'daily' ? daily(body) : fail(404, 'missing', 'No such function.') },
  };
}
