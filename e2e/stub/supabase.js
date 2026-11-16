// Stand-in for @supabase/supabase-js, for browser tests without a network or a real account.
// e2e/stub/build.sh swaps it in. The URL picks who you are:
//   ?stub=member   signed in as a member with a few hundred sample answers per game and a daily challenge server
//   (anything else) signed out; a passkey sign-in then signs you in as that member
//   &teach=none    the member isn't an instructor anywhere (by default they own a sample school)
//   &seats=N       the sample school's seat limit (default 20; 3 makes it full)
// Join codes for the sample school: K7Q2PMXA (open class), HC4RW9TB (closed class).
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

// ---- schools: the instructor view (kept for the visit in sessionStorage) ----
const teachNone = new URLSearchParams(location.search).get('teach') === 'none';
const NOW = Date.now(), HOUR = 3600000, DAY_MS = 24 * HOUR;
const iso = ms => new Date(ms).toISOString();
const st = (answers, right, week, lastHoursAgo, drills = [], misses = []) =>
  ({ answers, right, answers_7d: week, last_at: lastHoursAgo == null ? null : iso(NOW - lastHoursAgo * HOUR), drills, misses });
function school() {
  const saved = sessionStorage.getItem('stub-teach');
  if (saved) return JSON.parse(saved);
  return {
    codes: 0,
    tries: 0,
    org: { id: 'org-1', name: 'Texas Gaming Institute', kind: 'school', role: 'owner', seat_limit: Number(new URLSearchParams(location.search).get('seats') || 20) },
    classes: [
      { id: 'class-1', name: 'December PLO', join_code: 'K7Q2PMXA', code_expires_at: null, active: true, created_at: iso(NOW - 10 * DAY_MS), students: [
        { user_id: 'u-sam', name: 'Sam Ortiz', joined_at: iso(NOW - 9 * DAY_MS), left_at: null, stats: st(142, 124, 38, 2, [
          { game: 'plo', kind: 'pot', answers: 60, right: 55, avg_ms: 6200 },
          { game: 'plo', kind: 'cut', answers: 22, right: 17, avg_ms: 14100 },
          { game: 'plo', kind: 'read', answers: 50, right: 44, avg_ms: 12800 },
          { game: 'bomb', kind: 'split', answers: 10, right: 8, avg_ms: 5100 },
        ], [
          { game: 'plo', kind: 'cut', miss: 'dead-money', count: 3 },
          { game: 'plo', kind: 'pot', miss: 'skipped-call', count: 3 },
          { game: 'plo', kind: 'read', miss: 'omaha-rule', count: 2 },
          { game: 'bomb', kind: 'split', miss: 'odd-chip', count: 2 },
        ]) },
        { user_id: 'u-pat', name: 'Pat Nguyen', joined_at: iso(NOW - 8 * DAY_MS), left_at: null, stats: st(80, 51, 12, 30, [
          { game: 'plo', kind: 'pot', answers: 40, right: 28, avg_ms: 9400 },
          { game: 'plo', kind: 'cut', answers: 15, right: 7, avg_ms: 21000 },
          { game: 'plo', kind: 'read', answers: 25, right: 16, avg_ms: 17300 },
        ], [
          { game: 'plo', kind: 'pot', miss: 'after-call', count: 6 },
          { game: 'plo', kind: 'cut', miss: 'one-share', count: 5 },
          { game: 'plo', kind: 'read', miss: 'missed-chop', count: 4 },
        ]) },
        { user_id: 'u-lee', name: 'Lee <Dealer>', joined_at: iso(NOW - DAY_MS), left_at: null, stats: st(0, 0, 0, null) },
        { user_id: 'u-jo', name: 'Jo', joined_at: iso(NOW - 9 * DAY_MS), left_at: iso(NOW - 2 * DAY_MS), stats: null },
      ] },
      { id: 'class-2', name: 'Weekend bootcamp', join_code: 'HC4RW9TB', code_expires_at: null, active: false, created_at: iso(NOW - 30 * DAY_MS), students: [] },
    ],
  };
}
const saveSchool = sc => sessionStorage.setItem('stub-teach', JSON.stringify(sc));
const seatsUsed = sc => new Set(sc.classes.flatMap(c => c.students.filter(m => !m.left_at).map(m => m.user_id))).size;
const NEW_CODES = ['P3NDT8WX', 'R2MVQ7KC', 'W9TF4HZB', 'Y6GJ3NSE'];
const denied = { data: null, error: { code: '42501', message: 'Only this school’s instructors can see the class' } };
window.__teachCalls = [];
const TEACH_CALLS = ['my_orgs', 'create_class', 'class_roster', 'set_class', 'new_class_code', 'remove_student',
  'class_preview', 'join_class', 'my_classes', 'leave_class'];
const ok = data => ({ data, error: null });
/** The student's side, as the member: join with a code, list classes, leave. */
function student(name, args, sc) {
  const me = user.id;
  const mine = c => c.students.find(m => m.user_id === me && !m.left_at);
  if (name === 'my_classes') {
    return ok(sc.classes.filter(mine).map(c => ({ class_id: c.id, class_name: c.name, org_name: sc.org.name, org_kind: sc.org.kind, name: mine(c).name, joined_at: mine(c).joined_at })));
  }
  if (name === 'leave_class') {
    const m = sc.classes.find(k => k.id === args.class) && mine(sc.classes.find(k => k.id === args.class));
    if (m) { m.left_at = new Date().toISOString(); m.stats = null; }
    saveSchool(sc); return ok(null);
  }
  if (sc.tries >= 10) return ok({ ok: false, error: 'too_many_tries' });
  const code = String(args.code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const c = sc.classes.find(k => k.join_code === code);
  if (!c) { sc.tries++; saveSchool(sc); return ok({ ok: false, error: 'not_found' }); }
  const org = { name: sc.org.name, kind: sc.org.kind };
  if (name === 'class_preview') {
    return ok({ ok: true, class: { id: c.id, name: c.name }, org, already_in: !!mine(c), error: c.active ? null : 'closed' });
  }
  // join_class
  const nm = String(args.student_name || '').trim();
  if (!nm || nm.length > 40) return ok({ ok: false, error: 'bad_name' });
  if (mine(c)) { mine(c).name = nm; saveSchool(sc); return ok({ ok: true, class: { id: c.id, name: c.name }, org }); }
  if (!c.active) return ok({ ok: false, error: 'closed' });
  const atSchool = sc.classes.some(mine);
  if (!atSchool && seatsUsed(sc) >= sc.org.seat_limit) return ok({ ok: false, error: 'full' });
  const old = c.students.find(m => m.user_id === me);
  const row = { user_id: me, name: nm, joined_at: new Date().toISOString(), left_at: null, stats: st(0, 0, 0, null) };
  if (old) Object.assign(old, row); else c.students.push(row);
  saveSchool(sc);
  window.__joined = (window.__joined || 0) + 1;
  return ok({ ok: true, class: { id: c.id, name: c.name }, org });
}
function teach(name, args = {}) {
  if (!TEACH_CALLS.includes(name)) return null;
  window.__teachCalls.push({ name, args });
  const sc = school();
  if (['class_preview', 'join_class', 'my_classes', 'leave_class'].includes(name)) return student(name, args, sc);
  if (name === 'my_orgs') {
    if (teachNone) return { data: [], error: null };
    return { data: [{ ...sc.org, seats_used: seatsUsed(sc), classes: sc.classes.map(({ students, ...c }) => ({ ...c, students: students.filter(m => !m.left_at).length })) }], error: null };
  }
  if (teachNone) return denied;
  if (name === 'create_class') {
    const c = { id: `class-${sc.classes.length + 1}`, name: String(args.class_name).trim(), join_code: NEW_CODES[sc.codes++ % NEW_CODES.length], code_expires_at: null, active: true, created_at: new Date().toISOString(), students: [] };
    sc.classes.unshift(c); saveSchool(sc);
    return { data: { id: c.id, name: c.name, join_code: c.join_code, code_expires_at: null }, error: null };
  }
  const c = sc.classes.find(k => k.id === args.class);
  if (!c) return denied;
  if (name === 'class_roster') {
    const { students, ...cls } = c;
    return { data: { class: { id: cls.id, name: cls.name, join_code: cls.join_code, code_expires_at: cls.code_expires_at, active: cls.active },
      org: { id: sc.org.id, name: sc.org.name, seat_limit: sc.org.seat_limit, seats_used: seatsUsed(sc) }, students }, error: null };
  }
  if (name === 'set_class') {
    if (args.class_name != null) c.name = String(args.class_name).trim();
    if (args.is_active != null) c.active = args.is_active;
    saveSchool(sc); return { data: null, error: null };
  }
  if (name === 'new_class_code') { c.join_code = NEW_CODES[sc.codes++ % NEW_CODES.length]; saveSchool(sc); return { data: c.join_code, error: null }; }
  if (name === 'remove_student') {
    const m = c.students.find(k => k.user_id === args.student && !k.left_at);
    if (m) { m.left_at = new Date().toISOString(); m.stats = null; }
    saveSchool(sc); return { data: null, error: null };
  }
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
    rpc: async (name, args) => {
      await new Promise(r => setTimeout(r, 100));
      if (!session) return { data: null, error: { code: '42501', message: 'not allowed' } };
      if (name === 'is_admin') return { data: true, error: null };
      if (name === 'link_visitor') { window.__linked = args?.v ?? null; return { data: null, error: null }; }
      const school = teach(name, args);
      if (school) return school;
      if (name === 'admin_stats') {
        const today = '2026-09-27';
        const days = Array.from({ length: 14 }, (_, i) => {
          const d = new Date(Date.UTC(2026, 8, 27 - i)).toISOString().slice(0, 10);
          return { day: d, visitors: i < 7 ? 30 - i * 3 : 0, new_members: i < 3 ? 3 - i : 0, active: i < 5 ? 6 - i : 0, answers: i < 5 ? 240 - i * 40 : 0, daily_players: i < 2 ? 5 - i : 0, daily_avg: i < 2 ? 84 : null };
        });
        const feedback = [...window.__feedback].reverse().map(f => ({ at: new Date().toISOString(), message: f.message, email: f.email ?? user.email, member: !!session, context: f.context }))
          .concat([{ at: '2026-09-27T20:15:00Z', message: 'At my room the small blind counts as a full blind preflop. Glad that is a setting!', email: 'lupe@example.com', member: true, context: { mode: 'member', hand: 'done', width: 390 } }]);
        const visitors = {
          visitors: 126, played: 71, opened_signin: 18, sent_code: 9, signed_up: 6, came_back: 14,
          left_after: { none: 55, few: 38, some: 22, lots: 5 },
          sources: [{ source: 'reddit.com', visitors: 64, played: 41, signed_up: 4 }, { source: 'direct', visitors: 38, played: 19, signed_up: 2 }, { source: 'google', visitors: 24, played: 11, signed_up: 0 }],
        };
        return { data: { today, members: 14, members_7d: 6, answers: 1480, daily_runs: 9, days, feedback, visitors }, error: null };
      }
      return { data: null, error: { message: 'unknown rpc' } };
    },
    functions: { invoke: async (name, { body }) => name === 'daily' ? daily(body) : fail(404, 'missing', 'No such function.') },
  };
}
