// Entry point: wire up the page and draw the empty table.
import { initSettings } from './ui/settings.ts';
import { initEvents } from './ui/events.ts';
import { initTimer } from './ui/timer.ts';
import { initAccount } from './ui/account.ts';
import { initSpots } from './ui/weakSpots.ts';
import { initDaily } from './ui/daily.ts';
import { render } from './ui/render.ts';
import { app } from './app.ts';

initTimer();
initSettings();
initEvents();
initAccount();
initSpots();
initDaily();
render();

// Browser tests read game state through this. Only exposed with ?e2e in the URL.
if (new URLSearchParams(location.search).has('e2e')) (window as unknown as { __app: typeof app }).__app = app;
