// Stand-in for @supabase/supabase-js, for browser tests without a network or a real account.
// e2e/stub/build.sh swaps it in. The URL picks who you are:
//   ?stub=member   signed in as a member with ~330 sample answers and a daily challenge server
//   (anything else) signed out
// The daily challenge grades with the real engine, like supabase/functions/daily does.
import { CHALLENGE_HANDS, CHALLENGE_VERSION, pickDaySeed, replayChallenge } from '../../src/engine/challenge.ts';

const mode = new URLSearchParams(location.search).get('stub');
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'dealer@example.com' };
const session = mode === 'member' ? { user, access_token: 'stub-token' } : null;
window.__inserted = [];

// ---- sample answers for the weak spots page ----
function rows() {
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
  let result = { data: null, error: null };
  const q = {
    select() { if (table === 'attempts') result = { data: [...window.__inserted.slice().reverse(), ...rows()], error: null }; return q; },
    eq() { return q; }, order() { return q; }, limit() { return q; },
    maybeSingle() { result = { data: null, error: null }; return q; },
    upsert() { return q; },
    insert(v) { window.__inserted.push(...v); return q; },
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
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOtp: async () => ({ error: null }), verifyOtp: async () => ({ error: null }), signOut: async () => ({ error: null }),
    },
    from: query,
    functions: { invoke: async (name, { body }) => name === 'daily' ? daily(body) : fail(404, 'missing', 'No such function.') },
  };
}
