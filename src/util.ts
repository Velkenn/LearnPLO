// Small formatting helpers shared by the engine and the drills.
import type { Pot } from './engine/types.ts';

export const fmt = (n: number): string => '$' + n.toLocaleString('en-US');
export const capF = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
export const roundU = (x: number, u: number): number => Math.max(u, Math.round(x / u) * u);

/** "Seat 3" or "Seats 2, 4 and 5" from zero-based seat indexes. */
export const seatList = (ids: number[]): string => {
  const n = ids.map(i => i + 1);
  return n.length === 1 ? `Seat ${n[0]}` : `Seats ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
};

/** "the main pot", "the side pot", or "side pot 2". */
export const potRef = (pt: Pick<Pot, 'name'>): string =>
  /\d$/.test(pt.name) ? pt.name.toLowerCase() : `the ${pt.name.toLowerCase()}`;
