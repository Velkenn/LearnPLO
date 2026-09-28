// Entry point for a game page: put in the page's markup, wire it up, and draw the empty table.
import { initSettings } from './ui/settings.ts';
import { initEvents } from './ui/events.ts';
import { initTimer } from './ui/timer.ts';
import { initAccount } from './ui/account.ts';
import { initSpots } from './ui/weakSpots.ts';
import { initDaily } from './ui/daily.ts';
import { initFeedback } from './ui/feedback.ts';
import { initStats } from './ui/stats.ts';
import { initWelcome } from './ui/welcome.ts';
import { render } from './ui/render.ts';
import { shellHTML } from './ui/shell.ts';
import { app } from './app.ts';
import { game } from './page.ts';

// The page's markup is shared by every game; put it in before anything looks for it.
document.getElementById('app')!.innerHTML = shellHTML(game);

initTimer();
initSettings();
initEvents();
initAccount();
initSpots();
initDaily();
initFeedback();
initStats();
initWelcome();
render();

// Browser tests read game state through this. Only exposed with ?e2e in the URL.
if (new URLSearchParams(location.search).has('e2e')) (window as unknown as { __app: typeof app }).__app = app;
