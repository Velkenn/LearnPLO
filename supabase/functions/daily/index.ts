// Daily challenge server (Supabase Edge Function, Deno).
//
//   board   anyone: today's leaderboard (plus your own row when signed in)
//   start   members: sets your leaderboard name if given, starts your clock, returns today's seed
//   submit  members: replays today's hands with your answers, grades them, stops your clock
//   selftest anyone: the engine version and fingerprint, to check a deploy matches the browser
//
// Grading uses the same engine the browser runs (src/engine/challenge.ts). The day runs
// midnight to midnight Central. Tables: supabase/migrations/20260927000500_daily_challenge.sql.
// Deploy: npx supabase functions deploy daily --no-verify-jwt (it checks sign-in itself, and
// guests may read the leaderboard).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { CHALLENGE_HANDS, CHALLENGE_VERSION, challengeFingerprint, pickDaySeed, replayChallenge, type ChallengeAnswer } from '../../../src/engine/challenge.ts';
import { GAME } from '../../../src/config.ts';

const TZ = 'America/Chicago';
const BOARD_SIZE = 25;
/** How long after starting a run can still be submitted. */
const SUBMIT_WINDOW_MS = 3 * 60 * 60 * 1000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (status: number, error: string, message: string): Response => json({ error, message }, status);

const db: SupabaseClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Today's date in Central time, as YYYY-MM-DD. */
const today = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** The signed-in member behind the request, or null for guests (the publishable key isn't a session). */
async function member(req: Request): Promise<{ id: string } | null> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || token.startsWith('sb_')) return null;
  const { data, error } = await db.auth.getUser(token);
  return error || !data.user ? null : { id: data.user.id };
}

/** Today's deal, created on first use. */
async function challenge(day: string): Promise<{ seed: number; version: number }> {
  const read = () => db.from('daily_challenges').select('seed, version').eq('game', GAME).eq('day', day).maybeSingle();
  const found = await read();
  if (found.error) throw found.error;
  if (found.data) return { seed: Number(found.data.seed), version: found.data.version };
  const seed = await pickDaySeed(crypto.getRandomValues(new Uint32Array(1))[0]);
  const ins = await db.from('daily_challenges').upsert({ game: GAME, day, seed, version: CHALLENGE_VERSION }, { onConflict: 'game,day', ignoreDuplicates: true });
  if (ins.error) throw ins.error;
  const again = await read(); // someone else may have created it first
  if (again.error || !again.data) throw again.error ?? new Error('challenge missing');
  return { seed: Number(again.data.seed), version: again.data.version };
}

interface Row { user_id: string; right_count: number; total: number; ms: number }

/** Leaderboard for a day: most right, then fastest. */
async function board(day: string, me: string | null) {
  const { data, error } = await db.from('daily_entries')
    .select('user_id, right_count, total, ms')
    .eq('game', GAME).eq('day', day).not('submitted_at', 'is', null)
    .order('right_count', { ascending: false }).order('ms', { ascending: true })
    .limit(2000);
  if (error) throw error;
  const rows = (data || []) as Row[];
  // Standard ranking: ties on both right and time share a place.
  const ranked = rows.map((r, i) => ({ r, rank: i }));
  ranked.forEach((x, i) => {
    const prev = ranked[i - 1];
    x.rank = prev && prev.r.right_count === x.r.right_count && prev.r.ms === x.r.ms ? prev.rank : i + 1;
  });
  const top = ranked.slice(0, BOARD_SIZE);
  const mine = me ? ranked.find(x => x.r.user_id === me) : undefined;
  const ids = [...new Set([...top.map(x => x.r.user_id), ...(mine ? [me!] : [])])];
  const names = new Map<string, string>();
  if (ids.length) {
    const p = await db.from('profiles').select('id, display_name').in('id', ids);
    if (p.error) throw p.error;
    ((p.data || []) as { id: string; display_name: string | null }[]).forEach(x => names.set(x.id, x.display_name || 'Dealer'));
  }
  const view = (x: { r: Row; rank: number }) => ({
    rank: x.rank, name: names.get(x.r.user_id) || 'Dealer', right: x.r.right_count, total: x.r.total, ms: x.r.ms, me: x.r.user_id === me,
  });
  return { day, players: rows.length, top: top.map(view), me: mine ? view(mine) : null };
}

/** Clean up a leaderboard name. Returns null if it isn't usable. */
function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const n = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return n.length >= 2 && n.length <= 24 ? n : null;
}

async function entry(day: string, userId: string) {
  const { data, error } = await db.from('daily_entries')
    .select('started_at, submitted_at, right_count, total, ms')
    .eq('game', GAME).eq('day', day).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

let serverPrint: Promise<string> | null = null;

/**
 * The browser sends its engine fingerprint when starting. If it differs from ours, that browser
 * deals the hands differently and its answers could never be graded, so stop before the dealer
 * plays, and file it as feedback so it shows on the stats dashboard.
 */
async function sameEngine(userId: string, req: Request, body: Record<string, unknown>): Promise<boolean> {
  if (typeof body.fingerprint !== 'string') return true; // older pages don't send one
  serverPrint ??= challengeFingerprint();
  const ours = await serverPrint;
  if (body.fingerprint === ours) return true;
  const ua = (req.headers.get('user-agent') || '').slice(0, 180);
  console.error('daily: engine fingerprint mismatch', { theirs: body.fingerprint, ours, ua });
  const fb = await db.from('feedback').insert({ user_id: userId, message: 'Daily challenge blocked automatically: this browser deals the hands differently from the server (engine fingerprint mismatch).', context: { auto: 'fingerprint', theirs: String(body.fingerprint).slice(0, 16), ours, version: body.version ?? null, ua } });
  if (fb.error) console.error('daily: could not file the mismatch', fb.error);
  return false;
}

async function start(userId: string, body: Record<string, unknown>, req: Request): Promise<Response> {
  if (!await sameEngine(userId, req, body)) {
    return fail(409, 'engine', 'This browser deals the challenge hands differently from our server, so a run here couldn’t be graded. We’ve been notified. Try the latest Safari or Chrome.');
  }
  const prof = await db.from('profiles').select('display_name').eq('id', userId).maybeSingle();
  if (prof.error) throw prof.error;
  let name = prof.data?.display_name as string | null | undefined;
  if (body.name !== undefined) {
    const clean = cleanName(body.name);
    if (!clean) return fail(400, 'name', 'Use 2 to 24 letters, numbers, or spaces for your leaderboard name.');
    const up = await db.from('profiles').update({ display_name: clean }).eq('id', userId);
    if (up.error) throw up.error;
    name = clean;
  }
  if (!name) return json({ status: 'name' });

  const day = today();
  const ch = await challenge(day);
  let e = await entry(day, userId);
  if (e?.submitted_at) return json({ status: 'done', day, name, result: { right: e.right_count, total: e.total, ms: e.ms }, board: await board(day, userId) });
  if (!e) {
    const ins = await db.from('daily_entries').upsert({ game: GAME, day, user_id: userId }, { onConflict: 'game,day,user_id', ignoreDuplicates: true });
    if (ins.error) throw ins.error;
    e = await entry(day, userId);
  }
  // The clock started on the first start; starting again (after a reload) keeps it running.
  // The server's engine version, not the one the day was picked with: what matters is that the
  // browser deals like the replay will. (A bump mid-day keeps the day's seed.)
  return json({ status: 'play', day, name, seed: ch.seed, version: CHALLENGE_VERSION, hands: CHALLENGE_HANDS, startedAt: e!.started_at });
}

async function submit(userId: string, body: Record<string, unknown>): Promise<Response> {
  const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null;
  if (!day) return fail(400, 'day', 'Missing the challenge day.');
  if (body.version !== CHALLENGE_VERSION) return fail(409, 'version', 'FeltReady was updated. Reload the page to get the latest version.');
  const e = await entry(day, userId);
  if (!e) return fail(404, 'not-started', 'Start the challenge first.');
  if (e.submitted_at) return json({ status: 'done', day, result: { right: e.right_count, total: e.total, ms: e.ms }, board: await board(day, userId) });
  const started = Date.parse(e.started_at), now = Date.now();
  if (now - started > SUBMIT_WINDOW_MS) return fail(410, 'expired', 'This run is too old to submit.');

  const answers = body.answers as ChallengeAnswer[][];
  if (!Array.isArray(answers) || answers.length !== CHALLENGE_HANDS || answers.some(h => !Array.isArray(h) || h.length > 60)) {
    return fail(400, 'answers', 'Those answers don’t match the challenge.');
  }
  const { data: ch, error } = await db.from('daily_challenges').select('seed').eq('game', GAME).eq('day', day).single();
  if (error) throw error;
  const graded = await replayChallenge(Number(ch.seed), answers);
  if (graded.mismatch) return fail(422, 'mismatch', 'Those answers don’t match today’s hands. Reload the page and try again.');

  const ms = Math.max(0, now - started);
  const up = await db.from('daily_entries')
    .update({ submitted_at: new Date(now).toISOString(), right_count: graded.right, total: graded.total, ms, answers })
    .eq('game', GAME).eq('day', day).eq('user_id', userId).is('submitted_at', null);
  if (up.error) throw up.error;
  const done = await entry(day, userId); // the first submit wins if two raced
  return json({ status: 'done', day, result: { right: done!.right_count, total: done!.total, ms: done!.ms }, board: await board(day, userId) });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = new URL(req.url);
    let body: Record<string, unknown> = {};
    if (req.method === 'POST') {
      const text = await req.text();
      if (text.length > 100_000) return fail(413, 'too-big', 'That request is too large.');
      body = text ? JSON.parse(text) : {};
    }
    const action = (body.action as string) || url.searchParams.get('action') || 'board';
    const me = await member(req);
    if (action === 'selftest') return json({ version: CHALLENGE_VERSION, fingerprint: await challengeFingerprint() });
    if (action === 'board') return json(await board(today(), me?.id ?? null));
    if (!me) return fail(401, 'sign-in', 'Sign in to play the daily challenge.');
    if (req.method !== 'POST') return fail(405, 'method', 'Use POST.');
    if (action === 'start') return await start(me.id, body, req);
    if (action === 'submit') return await submit(me.id, body);
    return fail(400, 'action', 'Unknown action.');
  } catch (e) {
    console.error('daily:', e);
    return fail(500, 'server', 'Something went wrong on our end. Try again in a minute.');
  }
});
