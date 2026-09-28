// After a push: wait for GitHub's checks on the commit (the Test workflow and Cloudflare's
// Workers Builds) and report them. Polls every 10 seconds and stops as soon as they finish.
//
//   npm run ci:wait            the current commit
//   npm run ci:wait -- abc123  a given commit
import { execSync } from 'node:child_process';

const sha = process.argv[2] || execSync('git rev-parse HEAD').toString().trim();
const remote = execSync('git remote get-url origin').toString().trim();
const repo = (remote.match(/github\.com[/:]([^/]+\/[^/.]+)/) || [])[1] || 'Velkenn/LearnPLO';
// The deploy job only starts once build passes, so these two are enough to know it's over.
const NEED = ['build', 'Workers Builds'];
const LIMIT = 5 * 60 * 1000, t0 = Date.now();

for (;;) {
  let runs = [];
  // curl rather than fetch: it honors the proxy settings some sandboxes need.
  try {
    const body = execSync(`curl -sS --max-time 20 -H "Accept: application/vnd.github+json" https://api.github.com/repos/${repo}/commits/${sha}/check-runs`).toString();
    const json = JSON.parse(body);
    if (json.message) console.log(`GitHub: ${json.message}`);
    runs = json.check_runs || [];
  } catch (e) { console.log(`couldn't reach GitHub (${String(e.message || e).split('\n')[0]}), trying again`); }
  const seen = NEED.every(n => runs.some(r => r.name.startsWith(n)));
  const pending = runs.filter(r => r.status !== 'completed');
  const failed = runs.filter(r => r.status === 'completed' && !['success', 'skipped', 'neutral'].includes(r.conclusion));
  if (failed.length || (seen && !pending.length)) {
    for (const r of runs) console.log(`${r.conclusion === 'success' ? 'ok  ' : (r.conclusion || r.status).padEnd(4)} ${r.name}`);
    console.log(`${failed.length ? 'CHECKS FAILED' : 'all checks passed'} for ${sha.slice(0, 7)} after ${Math.round((Date.now() - t0) / 1000)}s`);
    process.exit(failed.length ? 1 : 0);
  }
  if (Date.now() - t0 > LIMIT) {
    console.log(`still running after 5 minutes: ${runs.map(r => `${r.name} ${r.status}`).join(', ') || 'no checks reported yet'}`);
    process.exit(2);
  }
  await new Promise(r => setTimeout(r, 10000));
}
