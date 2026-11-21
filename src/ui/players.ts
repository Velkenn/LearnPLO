/**
 * Seat avatars: small illustrated players (skin tone, hair, hats, glasses, facial hair, shirt),
 * drawn as inline SVG so there's nothing to load. A fresh lineup is dealt once per page load and
 * each seat keeps its player for the visit. UI only: this uses Math.random, never engine/rng.ts,
 * so it can't change how a seeded hand deals.
 */

type Hair = 'short' | 'buzz' | 'bald' | 'long' | 'bun' | 'afro';
type Hat = 'none' | 'cap' | 'cowboy' | 'beanie' | 'visor';
type Face = 'none' | 'beard' | 'mustache' | 'goatee';
type Eyes = 'plain' | 'shades' | 'glasses';
type Top = 'tee' | 'hoodie' | 'collar';

interface Player { skin: [string, string]; hairColor: string; hair: Hair; hat: Hat; face: Face; eyes: Eyes; top: Top; shirt: string; hatColor: string }

// [face, shadow] pairs, light to deep.
const SKINS: [string, string][] = [
  ['#F6D5BC', '#E2B597'], ['#EBC09C', '#D3A17B'], ['#D9A57C', '#BF8961'],
  ['#B97F57', '#9E6844'], ['#8D5A3B', '#764A30'], ['#64402B', '#523323'],
];
const HAIR_COLORS = ['#1E1712', '#2E2019', '#4A2F1E', '#7A4E2C', '#B08345', '#D8B878', '#8A8A88', '#C9C6C0'];
const SHIRTS = ['#1F2A36', '#6E2A2A', '#2C4A36', '#3A3250', '#B9A57E', '#4E5862', '#1C1C1E', '#7E5328', '#2B567F'];
const HAT_COLORS = ['#A83434', '#24496E', '#2E5E3E', '#1C1C1E', '#C2A15A'];

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
function shuffled<T>(a: readonly T[]): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** Nine players, with skin tones, hats, and shirts spread across the table rather than clumped. */
function dealLineup(): Player[] {
  const skins = shuffled(SKINS), shirts = shuffled(SHIRTS);
  const hats = shuffled<Hat>(['cap', 'cowboy', 'visor', 'beanie', 'none', 'none', 'none', 'none', 'none']);
  const hairs = shuffled<Hair>(['short', 'short', 'buzz', 'bald', 'long', 'long', 'bun', 'afro', 'short']);
  return Array.from({ length: 9 }, (_, i): Player => {
    const hair = hairs[i];
    const grey = Math.random() < .18;
    return {
      skin: skins[i % skins.length],
      hairColor: grey ? pick(HAIR_COLORS.slice(6)) : pick(HAIR_COLORS.slice(0, 6)),
      hair,
      hat: hats[i],
      // Long hair and buns read better clean-shaven; everyone else has a shot at facial hair.
      face: hair === 'long' || hair === 'bun' ? 'none' : pick<Face>(['none', 'none', 'beard', 'mustache', 'goatee']),
      eyes: pick<Eyes>(['plain', 'plain', 'plain', 'shades', 'glasses']),
      top: pick<Top>(['tee', 'tee', 'hoodie', 'collar']),
      shirt: shirts[i % shirts.length],
      hatColor: pick(HAT_COLORS),
    };
  });
}

let lineup: Player[] | null = null;

/** Behind the head: long hair, an afro, or a hood. */
function behind(p: Player): string {
  const h = p.hairColor;
  let s = '';
  if (p.top === 'hoodie') s += `<path d="M9 31C9 22.5 13.5 19.5 20 19.5S31 22.5 31 31Z" fill="${shade(p.shirt)}"/>`;
  if (p.hair === 'long') s += `<path d="M12.2 16.6C12 7.2 28 7.2 27.8 16.6V27C26.1 25.8 25.2 24 25.1 21.4H14.9C14.8 24 13.9 25.8 12.2 27Z" fill="${h}"/>`;
  if (p.hair === 'afro' && p.hat !== 'beanie' && p.hat !== 'cowboy') s += `<circle cx="20" cy="13.6" r="9.6" fill="${h}"/><circle cx="12.6" cy="17.2" r="3.2" fill="${h}"/><circle cx="27.4" cy="17.2" r="3.2" fill="${h}"/>`;
  return s;
}

function body(p: Player): string {
  const [skin, dark] = p.skin;
  let s = `<path d="M4.5 41C5.6 31 11.8 26.8 20 26.8S34.4 31 35.5 41Z" fill="${p.shirt}"/>`;
  s += `<rect x="17.5" y="20.4" width="5" height="7.2" rx="1.6" fill="${dark}"/>`;
  if (p.top === 'tee') s += `<path d="M16.4 26.9Q20 30.4 23.6 26.9" fill="${dark}"/><path d="M16.4 26.9Q20 30.4 23.6 26.9" fill="none" stroke="${shade(p.shirt)}" stroke-width=".9"/>`;
  if (p.top === 'hoodie') s += `<path d="M16.2 26.8L20 31.2L23.8 26.8" fill="${dark}"/><path d="M18.3 30.5V35M21.7 30.5V35" stroke="#EDE7DA" stroke-width=".7" stroke-linecap="round"/>`;
  if (p.top === 'collar') s += `<path d="M16.8 26.8L20 30.6L23.2 26.8Z" fill="${dark}"/><path d="M15.6 26.4L20 30.8L17.4 32.4L14.6 28Z M24.4 26.4L20 30.8L22.6 32.4L25.4 28Z" fill="#F1ECE2"/>`;
  s += `<circle cx="13.3" cy="17.3" r="1.5" fill="${dark}"/><circle cx="26.7" cy="17.3" r="1.5" fill="${dark}"/>`;
  s += `<ellipse cx="20" cy="16.5" rx="6.8" ry="7.1" fill="${skin}"/>`;
  return s;
}

function features(p: Player): string {
  const h = p.hairColor, [, dark] = p.skin;
  let s = '';
  if (p.eyes !== 'shades') {
    s += `<circle cx="17.4" cy="16.9" r=".85" fill="#1B1714"/><circle cx="22.6" cy="16.9" r=".85" fill="#1B1714"/>`;
    s += `<path d="M16.2 14.9Q17.4 14.2 18.6 14.8M21.4 14.8Q22.6 14.2 23.8 14.9" stroke="${h}" stroke-width=".8" fill="none" stroke-linecap="round"/>`;
  }
  s += `<path d="M19.5 17.6Q20.2 19 19.4 19.3" stroke="${dark}" stroke-width=".6" fill="none" stroke-linecap="round"/>`;
  if (p.face === 'beard') s += `<path d="M13.4 17.4C13.4 25.8 26.6 25.8 26.6 17.4C25.7 20.4 23.6 21.4 20 21.4S14.3 20.4 13.4 17.4Z" fill="${h}"/><path d="M17.6 20.4Q20 19.4 22.4 20.4Q20 21.3 17.6 20.4Z" fill="${h}"/>`;
  else s += `<path d="M18.4 21Q20 21.9 21.6 21" stroke="#5A3626" stroke-width=".7" fill="none" stroke-linecap="round"/>`;
  if (p.face === 'mustache') s += `<path d="M17.3 20.5Q20 19 22.7 20.5Q20 20.1 17.3 20.5Z" fill="${h}" stroke="${h}" stroke-width=".5" stroke-linejoin="round"/>`;
  if (p.face === 'goatee') s += `<path d="M18.4 22.4Q20 21.8 21.6 22.4L21 24.2Q20 24.9 19 24.2Z" fill="${h}"/><path d="M17.8 20.4Q20 19.5 22.2 20.4" stroke="${h}" stroke-width=".7" fill="none" stroke-linecap="round"/>`;
  if (p.eyes === 'shades') s += `<path d="M14.4 15.3H19.3V17C19.3 18.4 18.4 18.8 16.9 18.8S14.4 18.4 14.4 17Z M20.7 15.3H25.6V17C25.6 18.4 24.7 18.8 23.2 18.8S20.7 18.4 20.7 17Z" fill="#141414"/><path d="M19.3 15.8H20.7" stroke="#141414" stroke-width=".7"/><path d="M15.2 15.9H17" stroke="rgba(255,255,255,.35)" stroke-width=".5"/>`;
  if (p.eyes === 'glasses') s += `<g fill="none" stroke="#2A2A2A" stroke-width=".7"><circle cx="17.3" cy="16.9" r="2"/><circle cx="22.7" cy="16.9" r="2"/><path d="M19.3 16.7H20.7M15.3 16.6L13.6 16.1M24.7 16.6L26.4 16.1"/></g>`;
  return s;
}

/** Hair on top of the head, then any hat over it. */
function crown(p: Player): string {
  const h = p.hairColor, c = p.hatColor;
  const capped = p.hat === 'cap' || p.hat === 'cowboy' || p.hat === 'beanie';
  let s = '';
  if (!capped) {
    if (p.hair === 'short') s += `<path d="M12.9 16.6A7.1 7.8 0 0 1 27.1 16.6C26.3 13.3 23.6 12.2 21.6 12.2C19.3 13.3 16 13.3 14.4 12.9C13.8 13.9 13.3 15 12.9 16.6Z" fill="${h}"/>`;
    if (p.hair === 'buzz') s += `<path d="M13.1 15.8A6.9 7.4 0 0 1 26.9 15.8C25.8 12.6 23.2 11.6 20 11.6S14.2 12.6 13.1 15.8Z" fill="${h}" opacity=".7"/>`;
    if (p.hair === 'long') s += `<path d="M12.9 16.6A7.1 7.8 0 0 1 27.1 16.6C25.4 13.4 22.6 12.4 20.6 12.6C19.4 13.8 16 14.6 12.9 16.6Z" fill="${h}"/>`;
    if (p.hair === 'bun') s += `<circle cx="20" cy="7.6" r="2.6" fill="${h}"/><path d="M13.1 15.8A6.9 7.4 0 0 1 26.9 15.8C25.8 12.6 23.2 11.6 20 11.6S14.2 12.6 13.1 15.8Z" fill="${h}"/>`;
    if (p.hair === 'afro') s += `<path d="M13.2 14.6A6.9 7.2 0 0 1 26.8 14.6Q20 11.6 13.2 14.6Z" fill="${h}"/>`;
  }
  if (p.hat === 'cap') s += `<path d="M12.9 15.2C12.6 7.9 27.4 7.9 27.1 15.2Z" fill="${c}"/><path d="M20 8.6V15.2" stroke="${shade(c)}" stroke-width=".5"/><circle cx="20" cy="8.7" r=".9" fill="${shade(c)}"/><path d="M12.4 15.1H27.6C28.6 15.1 28.4 16.7 27.2 16.7H12.8C11.6 16.7 11.4 15.1 12.4 15.1Z" fill="${shade(c)}"/>`;
  if (p.hat === 'cowboy') s += `<path d="M14.1 12C13.8 5.4 16.6 4.6 20 6.2C23.4 4.6 26.2 5.4 25.9 12Z" fill="#7D5733"/><rect x="14" y="10.3" width="12" height="1.7" fill="#3A2716"/><path d="M6.8 11.4Q8.8 14.2 20 13.9Q31.2 14.2 33.2 11.4Q30 12.8 20 12.6Q10 12.8 6.8 11.4Z" fill="#6A4829"/>`;
  if (p.hat === 'beanie') s += `<path d="M13 14.4C12.8 6.4 27.2 6.4 27 14.4Z" fill="${c}"/><rect x="12.4" y="12.6" width="15.2" height="3" rx="1.4" fill="${shade(c)}"/><circle cx="20" cy="6.6" r="1.8" fill="${shade(c)}"/>`;
  if (p.hat === 'visor') s += `<path d="M12.9 12.6Q20 10.6 27.1 12.6V14Q20 12 12.9 14Z" fill="#1F5B3D"/><path d="M12.2 13.9Q20 11.9 27.8 13.9L26.8 15.9Q20 14.4 13.2 15.9Z" fill="#2F8A5C" opacity=".82"/>`;
  return s;
}

/** A darker shade of a #rrggbb color, for shadows, brims, and folds. */
function shade(hex: string, k = .72): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * k).toString(16).padStart(2, '0');
  return `#${ch(n >> 16 & 255)}${ch(n >> 8 & 255)}${ch(n & 255)}`;
}

/** The player sitting in seat i (0-based), as an SVG for the seat's disc. */
export function playerSvg(i: number): string {
  lineup ??= dealLineup();
  const p = lineup[i % lineup.length];
  return `<svg viewBox="3 2.5 34 34" aria-hidden="true">${behind(p)}${body(p)}${features(p)}${crown(p)}</svg>`;
}
