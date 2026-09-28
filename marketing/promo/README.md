# Promo video

A 33-second vertical video (1080×1920, 30 fps) for TikTok, Reels, Shorts and Reddit. It's a web
page animated in code: `seek(t)` in `main.ts` sets every element for time `t`, and
`render.mjs` captures it one frame at a time with Playwright. It uses FeltReady's own CSS,
cards and chips, so it matches the app.

Scenes (times in seconds, set in `main.ts`):

1. 0–8.6: pot call. Seat 7 says "Pot"; 3 × $20 + $80 = $140.
2. 8.6–16.2: build the side pot. Seat 3 all in for $100; $300 main, $300 side.
3. 16.2–24.6: showdown read. K♠ 9♠ 4♦ 7♠ 2♣; Seat 5's J♠ T♠ flush beats three kings.
4. 24.6–29.4: features, over a real app screenshot (`app-pot.jpg`).
5. 29.4–33.5: end card, feltready.com.

Sound is synthesized in `audio.py` from the cue list the page exports (chip clicks, card flicks,
ticks, whooshes, a chime, a light music bed), then normalized to -14 LUFS.

```sh
node marketing/promo/render.mjs 3.2,20,31          # look at a few moments (out/keys/)
marketing/promo/make.sh                            # every frame + sound → out/FeltReady-promo.mp4 (~10 min)
FROM=486 TO=740 node marketing/promo/render.mjs    # re-render one scene's frames after an edit…
marketing/promo/make.sh --audio-only               # …then rebuild sound and encode
```

Needs Playwright's Chromium, python3 with numpy and scipy, and ffmpeg. Frame numbers are
seconds × 30. Check every poker number against the engine before changing a hand.
