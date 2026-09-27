# FeltReady (repo LearnPLO): notes for coding sessions

FeltReady (feltready.com) is a casino dealer trainer; pot limit Omaha is the first game. Vite + TypeScript, no framework. See README.md for the layout.

## Rules for changes

- `src/engine/` never touches the DOM, `window`, or `app`. It takes a `Hand` and returns data.
  All randomness goes through `engine/rng.ts` so tests can seed it.
- The hand loop (`engine/loop.ts`) talks to the outside only through `Hooks`. The browser
  implements them in `game.ts`; `tests/simulate.test.ts` implements them headlessly.
- Drill logic and drill HTML live together in `src/drills/`. Grading rules that don't need
  the DOM belong in the engine (for example `gradePicks` in `engine/showdown.ts`).
- Keep the dealer's language: "Pot is $X", "Ship it to Seat 3", "Chop it", "Cut the main pot".
  Sentence case, no all-caps labels.
- Settings and stats go through `src/data/store.ts`. Three modes: `local` (no Supabase
  configured), `guest` (signed out: default training settings, stats for the visit), and
  `member` (synced to Supabase, answers logged to `attempts`). `app.settings` and `app.stats`
  are replaced on sign-in/out, so never hold on to them in a closure; read them at use time.
- Schema changes go in a new file under `supabase/migrations/`, with row-level security.
  This project doesn't expose new tables to the API automatically, so a new table also needs
  explicit grants to `authenticated` (see `20260927000200_api_grants.sql`), or every request
  fails with "permission denied for table".
- supabase-js queries only run when awaited (or `.then` is called). Never fire one with `void`.
- Each logged answer carries `game` (`GAME` in `config.ts`) and a `detail` object. Wrong answers
  add `detail.miss`, a mistake code from the drill's diagnose function (`readMiss` for reads).
  The weak spots page (`data/weakSpots.ts`) reads these fields, so keep them when changing a drill,
  and give any new mistake code a label in `MISS_LABELS`.
- The daily challenge server (`supabase/functions/daily`) imports `src/engine/` and
  `src/config.ts`, so keep those free of browser APIs. If a change alters how a hand plays out
  (deal, betting, pots, showdown order), bump `CHALLENGE_VERSION`, redeploy the function, and
  check `?action=selftest` returns the fingerprint `npm test` prints (see README).
- New tables that only the server uses (like `daily_*`, `admins`) get RLS on, no policies, and
  grants to `service_role` only. Owner-only reads go through a `security definer` function
  that checks `public.is_admin()` (see `admin_stats()`).
- `worker/` is the Cloudflare Worker. It only sees paths with no file in `dist/` (`/share`
  and 404s), so it never slows normal page loads. Keep it that way.

## Before you commit

```sh
npm test && npm run typecheck && npm run build
```

For UI changes, also run the browser test (`npm run e2e`, see README) and look at the
screenshots in `e2e/out/` on a phone-sized viewport. For anything behind sign-in (weak spots,
the daily challenge, sign-in), build with `e2e/stub/build.sh` and run the tests signed in and
signed out; `e2e/daily.mjs` plays a full challenge and `e2e/account.mjs` covers sign-in and passkeys.

## Poker rules the code relies on

- Pot raise = last bet + pot after calling it. Shortcut: 3 × last bet + everything else out,
  not counting the raiser's own chips. Optional rule: small blind counts as a full blind preflop.
- Side pots are cut at the end of the betting round where a player is all in for less.
  The last pot is always "what's left" and is never asked.
- Showdown reads side pots first. Anyone who loses a pot mucks and can't win smaller pots.
- Chops split evenly; the odd chip goes to the first winner left of the button.
- Omaha hands use exactly two hole cards and three board cards.
