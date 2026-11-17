// Entry point for the For schools page (/schools/): the pilot request form, and counting the
// visit (signed-out browsers only; see data/visits.ts), so outreach links show up by source.
import { initSchools } from './ui/schools.ts';
import { trackVisit } from './data/visits.ts';

initSchools();
trackVisit();
