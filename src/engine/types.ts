// Shared types for the game engine, drills, and UI.

export type Suit = 's' | 'h' | 'd' | 'c';
export interface Card { r: number; s: Suit }

/** Hand strength as a comparable array: [category, ...tiebreakers]. Higher wins. */
export type Score = number[];

export interface Best { score: Score; hole: number[]; board: number[]; cards: Card[] }

export interface Player {
  i: number;            // seat index 0-5
  stack: number;
  committed: number;    // chips in front of the player this street
  totalIn: number;      // chips put in over the whole hand
  folded: boolean;
  allin: boolean;
  acted: boolean;
  short: boolean;       // dealt a short stack to create side pots
  hole: Card[];
}

export interface LogLine { t: string; st?: boolean }

export interface PotPart { i: number; folded: boolean; amt: number }

/** A main or side pot. Built at the end of a betting round with an all-in for less, or at showdown. */
export interface Pot {
  amount: number;       // the whole pot, including chips from earlier rounds already in the middle
  parts: PotPart[];
  /** Built mid-hand: what this pot takes from this round's bets (what the dealer is asked). */
  round?: number;
  roundParts?: PotPart[];
  level: number;        // all-in level that caps this pot
  prev: number;         // level of the pot below it
  elig: number[];       // seats that can win it
  name: string;
  idx?: number;         // position among cut pots (0 = main)
  top?: Score;
  winners?: number[];
  share?: number;
  awarded?: boolean;
  odd?: { seat: number; amt: number };
}

/** Everything needed to ask and explain one pot-raise question. */
export interface PotQ {
  seat: number; pos: string; street: number; middle: number;
  cb: number; mine: number; toCall: number;
  bets: { i: number; amt: number; folded: boolean }[];
  total: number; after: number; raiseTo: number; addNow: number; rest: number;
  adj: number; sbSeat: number; sbAlt: number | null;
  repotOf?: { seat: number; to: number } | null;
}

export interface QuizState {
  q: PotQ; answered: boolean; timeout?: boolean; val?: number; ok?: boolean; ms?: number | null; diag?: string;
}

export interface CutAnswer { v: number; ok: boolean; timeout: boolean; ms: number | null; diag?: string }
export interface CutState { pots: Pot[]; j: number; ans: CutAnswer[] }

export interface ShowdownRow { i: number; best: Best }
export interface ReadResult {
  ok: boolean;
  auto?: boolean;
  timeout?: boolean;
  picks?: { seat: number; score: Score }[];
  ms?: number | null;
}
export interface Showdown {
  rows: ShowdownRow[];
  pots: Pot[];
  order: number[];      // read side pots first, main pot last
  step: number;
  phase: 'read' | 'result';
  results: Record<number, ReadResult>;
  mucked: Set<number>;
}

export type Mode = 'running' | 'quiz' | 'cut' | 'showdown' | 'done';

export interface Hand {
  btn: number; sb: number; bb: number; unit: number; sbFull: boolean;
  deck: Card[]; board: Card[]; pot: number; street: number;
  currentBet: number; lastRaise: number; lastAgg: number | null;
  streetActions: number; streetBets: number; streetRaises: number;
  log: LogLine[]; caption: string; acting: number | null; mode: Mode;
  // pot-call scheduling
  quizLeft: number; potsThisStreet: number; lastPot: { seat: number; to: number } | null;
  quizStreet: number; quizMin: number;
  side: boolean;
  players: Player[];
  /** Each player's total in the hand when this betting round started (blinds count as preflop bets). */
  streetStart: number[];
  cuts: Pot[];
  // drill and view state
  peek: boolean;
  quiz: QuizState | null;
  cq: CutState | null;
  sd: Showdown | null;
  sel: { holes: Record<number, number[]>; board: number[] };
  sweep: { i: number; amt: number }[] | null;
  ship: { i: number; amt: number; fx?: number; fy?: number }[] | null;
  fresh: number[] | null;
  justCut: boolean;
  quizResolve?: () => void;
  cutResolve?: () => void;
}

export type Stakes = '1/2' | '2/5' | '5/10' | '25/50';
export type Speed = 'slow' | 'normal' | 'fast';
export type TimerLevel = 'off' | 'relaxed' | 'standard' | 'fast';
export type SideFreq = 'off' | 'some' | 'often';

export interface Settings {
  stakes: Stakes; speed: Speed; four: boolean; showPot: boolean; sbFull: boolean;
  side: SideFreq; timer: TimerLevel; potCalls: number; chipAmt: boolean; sound: boolean;
}

/** Counters: pr/pt pot calls right/total, rr/rt reads, sr/st side-pot cuts, plus time sums (ptime/pn etc). */
export type Stats = Record<string, number>;
