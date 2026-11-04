/**
 * The cards (owner, 2026-10-30: "like real trump cards… no class system or hierarchy"; v10, 2026-10-31: "cards bahut carefully
 * from scratch design karo… stats aise interesting rakho ki battles close calls bann jayein… ek mein legendary hone se hum nhi
 * confirm kar sakte ki jeet apni hi hai"). Every creature carries SIX stats, as a real Top Trumps deck does. In a clash you CALL
 * one stat for each lane; both cards in that lane compare it.
 *
 * v10 design, from scratch (Top Trumps research: a good deck has no card that wins every category, and each card is famous for
 * ONE number): every card has
 *   - a SIGNATURE: the one stat it is known for (its family's lean, sometimes the second lean), 76–99;
 *   - a WEAKNESS: the stat it is famous for losing (its family's blind spot), 10–40;
 *   - four ordinary stats bunched near the middle (38–72), where most lanes are decided by a handful of points.
 * Rarity lifts the signature and the floor a little, never the whole card: a legendary's middle is only ~10 points above a
 * common's, so a legendary wins its own lane and can still lose the other two. The numbers are measured by scripts/statlab.ts
 * (close lanes, decided-by-the-last-lane battles, legendary lane share). Deterministic from the creature's own id, 1–99.
 */
import type { Creature, Gift, Type } from './types.ts';

export const STATS = ['POWER', 'SPEED', 'SIZE', 'CUNNING', 'MAGIC', 'TERROR'] as const;
export type Stat = (typeof STATS)[number];
export type Stats = Readonly<Record<Stat, number>>;

/** What each family leans toward (first = its usual signature, second = its other strength) and its blind spot. */
const LEAN: Record<Type, { up: [Stat, Stat]; down: Stat; tilt: Partial<Record<Stat, number>> }> = {
  COSMIC: { up: ['MAGIC', 'SIZE'], down: 'CUNNING', tilt: { MAGIC: 8, SIZE: 5, SPEED: -3 } },
  MYTHIC: { up: ['POWER', 'MAGIC'], down: 'SPEED', tilt: { POWER: 8, MAGIC: 4, CUNNING: -3 } },
  WILD: { up: ['SPEED', 'POWER'], down: 'MAGIC', tilt: { SPEED: 8, POWER: 4, CUNNING: -2 } },
  TRICKSTER: { up: ['CUNNING', 'SPEED'], down: 'POWER', tilt: { CUNNING: 8, SPEED: 4, SIZE: -3 } },
  SHADOW: { up: ['TERROR', 'CUNNING'], down: 'SIZE', tilt: { TERROR: 8, CUNNING: 4, POWER: -2 } },
};
const GIFT_TILT: Record<Gift, Partial<Record<Stat, number>>> = {
  FLY: { SPEED: 5 },
  SWIM: { SPEED: 3, SIZE: 2 },
  DIG: { POWER: 4 },
  BLINK: { CUNNING: 5 },
  SCENT: { CUNNING: 3, TERROR: 2 },
};
const TIER: Record<Creature['rarity'], number> = { common: 0, uncommon: 1, rare: 2, legendary: 3 };

/** A stable 0..1 from a string (FNV-1a), so a card's numbers never change between matches. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10007) / 10007;
}

/** The knobs scripts/statlab.ts measures (exported so the lab can try alternatives without editing this file). */
export const CARD = {
  mid: 46,
  midTier: 3,
  midPower: 0.8,
  spread: 30,
  sig: 68,
  sigTier: 6,
  sigJitter: 8,
  weak: 12,
  weakTier: 5,
  weakJitter: 12,
};

/**
 * v10 (owner: "koi multiple baar khelke stats hi yaad karle… make sure there is no way to outsmart the game… thousands… fresh roz
 * roz"): every match deals the cards anew. Each creature's numbers are re-rolled from the match seed (its signature and its
 * weakness can move to another stat), and each creature comes in one of FORMS (a Feral Kraken is not an Ancient Kraken): 184
 * painted creatures × 13 forms = 2,392 different cards, so nobody can learn the deck, however often they play.
 */
export interface Form {
  key: string;
  name: string;
  /** Weight in the deal (plain cards are the most common). */
  w: number;
  all?: number;
  up?: Partial<Record<Stat, number>>;
}
export const FORMS: readonly Form[] = [
  { key: 'plain', name: '', w: 34 },
  { key: 'ancient', name: 'Ancient', w: 6, all: 6, up: { SPEED: -12 } },
  { key: 'young', name: 'Young', w: 6, all: -6, up: { SPEED: 14 } },
  { key: 'feral', name: 'Feral', w: 6, up: { POWER: 14, CUNNING: -12 } },
  { key: 'cursed', name: 'Cursed', w: 5, all: -4, up: { TERROR: 20 } },
  { key: 'celestial', name: 'Celestial', w: 5, up: { MAGIC: 16, TERROR: -10 } },
  { key: 'colossal', name: 'Colossal', w: 5, up: { SIZE: 20, SPEED: -14 } },
  { key: 'shadow', name: 'Shadow-Touched', w: 5, up: { CUNNING: 12, TERROR: 8, SIZE: -14 } },
  { key: 'blazing', name: 'Blazing', w: 5, up: { POWER: 8, SPEED: 8, MAGIC: -12 } },
  { key: 'frost', name: 'Frost-Bitten', w: 5, up: { SIZE: 8, POWER: 6, SPEED: -12 } },
  { key: 'wise', name: 'Wise', w: 5, up: { CUNNING: 16, POWER: -10 } },
  { key: 'wounded', name: 'Wounded', w: 3, all: -10 },
  { key: 'exalted', name: 'Exalted', w: 3, all: 10 },
];
/** …and an epithet: a second, smaller twist (216 creatures × 13 forms × 11 epithets = 30,888 different cards). */
export const EPITHETS: readonly Form[] = [
  { key: 'none', name: '', w: 40 },
  { key: 'unbroken', name: 'the Unbroken', w: 6, up: { POWER: 8 } },
  { key: 'swift', name: 'the Swift', w: 6, up: { SPEED: 8 } },
  { key: 'vast', name: 'the Vast', w: 6, up: { SIZE: 8 } },
  { key: 'sly', name: 'the Sly', w: 6, up: { CUNNING: 8 } },
  { key: 'arcane', name: 'the Arcane', w: 6, up: { MAGIC: 8 } },
  { key: 'dread', name: 'the Dread', w: 6, up: { TERROR: 8 } },
  { key: 'hungry', name: 'the Hungry', w: 6, up: { POWER: 5, SPEED: 5, MAGIC: -6 } },
  { key: 'lost', name: 'the Lost', w: 6, all: -4, up: { CUNNING: 10 } },
  { key: 'last', name: 'the Last', w: 6, all: 4 },
  { key: 'twice', name: 'Twice-Born', w: 6, up: { MAGIC: 6, TERROR: 6, SIZE: -6 } },
];
let SALT = 'base';
const EPI = new Map<string, Form>();
export function epithetOf(id: string): Form {
  let f = EPI.get(id);
  if (!f) {
    let x = hash01(`${SALT}:${id}:epithet`) * EPITHETS.reduce((a, b) => a + b.w, 0);
    f = EPITHETS.find((k) => (x -= k.w) < 0) ?? EPITHETS[0]!;
    EPI.set(id, f);
  }
  return f;
}
const FORM = new Map<string, Form>();
/** Deal the cards for a match: every number and every form follows from this seed (deterministic: replays replay). */
export function seedCards(seed: number | string): void {
  SALT = String(seed);
  cache.clear();
  FORM.clear();
  EPI.clear();
}
export const currentSalt = () => SALT;
export function formOf(id: string): Form {
  let f = FORM.get(id);
  if (!f) {
    let x = hash01(`${SALT}:${id}:form`) * FORMS.reduce((a, b) => a + b.w, 0);
    f = FORMS.find((k) => (x -= k.w) < 0) ?? FORMS[0]!;
    FORM.set(id, f);
  }
  return f;
}

const cache = new Map<string, Stats>();
export function statsOf(c: Creature): Stats {
  const hit = cache.get(c.id);
  if (hit) return hit;
  const r = (k: string) => hash01(`${SALT}:${c.id}:${k}`);
  const t = TIER[c.rarity];
  const lean = LEAN[c.type];
  // The signature is usually the family's lean, sometimes its second, sometimes anything at all (no tell to learn).
  const sr = r('sig');
  const sig = sr < 0.55 ? lean.up[0] : sr < 0.8 ? lean.up[1] : STATS[Math.floor(r('sig2') * 6)]!;
  const wr = r('weak');
  let weak: Stat = wr < 0.7 ? lean.down : STATS[Math.floor(r('weak2') * 6)]!;
  if (weak === sig) weak = STATS[(STATS.indexOf(sig) + 3) % 6]!;
  const out = {} as Record<Stat, number>;
  const mid = CARD.mid + t * CARD.midTier + c.power * CARD.midPower;
  for (const st of STATS) {
    const noise = (r(st) - 0.5) * CARD.spread;
    out[st] = mid + (lean.tilt[st] ?? 0) + (c.gift ? (GIFT_TILT[c.gift][st] ?? 0) : 0) + noise;
  }
  out[sig] = CARD.sig + t * CARD.sigTier + r('peak') * CARD.sigJitter;
  out[weak] = CARD.weak + t * CARD.weakTier + r('low') * CARD.weakJitter;
  // Ordinary stats never rival the signature, never sink below the weakness.
  for (const st of STATS) {
    if (st === sig || st === weak) continue;
    out[st] = Math.min(out[st], out[sig] - 6);
    out[st] = Math.max(out[st], out[weak] + 6);
  }
  const f = formOf(c.id);
  const e = epithetOf(c.id);
  for (const st of STATS) out[st] += (f.all ?? 0) + (f.up?.[st] ?? 0) + (e.all ?? 0) + (e.up?.[st] ?? 0);
  for (const st of STATS) out[st] = Math.max(3, Math.min(99, Math.round(out[st])));
  cache.set(c.id, out);
  return out;
}
/** For the lab: forget cached cards after the knobs change. */
export const resetStats = () => cache.clear();

/** A fusion takes the better of each stat. */
export const fuseStats = (a: Stats, b: Stats): Stats =>
  Object.fromEntries(STATS.map((s) => [s, Math.max(a[s], b[s])])) as Stats;

/** A card's best stat (the one a careless player would still be likely to call). */
export const bestStat = (s: Stats): Stat => STATS.reduce((a, b) => (s[b] > s[a] ? b : a));
/** A card's signature (its best stat) and its weakness (its worst), for the card face. */
export const worstStat = (s: Stats): Stat => STATS.reduce((a, b) => (s[b] < s[a] ? b : a));
