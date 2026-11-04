/**
 * Every word PRALAYA shows, in one place (classy English, witty-absurd; captions ≤ 6 words where they caption an event).
 * Worlds, types, moves, gifts and laws carry a name, a one-line rule and a colour token; the presenter never invents copy.
 */
import type { BigEffect } from '../game/v8/rules.ts';
import type { Gift, Law, Move, Type, WorldId } from '../game/v8/types.ts';

export const WORLD: Readonly<Record<WorldId, { name: string; short: string; colour: string }>> = {
  india: { name: 'Mythic India', short: 'India', colour: '#e8a33d' },
  olympus: { name: 'Olympus & Asgard', short: 'Olympus', colour: '#8db4e8' },
  cosmos: { name: 'Cosmos & Black Hole', short: 'Cosmos', colour: '#a77bf0' },
  pirate: { name: 'Pirate Seas', short: 'Pirates', colour: '#35b99f' },
  night: { name: 'Forever Night', short: 'Night', colour: '#6d8fd8' },
  lost: { name: 'Lost Animals', short: 'Lost', colour: '#a9d6e3' },
  toon: { name: 'Cartoon Town', short: 'Toon', colour: '#ff96b8' },
  wild: { name: 'The Wild', short: 'Wild', colour: '#5cbf60' },
};

/** The circle, each beats the next; the verb is how it wins. */
export const TYPE: Readonly<Record<Type, { name: string; verb: string; colour: string }>> = {
  COSMIC: { name: 'Cosmic', verb: 'swallows', colour: '#a77bf0' },
  MYTHIC: { name: 'Mythic', verb: 'tames', colour: '#f0c45a' },
  WILD: { name: 'Wild', verb: 'sees through', colour: '#5cbf60' },
  TRICKSTER: { name: 'Trickster', verb: 'fools', colour: '#ff8a4c' },
  SHADOW: { name: 'Shadow', verb: 'eclipses', colour: '#7f8fb8' },
};
export const CIRCLE_LINE = 'Cosmic › Mythic › Wild › Trickster › Shadow › Cosmic';

export const MOVE: Readonly<Record<Move, { name: string; rule: string; aims: boolean }>> = {
  SWAP: { name: 'Swap', rule: 'Swap two of their fighters.', aims: true },
  DOUBLE: { name: 'Double', rule: 'This fighter counts double.', aims: false },
  ECLIPSE: { name: 'Eclipse', rule: 'Cancel a lane: it is a tie.', aims: true },
  REVERSE: { name: 'Reverse', rule: 'In this lane, the smaller wins.', aims: false },
  ROAR: { name: 'Roar', rule: 'A rival in a lane loses 3.', aims: true },
  SNATCH: { name: 'Snatch', rule: 'Win this lane: capture it too.', aims: false },
};

export const GIFT: Readonly<Record<Gift, { name: string; rule: string }>> = {
  FLY: { name: 'Fly', rule: 'Lifts you off ground the world eats.' },
  SWIM: { name: 'Swim', rule: 'Rides out the monsoon.' },
  DIG: { name: 'Dig', rule: 'Burrows under a stampede.' },
  BLINK: { name: 'Blink', rule: 'Was never there when anvils fall.' },
  SCENT: { name: 'Scent', rule: 'Finds the way in the dark.' },
};

export const LAW_GLYPH: Readonly<Record<Law, string>> = {
  smallBeatsBig: 'SMALL BEATS BIG',
  onlyTypes: 'MAGIC ONLY',
  onlySize: 'SIZE ONLY',
  darkness: 'FIGHT IN DARKNESS',
  jungleCheats: 'THE JUNGLE CHEATS',
  champions: 'CHAMPIONS ONLY',
  plunder: 'WINNER PLUNDERS',
  homeSoil: 'HOME SOIL',
};

export const BIG: Readonly<Record<BigEffect, { name: string; rule: string }>> = {
  stampede: { name: 'Stampede', rule: 'Three wild beasts charge a rival.' },
  swallow: { name: 'Swallow a World', rule: 'Name a world. It falls now.' },
  exile: { name: 'Exile', rule: 'Swap places with anyone.' },
  plunder: { name: 'Plunder', rule: 'Take the top creature of anyone.' },
  fuse: { name: 'Fuse', rule: 'Two of your creatures become one.' },
};

export const MOOD_TEXT = {
  hunt: 'The world hunts.',
  frenzy: 'The world is in a frenzy.',
  sated: 'The world is sated. Breathe.',
} as const;

/** What the first sighting of each idea teaches (one new idea per turn, ≤ 8 words). */
export const HINT: Record<string, string> = {
  roll: 'Roll, then choose where you go.',
  dest: 'Pick any glowing place: your roll reaches it.',
  nest: 'A Wild Nest: only a 6 hatches.',
  chance: 'Empty ground deals a chance card. Obey it.',
  power: 'Your hero power recharges every few turns (the card says how many).',
  trial: 'Press as the white ring meets the gold.',
  boss: 'One health bar for all. Last hit wins.',
  bomb: 'The bomb passes to anyone near its holder.',
  weather: 'Storms strike. Sunshine shelters a land.',
  fork: 'A fork. Choose your road.',
  emerge: 'Wild creatures! You see who, not where.',
  team: 'Pick your fighters, set the lanes, call a stat each.',
  clash: 'Win more lanes than they do.',
  calls: 'Both calls count: the bigger total wins.',
  omen: 'Cracks mean the world is hungry here.',
  eat: 'The world ate that ground.',
  disaster: 'The right creature dodges disasters.',
  riddle: 'Choose a door.',
  cache: 'A cache: a creature, a relic or a blessing.',
  relic: 'A relic lifts one creature for good.',
  attack: 'The land strikes. Your top card must stop it.',
  hilo: 'Guess right three times and win the card.',
  tame: 'One on one: win and it follows you.',
  altar: 'A heart for a creature, or the reverse.',
  trader: 'A blind swap: a common, or a legend.',
  heart: 'The Burning Heart throws you somewhere random.',
  trap: 'Traps: the survivor fights whatever waits there.',
  stand: 'Reach the count shown, or the world keeps you.',
  wheel: 'The wheel can turn anyone over.',
  cave: 'Deeper finds more. The roof decides.',
  ascend: 'Two lanes won: it ascends. Four: fabled.',
  trust: 'Share or take, in secret. Trust is a gamble.',
  ring: 'Call any rival into the ring, or walk away.',
  pier: 'Roll for a catch. A 1 drags your best under.',
  shrine: 'Point the beast at a rival.',
  oathStone: 'Allies share victories. Until one betrays.',
  hunt: 'The beast rolls its own die. Keep away.',
  feud: 'Vengeance: their next duel, the winner takes two.',
  blood: 'Blood Moon: every battle counts double.',
  golden: 'A golden card: your big moment.',
  bet: 'A bet: watch their next battle closely.',
  lastLight: 'Everyone is drawn to the fire.',
};

export const HEART_WHY: Record<string, string> = {
  world: 'The world took the ground.',
  allIn: 'They staked their life, and lost.',
  creature: 'The wild team won.',
  player: 'A rival won the clash.',
  disaster: 'The disaster struck.',
  bet: 'The bet was lost.',
  suddenDeath: 'The light went out.',
  encounter: 'A bad choice.',
  chance: 'The chance card was cruel.',
  bomb: 'The bomb went off.',
  altar: 'Offered on the altar.',
  land: 'The land struck, and nothing stood in the way.',
};
