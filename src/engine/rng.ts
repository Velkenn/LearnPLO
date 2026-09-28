// All engine randomness goes through here so tests can replay a seed.

let source: () => number = Math.random;

export const rand = (): number => source();

/** Use a seeded generator (mulberry32). Pass null to go back to Math.random. */
export function seed(n: number | null): void {
  if (n === null) { source = Math.random; return; }
  let a = n >>> 0;
  source = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rnd = (a: number, b: number): number => a + Math.floor(rand() * (b - a + 1));

/**
 * A shuffled copy (Fisher-Yates). Never shuffle with sort(() => rand() - .5): how often sort()
 * calls its comparison is up to each browser engine, so the same seed would deal differently in
 * Safari than in Chrome or on the server (which broke a daily challenge run once).
 */
export function shuffle<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
