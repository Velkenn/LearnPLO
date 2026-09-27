# LearnPLO: notes for coding sessions

Pot limit Omaha dealer trainer. Vite + TypeScript, no framework. See README.md for the layout.

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

## Before you commit

```sh
npm test && npm run typecheck && npm run build
```

For UI changes, also run the browser test (`npm run e2e`, see README) and look at the
screenshots in `e2e/out/` on a phone-sized viewport.

## Poker rules the code relies on

- Pot raise = last bet + pot after calling it. Shortcut: 3 × last bet + everything else out,
  not counting the raiser's own chips. Optional rule: small blind counts as a full blind preflop.
- Side pots are cut at the end of the betting round where a player is all in for less.
  The last pot is always "what's left" and is never asked.
- Showdown reads side pots first. Anyone who loses a pot mucks and can't win smaller pots.
- Chops split evenly; the odd chip goes to the first winner left of the button.
- Omaha hands use exactly two hole cards and three board cards.
