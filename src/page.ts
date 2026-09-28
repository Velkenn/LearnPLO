// Which game this page deals. Each game's page sets it on <body data-game="...">; the home page
// has no game. Kept out of config.ts, which the daily challenge server imports.
import type { GameId } from './config.ts';

const body = typeof document === 'undefined' ? null : document.body;
export const game: GameId = body?.dataset.game === 'bomb' ? 'bomb' : 'plo';
/** Double board bomb pots. */
export const isBomb = game === 'bomb';
