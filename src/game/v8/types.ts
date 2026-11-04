/** PRALAYA's vocabulary. Content (creatures.ts, cards.ts) and rules (rules.ts) both speak only these words. */
export type Type = 'COSMIC' | 'MYTHIC' | 'WILD' | 'TRICKSTER' | 'SHADOW';
/** The circle: each type beats the next one. */
export const CIRCLE: readonly Type[] = ['COSMIC', 'MYTHIC', 'WILD', 'TRICKSTER', 'SHADOW'];
export const beats = (a: Type, b: Type): boolean => CIRCLE[(CIRCLE.indexOf(a) + 1) % 5] === b;

export type WorldId = 'india' | 'olympus' | 'cosmos' | 'pirate' | 'night' | 'lost' | 'toon' | 'wild';
export const WORLDS: readonly WorldId[] = ['india', 'olympus', 'cosmos', 'pirate', 'night', 'lost', 'toon', 'wild'];

/** One special move per creature; a side fires at most one per clash (an ascended creature's fires free on top). Chief v8: 6, not 10. */
export type Move = 'SWAP' | 'DOUBLE' | 'ECLIPSE' | 'REVERSE' | 'ROAR' | 'SNATCH';
/** Map gifts (~30% of creatures). Using one tires the creature until its owner's next turn ends. */
export type Gift = 'FLY' | 'SWIM' | 'DIG' | 'BLINK' | 'SCENT';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface Creature {
  id: string;
  name: string;
  world: WorldId;
  type: Type;
  /** 1–10. Legendary 9–10, rare 7–9, uncommon 4–7, common 1–6. */
  power: number;
  move: Move;
  gift?: Gift;
  rarity: Rarity;
  /** Said as it bursts out of the fog (≤ 8 words). */
  line: string;
  /** Said when it beats you (≤ 6 words). */
  gloat: string;
  /** The image prompt for the art pipeline (never names a real franchise or person). */
  art: string;
}

/**
 * World laws (Chief v8 P1): each world changes what a clash IS, not how big a number is. They replace the old +2 home power.
 */
export type Law = 'smallBeatsBig' | 'onlyTypes' | 'onlySize' | 'darkness' | 'jungleCheats' | 'champions' | 'plunder' | 'homeSoil';
export const LAW: Readonly<Record<WorldId, Law>> = {
  toon: 'smallBeatsBig',
  cosmos: 'onlyTypes',
  lost: 'onlySize',
  night: 'darkness',
  wild: 'jungleCheats',
  olympus: 'champions',
  pirate: 'plunder',
  india: 'homeSoil',
};
export const LAW_TEXT: Readonly<Record<Law, { name: string; rule: string }>> = {
  smallBeatsBig: { name: 'SMALL BEATS BIG', rule: 'In every lane, the lower number wins.' },
  onlyTypes: { name: 'MAGIC ONLY', rule: 'Every lane compares MAGIC, whatever you call.' },
  onlySize: { name: 'SIZE ONLY', rule: 'Every lane compares SIZE, whatever you call.' },
  darkness: { name: 'FIGHT IN DARKNESS', rule: 'You see only their types until the reveal.' },
  jungleCheats: { name: 'THE JUNGLE CHEATS', rule: 'The wild team fires its special after yours.' },
  champions: { name: 'CHAMPIONS ONLY', rule: 'Only the middle lane counts.' },
  plunder: { name: 'WINNER PLUNDERS', rule: 'The winner takes two.' },
  homeSoil: { name: 'HOME SOIL', rule: 'Every tie goes to whoever was here first.' },
};
