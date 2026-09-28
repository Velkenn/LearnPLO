# FeltReady

Live at https://feltready.com. (The repo is still named LearnPLO.)

A pot limit Omaha dealer trainer. A six- or nine-handed hand plays out on its own, and you deal it:

- **Pot calls.** When a player says “Pot,” announce the raise. Re-pots included.
- **Side pots.** When someone is all in for less, build the side pot at the end of that betting round: say how much of this round's bets goes in the main pot (the all-in amount from each bet, plus dead money). What's already in the middle stays in the main pot.
- **Showdown reads.** Pick the two hole cards and three board cards that play, side pots first. Chops, odd chips, and mucking losers are handled like a real table.

Every answer is graded, wrong answers explain the mistake, and there is an optional timer.
Signed-in dealers get a weak spots page (the chart button in the header): accuracy and average
time per drill and per situation (re-pots, side pots with two or more all-ins, chops, and more),
the three spots to work on, and their most common mistakes.

**Daily challenge.** The same five hands for every dealer each day (midnight to midnight
Central). Members only. Ranked by answers right, then by total time from Start to the last
answer, measured on the server. See "Daily challenge" below.

## Run it locally

Needs Node 20.19 or newer.

```sh
npm install
npm run dev        # open the printed localhost URL
```

## Checks

One command runs everything: unit tests and typecheck, then every browser test in parallel
against two builds it makes itself (accounts off, and accounts on with the Supabase stand-in).
It needs no servers and no network.

```sh
npx playwright install chromium   # first time only
npm run check -- --quick   # unit tests + typecheck (about 10 seconds)
npm run check              # plus all browser tests (about a minute)
npm run check -- --full    # more hands per drill run, before a bigger release (about 2 minutes)
npm run check -- --shots   # also save screenshots in e2e/out/
npm run ci:wait            # after a push: wait for GitHub and Cloudflare, report the result
```

The pieces, if you need one on its own:

```sh
npm test           # unit tests + 2,600 six-handed and 1,400 nine-handed simulated hands
npm run typecheck  # TypeScript, strict mode
npm run build      # production build into dist/
```

Browser test (plays 40 real hands in Chromium and checks every drill grades correctly):

```sh
npx playwright install chromium   # first time only
npm run build && npx vite preview --port 4173 &
npm run e2e -- http://localhost:4173/ --shots   # screenshots land in e2e/out/
```

The URL can carry its own query string; the test adds `e2e` to it. When accounts are on, it
also opens the weak spots page.

Accounts without a network: `e2e/stub/build.sh` builds the site with `e2e/stub/supabase.js`
in place of supabase-js (sample answers for weak spots, and a daily challenge server that grades
with the real engine). It only needs an esbuild binary, so it works even where `npm install`
can't reach the registry.

```sh
e2e/stub/build.sh                                    # into e2e/stub/site/
python3 -m http.server 4174 -d e2e/stub/site &
npm run e2e -- "http://localhost:4174/?stub=member" --shots   # signed in
npm run e2e -- http://localhost:4174/ --shots                 # guest
node e2e/daily.mjs "http://localhost:4174/?stub=member" --shots   # the whole daily challenge
node e2e/account.mjs http://localhost:4174/ --shots               # code sign-in and passkeys
node e2e/launch.mjs http://localhost:4174/ --shots                # welcome, feedback, stats
```

## How the code is laid out

```
index.html            page markup
src/
  main.ts             entry point
  app.ts              shared state: current hand, settings, stats, a daily challenge run
  config.ts           stakes, speeds, timer lengths, defaults
  util.ts             formatting helpers
  game.ts             starts a hand and connects the engine to the drills
  engine/             the game itself, no screen code (this is what the tests exercise)
    types.ts          shared types
    rng.ts            randomness (seedable for tests)
    cards.ts          deck, hand ranking, best Omaha hand
    hand.ts           dealing, betting actions, pot-raise math, computer players
    pots.ts           side pots (built from this round's bets) and showdown pots
    showdown.ts       winners, mucking, grading reads, paying pots and odd chips
    loop.ts           plays one hand, calling hooks when the dealer is needed
    challenge.ts      daily challenge: seeded hands, server-side grading, picking a good deal
  drills/             each question the dealer answers
    potCall.ts        “Pot” announcements
    cutPot.ts         building side pots
    readHands.ts      showdown reads
  ui/                 drawing and input
    table.ts          the felt, seats, chips, piles, animations
    render.ts         redraws the page from state
    settings.ts       settings sheet
    weakSpots.ts      weak spots sheet
    daily.ts          daily challenge strip, sheet, and leaderboard
    welcome.ts        first-visit welcome above the table
    feedback.ts       "Send feedback" sheet
    stats.ts          the owner's stats dashboard (admins only)
    events.ts         buttons and keyboard
    timer.ts          countdown per question
    sound.ts          chip clicks and vibration
    cards.ts          card and chip HTML
    dom.ts            small DOM helpers
  data/               accounts and saving: Supabase client, sign-in, storage modes, stat merging,
                      weakSpots.ts (turns logged answers into the weak spots report),
                      daily.ts (calls to the daily challenge server)
  styles/             CSS split by area, pulled together by main.css
tests/                node:test unit tests and the simulation
supabase/migrations/  database tables and row-level security
supabase/functions/daily/  the daily challenge server (Edge Function)
e2e/drill.mjs         Playwright browser test: hands and drills
e2e/daily.mjs         Playwright browser test: the daily challenge
e2e/account.mjs       Playwright browser test: sign-in, in-app browser notice, passkeys
e2e/launch.mjs        Playwright browser test: first-visit welcome, feedback, stats dashboard
worker/               the Cloudflare Worker: link previews for shared daily scores (/share)
e2e/stub/             stand-in for supabase-js, and a build script that uses it
e2e/check.mjs         npm run check: every check in one command
e2e/ci-wait.mjs       npm run ci:wait: waits for GitHub's checks on a pushed commit
marketing/promo/      the promo video, animated in code (see its README)
```

## Deploying

The live site is https://feltready.com, served by Cloudflare. Cloudflare watches `main`:
each push runs `npm run build`, then `npx wrangler deploy`, which publishes `dist/` and the
small Worker in `worker/` as described in `wrangler.jsonc`. Files are served straight from
`dist/`; the Worker only runs for paths with no file. Today that's `/share`, which returns the
page with a shared daily score in its link preview (iMessage, Reddit, and Facebook read these
tags without running scripts). The Worker in the Cloudflare dashboard is named `learnplo`;
keep that name in `wrangler.jsonc` to match.

Visitor numbers: turn on **Cloudflare Web Analytics** for feltready.com in the Cloudflare
dashboard (Analytics & Logs → Web Analytics, automatic setup). It's free and cookie-free,
and needs no code here. Sign-ups, active members, answers, daily runs, and feedback are on the
stats dashboard in the app (account box → "Open the stats dashboard", admins only).

GitHub Actions (`.github/workflows/deploy.yml`) runs the tests on every push. It also
publishes `moved/index.html` to the old address, `https://velkenn.github.io/LearnPLO/`,
so old links forward to feltready.com.

After the first `npm install`, commit `package-lock.json` and switch the workflow's
`npm install` to `npm ci` for repeatable builds.

## Accounts (Supabase)

Without Supabase settings the app runs device-only: everything saves in the browser.
With them:

- **Guests** play the full drill with default settings; stats last for the visit.
- **Signed-in users** (emailed sign-in code, or a passkey; no passwords) unlock the training
  settings, and settings, stats, and every answer save to their account.
  On first sign-in, the visit's stats (and any older stats on that device) carry over.

Setup:

1. Run `supabase/migrations/*.sql` in the Supabase SQL editor (or `supabase db push`).
   It creates `profiles`, `user_settings`, `user_stats`, and `attempts`, each locked to
   its owner with row-level security. `attempts.game` says which game an answer came from
   (`'plo'` for now; `GAME` in `src/config.ts`).
2. Put the project URL and publishable key in `.env.production` (already done for the live
   project; copy it to `.env.local` for `npm run dev`):
   ```
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_KEY=<publishable key, sb_publishable_...>
   ```
   Both values are public by design; row-level security is what protects the data.
3. In Supabase **Authentication → URL Configuration**, set the Site URL to the live site
   and add it (plus `http://localhost:5173/**`) to Redirect URLs.
4. In **Authentication → Emails → Magic Link** (and Confirm signup), paste
   `supabase/templates/sign-in.html`. It leads with the code: the sign-in box asks for
   it, because typing it in signs in the browser you're using. On phones the email's link often
   opens in another app's browser (the Google app's, usually), which forgets the sign-in; the
   page warns people who are in one (`src/data/browser.ts`).
5. Passkeys: **Authentication → Passkeys**, turn on passkey authentication with
   display name `FeltReady`, relying party ID `feltready.com`, and origin
   `https://feltready.com`. Don't change the relying party ID later: every passkey is tied
   to it. The page reads `passkeys_enabled` from the public auth settings and only shows
   passkey buttons when it's on (and never in an app's built-in browser). Members add a
   passkey from the account box after signing in once with a code.
6. Feedback and the stats dashboard (migration `20260927000600`): anyone can send feedback,
   nobody can read it through the API, and only members in `admins` see the dashboard. Add an
   admin in the SQL editor:
   `insert into public.admins select id from auth.users where email = 'you@example.com';`
7. Before sharing widely, set up custom SMTP (for example Resend) under
   **Authentication → SMTP**. Supabase's built-in email is for testing only.

Code: `src/data/supabase.ts` (client), `auth.ts` (sign-in), `store.ts` (local, guest,
and member storage), `merge.ts` (how device and account stats combine),
`src/ui/account.ts` (the sign-in box).

## Daily challenge

Everyone deals the same five hands each day: $2/$5, side pots often, up to two pot calls a
hand, no countdown. The hands come from a seed, and dealer answers never change how a hand plays
out, so the server can replay the day and grade the answers itself.

- **Start** (`daily` function, `start`): members only. Asks for a leaderboard name the first
  time (2–24 characters, saved as `profiles.display_name`). Picks the day's seed on first use,
  starts the member's clock, and returns the seed. Starting again after a reload returns the
  same seed and the clock keeps running. One graded run per member per day.
- **Play**: the browser deals hand k with `dealChallengeHand(seed, k)` and keeps every answer
  in order. Training settings are locked to the challenge's; sound and deck colors stay yours.
  Answers are also logged to `attempts` like any others, with `detail.daily` set to the day.
- **Submit** (`submit`): after the fifth hand. The server replays the hands with the answers
  (`replayChallenge`), stores the score and the server-measured time, and returns the
  leaderboard. Answers that don't line up with the hands are refused rather than scored.
- **Leaderboard** (`board`): anyone, including guests. Top 25 plus your own row.

The seed is picked so the day has at least one re-pot, two side-pot questions, four reads, and
16–22 questions in all (about 5–7 minutes). Tables: `daily_challenges`, `daily_entries`
(migration `20260927000500`); only the function's service role can touch them.

**If you change the engine** in a way that changes how hands play out (dealing, betting, pots,
showdown), bump `CHALLENGE_VERSION` in `src/engine/challenge.ts` and redeploy the function the
same day the site deploys. Old pages then get "Reload the page" instead of a wrong grade.

Deploying the function (it imports `src/engine/` and `src/config.ts`):

```sh
npx supabase functions deploy daily --no-verify-jwt --project-ref uzeqcsigqnjvqsnvymfb
```

If your CLI can't follow the imports outside `supabase/`, bundle first and deploy the one file
(this is how it was deployed the first time):

```sh
npx esbuild supabase/functions/daily/index.ts --bundle --format=esm --platform=neutral \
  --target=es2022 --external:'npm:*' --legal-comments=none --outfile=/tmp/daily/index.js
```

Then check that the deployed engine matches this one. The fingerprint must equal the one
`npm test` prints. Browsers send their own fingerprint when a dealer taps Start; if it differs
(a browser that deals differently), the run is refused before any hands are dealt and the
mismatch is filed as feedback, so it shows on the stats dashboard.

```sh
curl 'https://uzeqcsigqnjvqsnvymfb.supabase.co/functions/v1/daily?action=selftest'
```

## Next up

1. More games under one roof: a home page listing games, pot limit Omaha at /plo
   (`attempts.game` and the daily tables already carry a game).
2. A version for card rooms and dealer schools, with a manager view of trainee progress.
