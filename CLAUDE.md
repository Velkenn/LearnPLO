# FeltReady (repo LearnPLO): notes for coding sessions

FeltReady (feltready.com) is a casino dealer trainer; pot limit Omaha is the first game. Vite + TypeScript, no framework. See README.md for the layout.

## Rules for changes

- `src/engine/` never touches the DOM, `window`, or `app`. It takes a `Hand` and returns data.
  All randomness goes through `engine/rng.ts` so tests can seed it. Shuffle with `shuffle()`,
  never `sort(() => rand() - .5)`: each browser engine sorts differently, so the same seed
  would deal differently in Safari than on the server (it broke a live daily challenge run).
- The hand loop (`engine/loop.ts`) talks to the outside only through `Hooks`. The browser
  implements them in `game.ts`; `tests/simulate.test.ts` implements them headlessly.
- Drill logic and drill HTML live together in `src/drills/`. Grading rules that don't need
  the DOM belong in the engine (for example `gradePicks` in `engine/showdown.ts`).
- Keep the dealer's language: "Pot is $X", "Ship it to Seat 3", "Chop it", "Build the side pot".
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

Match the checks to the change, so small fixes stay fast:

- Wording, copy, or styling only: `npm run check -- --quick`, plus one screenshot of the changed
  screen at phone size (390 px wide) if it's visible.
- Anything else (drills, settings, sign-in, weak spots, the daily challenge, the engine):
  `npm run check`. It runs every browser test, signed in and out, in parallel. Add `--shots` for
  UI changes and look at the screenshots in `e2e/out/` at phone size.
- Changes to how a hand plays out (deal, betting, pots, showdown) or before a bigger release:
  `npm run check -- --full`.

After pushing, run `npm run ci:wait` once (it polls and stops when GitHub and Cloudflare finish);
don't sleep a fixed time. For small fixes, it's fine to push and check at the start of the next task.

## Working in a cloud sandbox

- If `npm install` is blocked, the checks still run: `npm run check` builds with the esbuild that
  tsx bundles, skips `npm run build` (CI runs it), and ignores only the type errors caused by
  supabase-js being missing.
- Servers started in the background don't always survive between commands. `npm run check`
  and `marketing/promo/render.mjs` start and stop their own, so prefer them over `http.server`.
- Barlow fonts come from Google Fonts, which the sandbox may block; screenshots then fall back to
  system fonts unless Barlow is installed locally.

## Poker rules the code relies on

- Pot raise = last bet + pot after calling it. Shortcut: 3 × last bet + everything else out,
  not counting the raiser's own chips. Optional rule: small blind counts as a full blind preflop.
- Side pots are built at the end of the betting round where a player is all in for less, from
  that round's bets only: chips from earlier rounds are already in the middle (main pot). The
  dealer is asked what each pot takes from this round (`Pot.round`: the all-in amount from each
  bet, plus dead money up to it). The last pot is always "what's left" and is never asked.
- Showdown reads side pots first. Anyone who loses a pot mucks and can't win smaller pots.
- Chops split evenly; the odd chip goes to the first winner left of the button.
- Omaha hands use exactly two hole cards and three board cards.
