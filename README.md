# LearnPLO

A pot limit Omaha dealer trainer. A six-handed hand plays out on its own, and you deal it:

- **Pot calls.** When a player says “Pot,” announce the raise. Re-pots included.
- **Side pots.** When someone is all in for less, cut the main pot (and any further side pots) at the end of that betting round.
- **Showdown reads.** Pick the two hole cards and three board cards that play, side pots first. Chops, odd chips, and mucking losers are handled like a real table.

Every answer is graded, wrong answers explain the mistake, and there is an optional timer.

## Run it locally

Needs Node 20.19 or newer.

```sh
npm install
npm run dev        # open the printed localhost URL
```

## Checks

```sh
npm test           # unit tests + a 2,600-hand simulation (about 3 seconds)
npm run typecheck  # TypeScript, strict mode
npm run build      # production build into dist/
```

Browser test (plays 40 real hands in Chromium and checks every drill grades correctly):

```sh
npx playwright install chromium   # first time only
npm run build && npx vite preview --port 4173 &
npm run e2e -- http://localhost:4173/ --shots   # screenshots land in e2e/out/
```

## How the code is laid out

```
index.html            page markup
src/
  main.ts             entry point
  app.ts              shared state: current hand, settings, stats
  config.ts           stakes, speeds, timer lengths, defaults
  util.ts             formatting helpers
  game.ts             starts a hand and connects the engine to the drills
  engine/             the game itself, no screen code (this is what the tests exercise)
    types.ts          shared types
    rng.ts            randomness (seedable for tests)
    cards.ts          deck, hand ranking, best Omaha hand
    hand.ts           dealing, betting actions, pot-raise math, computer players
    pots.ts           side-pot cuts and showdown pots
    showdown.ts       winners, mucking, grading reads, paying pots and odd chips
    loop.ts           plays one hand, calling hooks when the dealer is needed
  drills/             each question the dealer answers
    potCall.ts        “Pot” announcements
    cutPot.ts         side-pot cuts
    readHands.ts      showdown reads
  ui/                 drawing and input
    table.ts          the felt, seats, chips, piles, animations
    render.ts         redraws the page from state
    settings.ts       settings sheet
    events.ts         buttons and keyboard
    timer.ts          countdown per question
    sound.ts          chip clicks and vibration
    cards.ts          card and chip HTML
    dom.ts            small DOM helpers
  data/               accounts and saving: Supabase client, sign-in, storage modes, stat merging
  styles/             CSS split by area, pulled together by main.css
tests/                node:test unit tests and the simulation
supabase/migrations/  database tables and row-level security
e2e/drill.mjs         Playwright browser test
```

## Deploying

The live site is https://feltready.com, served by Cloudflare. Cloudflare watches `main`:
each push runs `npm run build`, then `npx wrangler deploy`, which publishes `dist/` as
described in `wrangler.jsonc`. The Worker in the Cloudflare dashboard is named `learnplo`;
keep that name in `wrangler.jsonc` to match.

GitHub Actions (`.github/workflows/deploy.yml`) runs the tests on every push and still
publishes the older copy at `https://velkenn.github.io/LearnPLO/`.

After the first `npm install`, commit `package-lock.json` and switch the workflow's
`npm install` to `npm ci` for repeatable builds.

## Accounts (Supabase)

Without Supabase settings the app runs device-only: everything saves in the browser.
With them:

- **Guests** play the full drill with default settings; stats last for the visit.
- **Signed-in users** (email link or 6-digit code, no password) unlock the training
  settings, and settings, stats, and every answer save to their account.
  On first sign-in, the visit's stats (and any older stats on that device) carry over.

Setup:

1. Run `supabase/migrations/*.sql` in the Supabase SQL editor (or `supabase db push`).
   It creates `profiles`, `user_settings`, `user_stats`, and `attempts`, each locked to
   its owner with row-level security.
2. Put the project URL and publishable key in `.env.production` (already done for the live
   project; copy it to `.env.local` for `npm run dev`):
   ```
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_KEY=<publishable key, sb_publishable_...>
   ```
   Both values are public by design; row-level security is what protects the data.
3. In Supabase **Authentication → URL Configuration**, set the Site URL to the live site
   and add it (plus `http://localhost:5173/**`) to Redirect URLs.
4. In **Authentication → Emails → Magic Link**, include `{{ .Token }}` so the email has a
   code as well as a link (handy when the link opens in a different browser).
5. Before sharing widely, set up custom SMTP (for example Resend) under
   **Authentication → SMTP**. Supabase's built-in email is for testing only.

Code: `src/data/supabase.ts` (client), `auth.ts` (sign-in), `store.ts` (local, guest,
and member storage), `merge.ts` (how device and account stats combine),
`src/ui/account.ts` (the sign-in box).

## Next up

1. Weak-spot tracking from the `attempts` log (which spots you miss, average times).
2. A daily challenge with server-side grading for a leaderboard.
