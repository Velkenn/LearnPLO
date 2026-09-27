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
  data/store.ts       where settings and stats are saved (this browser today, Supabase later)
  styles/             CSS split by area, pulled together by main.css
tests/                node:test unit tests and the simulation
e2e/drill.mjs         Playwright browser test
```

## Deploying

Pushing to `main` runs the tests, builds, and publishes to GitHub Pages
(`.github/workflows/deploy.yml`). One-time setup: in the repo on GitHub, open
**Settings → Pages** and set **Source** to **GitHub Actions**. The site then lives at
`https://<your-username>.github.io/LearnPLO/`.

The build uses relative paths, so the same `dist/` folder also works on Cloudflare Pages,
Netlify, or Vercel (build command `npm run build`, output folder `dist`). GitHub Pages
doesn't allow commercial SaaS, so move to one of those before charging for anything.

After the first `npm install`, commit `package-lock.json` and switch the workflow's
`npm install` to `npm ci` for repeatable builds.

## Next up

1. Supabase sign-in (email magic link or Google). Signed-in users get the settings sheet
   (timer, blinds, pot calls per hand, side-pot frequency) and stats saved across devices.
   The seam is `src/data/store.ts`: add a Supabase store with the same interface.
2. An `attempts` table (one row per answer) for averages and weak-spot tracking.
3. Later: a daily challenge with server-side grading for a leaderboard.
