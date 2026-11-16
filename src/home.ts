// Entry point for the home page: point the DownTracker link at the right place, and count the visit
// (signed-out browsers only; see data/visits.ts).
import { linkDowntracker } from './ui/downtracker.ts';
import { trackVisit } from './data/visits.ts';

linkDowntracker();
trackVisit();
