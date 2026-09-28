// Every check in one command: unit tests and typecheck, then the browser tests in parallel
// against two builds made here with esbuild (no network needed): accounts off (settings open),
// and accounts on with the Supabase stand-in (member and guest).
//
//   npm run check                 unit tests, typecheck, browser tests   (about a minute)
//   npm run check -- --quick      unit tests and typecheck only          (about 10 seconds)
//   npm run check -- --full       more hands per drill run               (about 2 minutes)
//   add --shots to save screenshots in e2e/out/
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { extname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const QUICK = args.includes('--quick'), FULL = args.includes('--full'), SHOTS = args.includes('--shots');
const t0 = Date.now();
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const results = [];

/** Run a command; resolves with its result. `judge` can overrule the exit code. */
function run(name, cmd, cmdArgs, judge = null) {
  const start = Date.now();
  return new Promise(resolve => {
    const p = spawn(cmd, cmdArgs, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0' } });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', code => {
      const r = { name, ok: code === 0, ms: Date.now() - start, out, note: '' };
      if (judge) judge(r);
      results.push(r);
      console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${name.padEnd(34)} ${secs(r.ms)}${r.note}`);
      resolve(r);
    });
  });
}

// ---- unit tests and typecheck, side by side ----
const hasSupabase = existsSync(join(ROOT, 'node_modules/@supabase/supabase-js'));
// Where npm can't install packages (some sandboxes), supabase-js is missing. Its absence causes
// a known set of errors; anything else still fails the check.
const typecheck = run('typecheck', process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '--noEmit', '--pretty', 'false'], r => {
  if (r.ok || hasSupabase) return;
  const errs = r.out.split('\n').filter(l => / error TS\d+/.test(l));
  const known = (l) => /src\/data\/supabase\.ts.*TS2307.*@supabase\/supabase-js/.test(l) || /src\/data\/auth\.ts.*TS70(06|31)/.test(l);
  if (errs.length && errs.every(known)) { r.ok = true; r.note = '  (supabase-js not installed; ignored its missing types)'; }
});
await Promise.all([run('unit tests', 'npm', ['test']), typecheck]);

if (!QUICK) {
  // ---- builds ----
  const req = createRequire(join(ROOT, 'package.json'));
  let esbuild;
  // esbuild comes with vite; where vite isn't installed, use the copy that tsx bundles.
  try { esbuild = req('esbuild'); } catch { esbuild = createRequire(req.resolve('tsx'))('esbuild'); }
  const sites = join(ROOT, 'e2e/out/sites');
  const build = async (dir, env, alias) => {
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    await esbuild.build({ entryPoints: [join(ROOT, 'src/main.ts')], bundle: true, format: 'esm', outfile: join(dir, 'main.js'), define: { 'import.meta.env': JSON.stringify(env) }, alias, logLevel: 'warning' });
    await esbuild.build({ entryPoints: [join(ROOT, 'src/styles/main.css')], bundle: true, outfile: join(dir, 'main.css'), logLevel: 'warning' });
    writeFileSync(join(dir, 'index.html'), readFileSync(join(ROOT, 'index.html'), 'utf8').replace('./src/styles/main.css', './main.css').replace('./src/main.ts', './main.js'));
    cpSync(join(ROOT, 'public'), dir, { recursive: true });
  };
  const bStart = Date.now();
  const stubAlias = { '@supabase/supabase-js': join(ROOT, 'e2e/stub/supabase.js') };
  await Promise.all([
    build(join(sites, 'local'), {}, stubAlias),
    build(join(sites, 'stub'), { VITE_SUPABASE_URL: 'https://stub.supabase.co', VITE_SUPABASE_KEY: 'stub' }, stubAlias),
  ]);
  console.log(`ok   ${'builds (accounts off, stub)'.padEnd(34)} ${secs(Date.now() - bStart)}`);
  const vite = existsSync(join(ROOT, 'node_modules/vite'));
  const viteBuild = vite ? run('vite build', 'npm', ['run', 'build']) : Promise.resolve(console.log('     (vite not installed: skipped npm run build; CI runs it)'));

  // ---- static servers ----
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
  const serve = (dir) => new Promise(resolve => {
    const s = createServer((q, res) => {
      let p = join(dir, decodeURIComponent(new URL(q.url, 'http://x').pathname));
      if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
      res.end(readFileSync(p));
    }).listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}/` }));
  });
  const local = await serve(join(sites, 'local')), stub = await serve(join(sites, 'stub'));

  // ---- browser tests, a few at a time ----
  const n = (quick, full) => String(FULL ? full : quick);
  const shots = SHOTS ? ['--shots'] : [];
  const e2e = [
    ['drill, 6-handed (settings open)', 'drill.mjs', local.url, '--hands', n(10, 40), ...shots],
    ['drill, 9-handed (settings open)', 'drill.mjs', local.url, '--hands', n(6, 20), '--seats', '9', ...shots],
    ['drill, member', 'drill.mjs', `${stub.url}?stub=member`, '--hands', n(6, 16)],
    ['drill, guest', 'drill.mjs', stub.url, '--hands', n(4, 10)],
    ['daily challenge', 'daily.mjs', `${stub.url}?stub=member`, ...shots],
    ['sign-in and passkeys', 'account.mjs', stub.url, ...shots],
    ['welcome, feedback, stats', 'launch.mjs', stub.url, ...shots],
  ];
  const queue = [...e2e], width = Math.max(2, Math.min(4, availableParallelism()));
  await Promise.all([viteBuild, ...Array.from({ length: width }, async () => {
    for (let job; (job = queue.shift());) {
      const [name, file, ...rest] = job;
      await run(name, process.execPath, [join(ROOT, 'e2e', file), ...rest]);
    }
  })]);
  local.s.close(); stub.s.close();
}

const failed = results.filter(r => !r.ok);
for (const r of failed) console.log(`\n---- ${r.name} ----\n${r.out.trim().split('\n').slice(-25).join('\n')}`);
console.log(`\n${failed.length ? `${failed.length} failed` : 'all checks passed'} in ${secs(Date.now() - t0)}${SHOTS ? ' (screenshots in e2e/out/)' : ''}`);
process.exit(failed.length ? 1 : 0);
