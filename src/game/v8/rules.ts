/**
 * PRALAYA's rules: a pure, deterministic generator (the v7 pattern). It yields an Ask whenever a person must decide and appends
 * Beats to `g.log`; the presenter plays each beat, one subject at a time, before showing the next ask. Nothing happens that is not
 * a beat. Progress p (0 → 1) comes from a timing model of what has been shown (g.clock), so the world escalates by how long the
 * match has felt, not by turns played (books-v8 V1): 2 and 6 players follow the same curve.
 * Content: cards.ts (heroes, fate, disasters, riddles, boons, flips) and creatures.ts. Numbers: tune.ts. The clash: clash.ts.
 */
import { next, seedRng, shuffle, type RngState } from '../../shared/rng.ts';
import {
  BOONS,
  DISASTERS,
  FATES,
  FLIPS,
  HEROES,
  RIDDLES,
  type BoonKey,
  type Fate,
  type FateFx,
  type FlipKind,
  type Hero,
  type Riddle,
  type RiddleFx,
  ENCOUNTERS,
  type Encounter,
  CHANCES,
  type HeroGift,
  ATTACKS,
  RELICS,
} from './cards.ts';
import { resolve, type ClashResult, type Fighter, type Fired, type Side } from './clash.ts';
import { CREATURES } from './creatures.ts';
import {
  CENTRE,
  INNER0,
  SPOKE0,
  distance,
  isBridge,
  makeBoard,
  towards,
  type Content,
  type Space,
} from './map.ts';
import { TUNE } from './tune.ts';
import { LAW, WORLDS, type Creature, type Gift, type Law, type Move, type WorldId } from './types.ts';
import { STATS, bestStat, currentSalt, formOf, fuseStats, seedCards, statsOf, type Stat } from './stats.ts';

export const CREATURE: Record<string, Creature> = Object.fromEntries(CREATURES.map((c) => [c.id, c]));
/** A creature as dealt in THIS match: its form is part of its name ("The Feral Kraken"). */
const dealt = new Map<string, Creature>();
let dealtSalt = '';
export const creature = (id: string): Creature => {
  const base = CREATURE[id]!;
  const f = formOf(id);
  if (!f.name) return base;
  const key = `${f.key}:${id}`;
  if (dealtSalt !== currentSalt()) {
    dealt.clear();
    dealtSalt = currentSalt();
  }
  let c = dealt.get(key);
  if (!c) {
    const name = /^the /i.test(base.name) ? `The ${f.name} ${base.name.slice(4)}` : `${f.name} ${base.name}`;
    c = { ...base, name };
    dealt.set(key, c);
  }
  return c;
};

// ── State ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Owned {
  uid: number;
  cid: string;
  /** A fusion's second creature: both types, both moves, both gifts; power = the higher. */
  fused?: string;
  /** Won 2 lanes: its special fires free, on top of your one special. */
  ascended: boolean;
  /** v16: a creature that has won four lanes for you: EXALTED (a second lift on top of ASCENDED). */
  exalted?: boolean;
  wins: number;
  tired: boolean;
  /** v10: a relic lifts (or a hex lowers) every stat of this one creature. */
  mod?: number;
  modName?: string;
}
export interface Player {
  seat: number;
  name: string;
  hero: Hero;
  hearts: number;
  deck: Owned[];
  relics: number;
  /** Held boons (they trigger by themselves when they matter). */
  boons: BoonKey[];
  at: number;
  from: number | null;
  out: boolean;
  betUsed: boolean;
  goldenAt: number;
  golden: 'none' | 'held' | 'used';
  /** The round of this player's last heart lost to the world eating (cap: one per two rounds). */
  eatHitRound: number;
  turns: number;
  /** The round a once-per-round hero gift was last used. */
  usedRound: number;
  /** Fate cards drawn next turn change: −1 (comet, victory nap, fed the giant), +1 (polished lamp, Kamadhenu's rest). */
  nextDraw: number;
  /** Turns left with an extra fate card (Akshaya Patra / the Bottomless Purse). */
  bonusDraws: number;
  /** No creature can be lost while this is ≥ the player's turn count (Airavata / the Golden Fleece). */
  guardTurn: number;
  /** The vines: skip the next turn. */
  skip: boolean;
  /** The last creature lost (Sanjeevani brings it back). */
  lastLost: string | null;
  /** The Mirror Pool: in the next clash, see the enemy's first fighter. */
  peek: boolean;
  /** The Old Map kept: see down every fork while this is ≥ the turn count. */
  mapTurn: number;
  /** Refused the oath: the world counts you a heart higher until your next turn ends. */
  marked: boolean;
  /** A friend-chosen harm already landed this round (at most one per round, Chief v8 risk 5). */
  harmedRound: number;
  /** Kumbhakarna dozes: he can be picked only on even rounds. */
  sleeper: number | null;
  /** The Sleepwalking Prodigy has slept through his one disaster. */
  slept: boolean;
  /** v9: the hero's active power is ready on this turn count (then every TUNE.powerEvery turns). */
  powerAt: number;
  /** Sleep It Off: no heart can be taken while this equals the turn count. */
  shieldTurn: number;
  /** (unused since v9's pure battles) */
  flex: boolean;
  /** The Crooked Curse: the next roll moves at most 2 steps. */
  curse: boolean;
  /** Victory Nap / Feed the giant: the next roll is at most 3. */
  nap: boolean;
  skipWhy: 'vines' | 'slipper';
  /** v11 Death's Door: the one roll against falling, once a match. */
  doorUsed: boolean;
  /** v13 The Insurance: the next heart this hero would lose is paid by the policy instead. */
  insured: boolean;
  /** v13 The Loan Shark: a rare creature now; the next battle must be won, or a heart goes. */
  loan: boolean;
  /** v14 The Crossroads Demon: the round its bill comes due (roll 4+ or a heart), if a deal was struck. */
  demon: number | null;
  /** v15 THE FALLEN WHISPER: a ghost's blessing (+2) or curse (−2) on this hero's next roll, and whose it was. */
  haunt: number;
  hauntBy: number | null;
}
/** Bets that ROOT FOR the rival (you only gain if they win): a survival game's most uncomfortable cheer. */
const FOR = new Set(['unholy', 'hitch', 'shared', 'doubleNothing', 'mirror', 'pact']);
/** A bet on someone's next battle (chance cards): settled the moment that battle ends. */
export interface Wager {
  id: number;
  card: string;
  by: number;
  on: number;
  call: 'win' | 'lose' | null;
  /** v12 links that name a third hero (the Mirror, the Blood Pact): the one your result reaches. */
  to?: number;
}
/** The world boss: one health bar shared by everyone; the last hit takes it. */
export interface Boss {
  cid: string;
  at: number;
  hp: number;
  max: number;
  /** v14 THE HUNT: the hero it is chasing (shown on its banner), and the one it just fought (it rests, then hunts someone else). */
  prey: number | null;
  rest: boolean;
  last: number | null;
  /** v14 the Shrine / the Whistle: a rival named as its next prey (used once). */
  marked?: number | null;
}
export type Mood = 'hunt' | 'frenzy' | 'sated';
export interface Game {
  rng: RngState;
  players: Player[];
  board: Space[];
  /** Which world each petal shows (a Great Rewire swaps them). */
  petals: WorldId[];
  round: number;
  clock: number;
  target: number;
  /** Per world: creatures not yet met this match (no repeats inside a match). */
  bag: Record<WorldId, string[]>;
  lairs: Record<number, string[]>;
  hunters: Hunter[];
  hunterId: number;
  relics: number[];
  relicsMade: number;
  shrine: number | null;
  shrineUsed: boolean;
  doom: number[];
  doomWarned: boolean;
  omen: number[];
  /** The Old Map burned: every omen is honest this round and the next. */
  honestRound: number;
  eatBag: WorldId[];
  /** A named world the next eat must include (Point at the hungry sky / the Merchant of Storms). */
  skyWorld: WorldId | null;
  flipsDone: number;
  finalTurns: boolean;
  lastLight: boolean;
  /** The light is almost out: everyone was cut to one heart. */
  dimmed: boolean;
  lastLightClashes: number;
  mirrorRound: number;
  revived: boolean;
  /** Spaces that cannot be eaten: tea (this round) and the Kalpavriksha (until the next flip or 2 rounds). */
  sheltered: { at: number; until: number; tree: boolean }[];
  /** Sworn rivals: when they meet, the winner takes two. */
  oaths: [number, number][];
  fate: Fate[];
  /** The Palm Reader's skipped cards wait for the next player. */
  passed: Fate[];
  log: Beat[];
  /** The timing model's clock when each beat began (parallel to log). */
  clocks: number[];
  winner: number | null;
  uid: number;
  /** v9 chance cards (ids, shuffled, weighted). */
  chance: string[];
  wagers: Wager[];
  wagerId: number;
  /** The ticking bomb: who holds it and the round it explodes (at that round's end). */
  bomb: { holder: number; round: number } | null;
  boss: Boss | null;
  bossDone: boolean;
  /** Lanes the player won in the last wild battle (boss damage). */
  lastWon: number;
  /** A chance card inside a chance card (Second Wind, the Portal) stops at two deep. */
  depth: number;
  telling: boolean;
  /** The Vulture: until their next turn, whoever loses a heart pays them their top creature. */
  vultures: { by: number; until: number }[];
  /** This round's weather (owner Q5): one land in a storm, one in sunshine. */
  weather: Partial<Record<WorldId, 'storm' | 'sun'>>;
  /**
   * v10 THE LAST STAND (owner: "a lone survivor wins only if he has 4 or more creatures… timer… baki players ko bhi baari aayegi
   * to set up traps"): the last one standing must hold TUNE.walkOut creatures before their turns run out, or the world keeps
   * them and the fallen win together.
   */
  stand: { seat: number; left: number } | null;
  /** The deal of cards this match plays with (stats.ts seedCards). */
  cards: string;
  /** v11 a BLOOD MOON round: every battle counts twice (the winner takes two; the loser bleeds a heart as well). */
  blood: boolean;
  traps: { at: number; by: number }[];
  /** The fallen won: the survivor did not walk out. */
  spiritsWin: boolean;
  /** Bound by Rope: until `until` (a's turn count), whenever one of them loses a creature, so does the other. */
  ropes: { a: number; b: number; until: number }[];
  /** v12 every creature this match drew from the bags (the freshness memory: the next matches deal others first). */
  drawn: string[];
  /** v12 WANTED: a price on a hero's head; whoever beats them in a duel claims it. */
  bounties: { on: number; by: number }[];
  /** v12 VENGEANCE: `by` lost a heart to `on`; their next duel, the winner takes two. */
  vendettas: { by: number; on: number }[];
  /** v12 the Dead Man's Switch: until `until` (the holder's turn count), whoever takes their heart loses one too. */
  switches: { seat: number; until: number }[];
  /** v15 THE ASSASSIN'S CONTRACT: a secret mark; it pays if the marked loses a heart before the holder's next turn. */
  contracts: { by: number; on: number; until: number }[];
  /** v15 THE OATH STONE: sworn allies (a pair shares every battle won; a meeting is a secret choice: keep the oath, or betray). */
  allies: [number, number][];
  /** Seats owed a rare creature by a paid contract (a heart cannot hand out creatures mid-fall; paid at the next turn start). */
  owed: number[];
  /** v13 THE SWEEPSTAKE: creatures in the pot; the next hero to win a battle takes them all. */
  pot: string[];
  /** v12 who moves first in every round: drawn by lot at the deal (no seat is born first). */
  firstSeat: number;
}

// ── Beats (what the screen shows, in order) ─────────────────────────────────────────────────────────────────────────────
export type Source = 'lair' | 'unleash' | 'ambush' | 'spirit' | 'riddle' | 'stampede' | 'rival' | 'hunter' | 'boss' | 'tame' | 'trap';
/** Beasts loose in the world, chasing one hero along the roads (Jumanji: what the game lets out comes after you). */
export interface Hunter {
  id: number;
  team: string[];
  at: number;
  prey: number;
  /** v14: beasts that broke out of a lair you just lost at gather first; they set off on the next world turn (you get to run). */
  wait?: boolean;
}
export interface LaneView {
  stat: Stat;
  stat2: Stat | null;
  me: string | null;
  foe: string | null;
  mine: number;
  theirs: number;
  chips: { side: Side; text: string }[];
  cause: string;
  res: 'me' | 'foe' | 'tie';
  idle: boolean;
}
export type HeartWhy = 'world' | 'creature' | 'player' | 'disaster' | 'bet' | 'suddenDeath' | 'encounter' | 'chance' | 'bomb' | 'altar' | 'land' | 'allIn';
export type Beat =
  | { t: 'start'; seats: number }
  | { t: 'round'; round: number; mood: Mood }
  | { t: 'turn'; seat: number }
  | { t: 'skip'; seat: number; why: 'vines' | 'slipper' }
  | { t: 'fates'; seat: number; cards: Fate[] }
  | { t: 'fateKept'; seat: number; fate: Fate }
  | { t: 'step'; seat: number; from: number; to: number; chalk: boolean }
  | { t: 'stop'; seat: number; by: number; at: number; why: 'sitDown' | 'pig' }
  | { t: 'stuck'; seat: number }
  | { t: 'portal'; seat: number; from: number; to: number; why: string }
  | { t: 'pushed'; seat: number; from: number; to: number; why: 'eaten' | 'washed' | 'pulled' | 'dragged' }
  | { t: 'reveal'; spaces: number[]; for: number }
  | { t: 'land'; seat: number; at: number; content: Content | 'friend' | 'shelter' }
  | { t: 'rumour'; world: WorldId; what: 'relic' | 'legend' | 'lair' }
  | {
      t: 'emerge';
      seat: number;
      at: number;
      team: string[];
      source: Source;
      by: number | null;
      law: Law | null;
    }
  | { t: 'tell'; seat: number; tells: { lane: number; cid: string }[] }
  | { t: 'team'; seat: number; uids: number[]; bet: boolean }
  | { t: 'orders'; seat: number; vs: number | null; mine: string[]; theirs: (string | null)[]; calls: Stat[]; foeCalls: (Stat | null)[] }
  | {
      t: 'fired';
      side: Side;
      seat: number | null;
      move: Move;
      lane: number;
      target: number;
      by: string;
      free: boolean;
    }
  | { t: 'bench'; seat: number; lane: number; out: string; in: string }
  | { t: 'strike'; seat: number | null; side: 'me' | 'foe'; hits: number[] }
  | { t: 'hunter'; id: number; team: string[]; at: number; prey: number; why: 'loose' | 'wake' }
  | { t: 'hunterStep'; id: number; to: number; prey: number; left: number }
  | { t: 'hunterGone'; id: number; why: 'void' | 'fought' | 'light' | 'stand' }
  | {
      t: 'clash';
      seat: number;
      vs: number | null;
      at: number;
      law: Law | null;
      lanes: LaneView[];
      outcome: 'win' | 'lose' | 'standoff';
      crowd: boolean;
    }
  | {
      t: 'capture';
      seat: number;
      cid: string;
      why: 'clash' | 'snatch' | 'steal' | 'cache' | 'riddle' | 'boon' | 'gamble' | 'gift' | 'power' | 'boss' | 'wager' | 'nest' | 'attack' | 'hilo' | 'trade' | 'altar' | 'tame';
    }
  | {
      t: 'lost';
      seat: number;
      cid: string;
      why: 'clash' | 'disaster' | 'world' | 'riddle' | 'gamble' | 'stolen' | 'release' | 'fee' | 'escaped' | 'hair' | 'given' | 'void' | 'overboard' | 'wager' | 'trial' | 'attack' | 'trade' | 'altar' | 'rope' | 'fled';
    }
  | { t: 'guarded'; seat: number; cid: string }
  | { t: 'ascend'; seat: number; cid: string; tier: 1 | 2 }
  | { t: 'fuse'; seat: number; a: string; b: string }
  | { t: 'relic'; seat: number; from: number | null; relics: number }
  | { t: 'heart'; seat: number; hearts: number; why: HeartWhy; by: number | null; cid?: string }
  | { t: 'heal'; seat: number; hearts: number; why: 'shrine' | 'phoenix' | 'kamadhenu' | 'encounter' | 'chance' | 'boss' | 'altar' | 'door' }
  | { t: 'out'; seat: number }
  | { t: 'omen'; spaces: number[] }
  | { t: 'omenHeals'; spaces: number[] }
  | { t: 'eye'; seat: number }
  | { t: 'eat'; spaces: number[]; world: WorldId | null; size: 'spaces' | 'chunk' | 'world'; warned: boolean }
  | { t: 'spared'; seat: number; at: number; why: 'near' | 'round1' | 'fly' | 'brahmastra' | 'cap' }
  | {
      t: 'disaster';
      seat: number;
      world: WorldId;
      dodged: string | null;
      why: 'dodge' | 'slept' | 'brahmastra' | null;
    }
  | { t: 'riddle'; seat: number; riddle: Riddle; pick: 'a' | 'b'; random: boolean }
  | { t: 'encounter'; seat: number; enc: string; pick: number; fates: ('good' | 'bad' | 'none')[] }
  | { t: 'cache'; seat: number; at: number; relic: boolean; cid: string | null; boon: BoonKey | null }
  | { t: 'shrine'; seat: number; at: number; gain: 'heart' | 'boon' }
  | { t: 'bet'; seat: number; won: boolean }
  | { t: 'boon'; seat: number; key: BoonKey; why: string }
  | { t: 'boonUsed'; seat: number; key: BoonKey }
  | { t: 'golden'; seat: number }
  | { t: 'big'; seat: number; effect: BigEffect; target: number | WorldId | null }
  | { t: 'swap'; seat: number; with: number }
  | { t: 'tired'; seat: number; cid: string; gift: Gift }
  | { t: 'redirect'; seat: number; to: number }
  | { t: 'fizzle'; seat: number }
  | { t: 'oath'; a: number; b: number }
  | { t: 'tree'; seat: number; at: number }
  | { t: 'mood'; mood: Mood }
  | { t: 'flipOmen'; n: number }
  | {
      t: 'flip';
      flip: FlipKind;
      petals: WorldId[];
      board: Space[];
      passes: { from: number; to: number; cid: string }[];
    }
  | { t: 'finalTurns'; seat: number; boon: BoonKey }
  | { t: 'lastLight' }
  | { t: 'dim' }
  | { t: 'suddenDeath' }
  | { t: 'revive'; seat: number; at: number }
  | { t: 'escape'; seat: number }
  | { t: 'power'; seat: number; key: HeroGift }
  | { t: 'dice'; seat: number; dice: number[]; n: number; mode: RollMode; cap: 'nap' | 'knees' | 'curse' | null; bonus: number }
  | { t: 'chance'; seat: number; card: string }
  | { t: 'news'; text: string; seat: number | null; tone: 'good' | 'bad' | 'gold' | '' }
  | { t: 'wager'; id: number; card: string; by: number; on: number; call: 'win' | 'lose' | null; to?: number }
  | { t: 'wagerEnd'; id: number; card: string; by: number; on: number; result: 'win' | 'lose' | 'void' }
  | { t: 'bomb'; seat: number | null; from: number | null; round: number }
  | { t: 'boom'; seat: number }
  | { t: 'curse'; seat: number; by: number }
  | { t: 'trial'; seat: number; card: string; hits: number[] }
  | { t: 'stampede'; world: WorldId; seats: number[] }
  | { t: 'boss'; cid: string; at: number; hp: number; max: number }
  | { t: 'bossStep'; to: number }
  /** v15 THE OATH STONE: who is sworn to whom now (the plates show it). */
  | { t: 'allies'; pairs: [number, number][] }
  /** v14 THE HUNT: the beast rolls its own die in front of everyone and names its prey. */
  | { t: 'bossHunt'; prey: number; roll: number; rest: boolean }
  | { t: 'bossHit'; seat: number; dmg: number; hp: number; max: number }
  | { t: 'bossDown'; seat: number; cid: string }
  | { t: 'weather'; storm: WorldId | null; sun: WorldId | null }
  | { t: 'nest'; seat: number; roll: number }
  | { t: 'content'; at: number; content: Content }
  /** v10: the land strikes before a turn: the top card of a shuffled deck must match the land's number on one stat. */
  | { t: 'attack'; seat: number; world: WorldId; cid: string | null; value: number; power: number; ok: boolean; guarded?: boolean }
  /** The Oracle's Ladder: one rung (step 0 is the first card shown). */
  | { t: 'hilo'; seat: number; stat: Stat; cid: string; val: number; step: number; guess: 'hi' | 'lo' | null; ok: boolean | null }
  | { t: 'altar'; seat: number; pick: 'creature' | 'heart' | 'walk' }
  | { t: 'trade'; seat: number; gave: string | null; got: string | null }
  /** A relic (v > 0) or a hex (v < 0) lands on one creature. */
  | { t: 'mod'; seat: number; cid: string; name: string; v: number; by: number | null }
  | { t: 'rope'; a: number; b: number }
  /** The Achilles' Heel: my top creature's number in their top creature's weakest stat, against theirs. */
  | { t: 'heel'; seat: number; on: number; mine: string; theirs: string; stat: Stat; a: number; b: number; hit: boolean }
  | { t: 'die'; seat: number; roll: number }
  /** v11 Death's Door: a falling hero's one roll (5 or 6 and they stay, on one heart). */
  | { t: 'door'; seat: number; roll: number; saved: boolean }
  /** v11 The Wheel of Pralaya: three reels, WHO · WHAT · WITH WHOM, then the world obeys. */
  | { t: 'wheel'; seat: number; a: number; act: WheelAct; b: number }
  /** Hearts and creature counts after a wheel swap (the screen's plates follow). */
  | { t: 'swapAll'; a: number; b: number; what: 'hearts' | 'decks'; aHearts: number; bHearts: number; aCount: number; bCount: number }
  | { t: 'bloodMoon'; on: boolean }
  /** v12 the Road Not Taken: what the other reachable places held (then they are dealt again, in secret). */
  /** v13 a moment of luck or nerve, told on one card (dice shown when there are dice). [[n]] names a hero. */
  | { t: 'moment'; seat: number | null; kicker: string; title: string; text: string; tone: 'gold' | 'bad' | ''; dice?: number[]; cid?: string }
  /** v12 the Cave of Echoes: one step deeper (a creature found, or the roof comes down). */
  | { t: 'cave'; seat: number; depth: number; cid: string | null; fell: boolean; risk: number }
  | { t: 'caveOut'; seat: number; kept: string[] }
  /** v12 the Bridge of Trust: two heroes choose in secret, SHARE or TAKE. */
  | { t: 'trust'; a: number; b: number; pa: 'share' | 'take'; pb: 'share' | 'take' }
  | { t: 'vendetta'; by: number; on: number; on2: boolean }
  | { t: 'bounty'; on: number; by: number; claimed: number | null }
  /** v12 the wild's calls are drawn blind, at random (owner: "game ke paas dimaag na ho"). */
  | { t: 'wildDraw'; seat: number; calls: (Stat | null)[] }
  | { t: 'stand'; seat: number; need: number; left: number; have: number; start: boolean }
  | { t: 'trap'; by: number; at: number }
  | { t: 'trapSprung'; by: number; at: number; seat: number }
  | { t: 'worldWins'; seat: number; seats: number[] }
  | { t: 'win'; seat: number; why: 'last' | 'escape' | 'walkout' };
export type RollMode = 'roll' | 'two' | 'measure' | 'moon' | 'lucky' | 'flex';
export type WheelAct = 'swapHearts' | 'swapDecks' | 'giveTop' | 'stealHeart' | 'legend' | 'curseAll';

export type BigEffect = 'stampede' | 'swallow' | 'exile' | 'plunder' | 'fuse';
export type TargetWhy =
  | 'unleash' | 'swap' | 'parrot' | 'stampede' | 'exile' | 'plunder' | 'spirit' | 'oath' | 'redirect'
  | 'bomb' | 'curse' | 'scent' | 'kingFrom' | 'kingTo' | 'toll' | 'chalice' | 'gift' | 'heartTax' | 'duel' | 'arenaA' | 'arenaB'
  | 'quick' | 'prophet' | 'double' | 'lions' | 'swapAny' | 'jar' | 'switch' | 'slipper' | 'hexGive' | 'relicGive' | 'rope'
  | 'heel' | 'bloodPrice' | 'sinking' | 'feast' | 'empty' | 'mirror' | 'pact' | 'bounty' | 'trust' | 'whistle' | 'pickpocket' | 'ring'
  | 'anchor' | 'chest' | 'bss' | 'haunt' | 'ally' | 'hitch' | 'cutCrown' | 'devil' | 'ransom' | 'robinA' | 'robinB' | 'underdog';
export type Ask =
  | { k: 'fate'; seat: number; cards: Fate[]; golden: boolean }
  | { k: 'steps'; seat: number; options: number[] }
  | { k: 'fork'; seat: number; mover: number; at: number; options: number[]; left: number }
  | { k: 'target'; seat: number; why: TargetWhy; options: number[] }
  | { k: 'world'; seat: number; why: 'portal' | 'swallow' | 'sky' | 'merchant'; options: WorldId[] }
  | { k: 'space'; seat: number; why: 'garuda' | 'vimana' | 'roll' | 'trap' | 'heart'; options: number[]; n?: number }
  | { k: 'golden'; seat: number; effects: BigEffect[] }
  | {
      k: 'team';
      seat: number;
      drawn: Owned[];
      /** The wild team's faces (order hidden); null in PvP. In Forever Night only their types are shown. */
      faces: (string | null)[] | null;
      dark: boolean;
      tells: { lane: number; cid: string }[];
      canBet: boolean;
      secret: boolean;
      vs: number | null;
      law: Law | null;
      /** The Mirror Strongman: his strongest must stand in lane 1. */
      leadBest: boolean;
      /** The lanes whose stat this player CALLS (v10: every lane they fill; the other side calls too, and both count). */
      calls: number[];
      /** v10: how many lanes this battle has (fewer creatures: 2 v 2 or 1 v 1). */
      size: number;
    }
  | {
      /** THE STRIKE: time your blow in each lane (a ring closes; press as it meets the mark). */
      k: 'strike';
      seat: number;
      side: 'me' | 'foe';
      lanes: number[];
    }
  | {
      k: 'move';
      seat: number;
      mine: (Fighter | null)[];
      theirs: (Fighter | null)[];
      fired: Fired[];
      /** Lanes whose creature is ascended (their special fires free). */
      free: number[];
      law: Law | null;
      /** The Snake-Oil Salesman's bench (one swap instead of a special). */
      bench: Owned[];
      /** The stats called in each lane. */
      calls: Stat[];
    }
  | { k: 'riddle'; seat: number; riddle: Riddle }
  | { k: 'encounter'; seat: number; enc: Encounter }
  | { k: 'release'; seat: number; deck: Owned[]; why: 'full' | 'fee' | 'trade' | 'equip'; relic?: string }
  | { k: 'fuse'; seat: number; deck: Owned[] }
  | { k: 'boon'; seat: number; options: BoonKey[] }
  | { k: 'wish'; seat: number }
  | { k: 'doom'; seat: number; options: number[][] }
  | { k: 'stop'; seat: number; mover: number; at: number }
  | { k: 'pull'; seat: number; ringmaster: number }
  /** v9: the turn begins: roll, or fire the hero's power first (ready = turns until it is), or play the golden card. */
  | { k: 'roll'; seat: number; golden: boolean; power: HeroGift; ready: number }
  /** The Prophet's Wager: will they win their next battle? (answer: yes = WIN) */
  | { k: 'predict'; seat: number; on: number }
  | { k: 'pick'; seat: number; why: 'chalice' | 'altar' | 'trader' | 'ransom' | 'devil' | 'trust'; options: string[]; secret?: boolean; vs?: number }
  /** v12 the Cave of Echoes: go one step deeper (yes) or walk out with what you found. */
  | { k: 'deeper'; seat: number; found: string[]; risk: number; depth: number }
  /** v13 a plain choice with its words (answer: pick i). `secret`: behind the cover. */
  | { k: 'choice'; seat: number; title: string; sub: string; options: string[]; def: number; secret?: boolean }
  /** The Oracle's Ladder: is the next card's number higher? (answer: yes = HIGHER) */
  | { k: 'hilo'; seat: number; stat: Stat; cid: string; val: number; step: number }
  /** A timed trial (chance cards and stampedes only): press as the ring meets the mark, n times. */
  | { k: 'trial'; seat: number; card: string; n: number };
export interface Fire {
  lane: number;
  target: number;
  /** For a fusion: which of its two moves. */
  move?: Move;
}
export type Answer =
  | { k: 'fate'; index: number }
  | { k: 'playGolden' }
  | { k: 'steps'; n: number }
  | { k: 'fork'; to: number }
  | { k: 'target'; seat: number }
  | { k: 'world'; world: WorldId }
  | { k: 'space'; at: number }
  | { k: 'golden'; effect: BigEffect }
  | { k: 'team'; order: number[]; bet: boolean; fire: Fire | null; calls?: (Stat | null)[] }
  | { k: 'move'; fire: Fire | null; free: Fire[]; bench: { lane: number; uid: number } | null }
  | { k: 'strike'; hits: number[] }
  | { k: 'riddle'; pick: 'a' | 'b' }
  | { k: 'encounter'; pick: number }
  | { k: 'release'; uid: number }
  | { k: 'fuse'; a: number; b: number }
  | { k: 'boon'; key: BoonKey }
  | { k: 'wish'; pick: 'heart' | 'creature' | 'rest' }
  | { k: 'doom'; index: number }
  | { k: 'yes'; yes: boolean }
  | { k: 'roll'; use: 'roll' | 'power' | 'golden' }
  | { k: 'pick'; i: number }
  | { k: 'trial'; hits: number[] };

type Gen<T = void> = Generator<Ask, T, Answer>;

/** The stats a player called; an uncalled or unknown lane defaults to that card's best stat (the safe call). */
function callsOf(team: readonly (Owned | null)[], called: readonly (Stat | null)[] | undefined, lanes: readonly number[]): (Stat | null)[] {
  return [0, 1, 2].map((i) => {
    if (!lanes.includes(i)) return null;
    const c = called?.[i];
    if (c && (STATS as readonly string[]).includes(c)) return c;
    const o = team[i];
    return o ? bestStat(fighter(o).stats) : 'POWER';
  });
}
const merge = (a: readonly (Stat | null)[], b: readonly (Stat | null)[]): Stat[] => [0, 1, 2].map((i) => a[i] ?? b[i] ?? 'POWER');

/** Let beasts loose on a hero (capped: the world never fields more than TUNE.huntersMax hunts at once). */
function loose(g: Game, team: string[], at: number, prey: Player, why: 'loose' | 'wake'): void {
  if (g.hunters.length >= TUNE.huntersMax || g.lastLight || !team.length) return;
  const h: Hunter = { id: ++g.hunterId, team: [...team], at, prey: prey.seat, wait: why === 'loose' };
  g.hunters.push(h);
  say(g, { t: 'hunter', id: h.id, team: h.team, at, prey: prey.seat, why }, sec('hunter'));
}
/** The hunts close in: each hunter runs up to TUNE.hunterSteps along open roads toward its prey; reaching them is a clash. */
function* hunt(g: Game): Gen {
  for (const h of [...g.hunters]) {
    if (g.winner !== null || alive(g).length <= 1) return;
    if (h.wait) {
      h.wait = false;
      continue;
    }
    let prey = g.players[h.prey]!;
    if (prey.out) {
      const live = alive(g);
      prey = fair(g, live).reduce((a, b) => (distance(g.board, h.at, b.at) < distance(g.board, h.at, a.at) ? b : a));
      h.prey = prey.seat;
    }
    for (let k = 0; k < TUNE.hunterSteps && h.at !== prey.at; k++) {
      const nx = towards(g.board, h.at, (x) => x.id === prey.at, CENTRE);
      if (nx === null || nx === CENTRE) break;
      h.at = nx;
      say(g, { t: 'hunterStep', id: h.id, to: nx, prey: prey.seat, left: Math.max(0, distance(g.board, nx, prey.at)) }, 0.8);
    }
    if (h.at === prey.at && !treeAt(g, prey.at)) yield* caught(g, h, prey);
  }
}
/** A hunter and a hero on one place: they fight; the hunt ends either way (the beasts win or are beaten back). */
function* caught(g: Game, h: Hunter, p: Player): Gen {
  g.hunters = g.hunters.filter((x) => x !== h);
  say(g, { t: 'hunterGone', id: h.id, why: 'fought' }, 0.5);
  yield* clashWild(g, p, h.team, h.at, 'hunter', null);
}

/** Ask a person; a wrong-shaped answer reads as "no answer" (the rules then take the safe default). */
/** The match being played (asks add the typical thinking time to its clock, so progress reflects the real table). */
let CUR: Game | null = null;
function* ask<K extends Answer['k']>(a: Ask, k: K): Gen<Extract<Answer, { k: K }> | null> {
  if (CUR) CUR.clock += TUNE.think[a.k] ?? 2;
  const r = yield a;
  return r && r.k === k ? (r as Extract<Answer, { k: K }>) : null;
}

// ── Randomness (all through g.rng) ──────────────────────────────────────────────────────────────────────────────────────
export function rand(g: Game): number {
  const [r, s] = next(g.rng);
  g.rng = s;
  return r;
}
function pickOne<T>(g: Game, xs: readonly T[]): T {
  return xs[Math.floor(rand(g) * xs.length)] as T;
}
/** v12 (owner: "koi biasness nahi"): before ranking heroes, shuffle them, so a tie never falls to the lowest seat. */
const fair = <T>(g: Game, xs: readonly T[]): T[] => shuffled(g, xs);
function shuffled<T>(g: Game, xs: readonly T[]): T[] {
  const [out, s] = shuffle(xs, g.rng);
  g.rng = s;
  return out;
}

// ── Reading the state ───────────────────────────────────────────────────────────────────────────────────────────────────
export const alive = (g: Game) => g.players.filter((p) => !p.out);
export const progress = (g: Game) => Math.min(1, g.clock / g.target);
const say = (g: Game, b: Beat, secs = 0) => {
  g.log.push(b);
  g.clocks.push(g.clock);
  g.clock += secs;
};
const sec = (k: string) => TUNE.secs[k] ?? 3;
const open = (g: Game) => g.board.filter((s) => !s.void);
/** v9 (owner, 2026-10-31: "battles like choosing stat, shuffling, bas"): a battle is pure Top Trumps. No land bends it. */
export const lawAt = (g: Game, at: number): Law | null => {
  void g;
  void at;
  return null;
};

export function fighter(o: Owned): Fighter {
  const a = creature(o.cid);
  const b = o.fused ? creature(o.fused) : null;
  const base = b ? fuseStats(statsOf(a), statsOf(b)) : statsOf(a);
  // v16 (owner: "cards ko enhance karun… par dar bhi rahe"): battle-earned lifts stack with relics and hexes.
  const m = (o.mod ?? 0) + (o.ascended ? TUNE.ascendLift : 0) + (o.exalted ? TUNE.ascendLift : 0);
  return {
    id: o.cid,
    types: b ? [a.type, b.type] : [a.type],
    power: b ? Math.max(a.power, b.power) : a.power,
    moves: b ? [a.move, b.move] : [a.move],
    stats: m ? (Object.fromEntries(STATS.map((st) => [st, Math.max(1, base[st] + m)])) as Fighter['stats']) : base,
  };
}
export const giftsOf = (o: Owned): Gift[] =>
  [creature(o.cid).gift, o.fused ? creature(o.fused).gift : undefined].filter((x): x is Gift => !!x);
export const wildFighter = (cid: string): Fighter => {
  const c = creature(cid);
  // v12 HOME GROUND: the wild calls blind (no brain), so it fights on its own soil instead: a flat lift to every number, the
  // same for every hero, shown on the screen. Keeps the wild dangerous without ever aiming at anyone.
  const st = statsOf(c);
  const stats = Object.fromEntries(STATS.map((k) => [k, Math.min(99, st[k] + TUNE.wildHome)])) as typeof st;
  return { id: cid, types: [c.type], power: c.power, moves: [c.move], stats };
};
const power = (o: Owned) => fighter(o).power;
const weakest = (xs: Owned[]) => xs.reduce((a, b) => (power(b) < power(a) ? b : a));
const strongest = (xs: Owned[]) => xs.reduce((a, b) => (power(b) > power(a) ? b : a));
const rank = (cid: string) => {
  const c = creature(cid);
  return { common: 0, uncommon: 10, rare: 20, legendary: 30 }[c.rarity] + c.power;
};

/** The leader the world holds a grudge against: most hearts, then creatures, then relics (WANTED and the marked count +1 heart). */
export function grudgeTarget(g: Game): Player | null {
  const live = alive(g);
  if (!live.length) return null;
  const score = (p: Player) =>
    (p.hearts + (p.hero.weak === 'wanted' ? 1 : 0) + (p.marked ? 1 : 0)) * 100 +
    p.deck.length * 10 +
    p.relics * 30;
  return fair(g, live).reduce((a, b) => (score(b) > score(a) ? b : a));
}
function nearestOpen(g: Game, from: number): number {
  let best = CENTRE;
  let bd = Infinity;
  for (const s of open(g)) {
    const d = Math.hypot(s.x - g.board[from]!.x, s.y - g.board[from]!.y);
    if (d < bd && s.id !== from) {
      bd = d;
      best = s.id;
    }
  }
  return best;
}
const sheltered = (g: Game, at: number) => g.sheltered.some((x) => x.at === at && x.until >= g.round);
const treeAt = (g: Game, at: number) => g.sheltered.some((x) => x.at === at && x.tree && x.until >= g.round);

// ── Setup ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * `fresh` (v12, owner: "10 games lagatar khelun, har baar naya character"): creatures met in the last matches on this device.
 * They go to the bottom of every bag, so a new match deals the ones you have not met first. Same inputs, same match.
 */
export function createGame(names: string[], seed: number, fresh: readonly string[] = []): Game {
  // Deal this match's cards: fresh numbers and forms for every creature (nobody can learn the deck).
  seedCards(seed);
  const g: Game = {
    rng: seedRng(seed),
    players: [],
    board: makeBoard(),
    petals: [...WORLDS],
    round: 0,
    clock: 0,
    target: TUNE.target.base + TUNE.target.perSeat * names.length,
    bag: {} as Record<WorldId, string[]>,
    lairs: {},
    hunters: [],
    hunterId: 0,
    relics: [],
    relicsMade: 0,
    shrine: null,
    shrineUsed: false,
    doom: [],
    doomWarned: true,
    omen: [],
    honestRound: -9,
    eatBag: [],
    skyWorld: null,
    flipsDone: 0,
    finalTurns: false,
    lastLight: false,
    dimmed: false,
    lastLightClashes: 0,
    mirrorRound: -1,
    revived: false,
    sheltered: [],
    oaths: [],
    fate: [],
    passed: [],
    log: [],
    clocks: [],
    winner: null,
    uid: 0,
    chance: [],
    wagers: [],
    wagerId: 0,
    bomb: null,
    boss: null,
    bossDone: false,
    lastWon: 0,
    depth: 0,
    telling: false,
    vultures: [],
    weather: {},
    cards: String(seed),
    stand: null,
    blood: false,
    traps: [],
    spiritsWin: false,
    ropes: [],
    drawn: [],
    bounties: [],
    vendettas: [],
    switches: [],
    contracts: [],
    allies: [],
    owed: [],
    pot: [],
    firstSeat: 0,
  };
  // v15 (owner: "freshness… koi constraint nahi… pool bada ho, repeat sirf probability se"): every land's creatures are one honest
  // shuffled deck per match. No memory of past matches, no order but chance.
  void fresh;
  for (const w of WORLDS)
    g.bag[w] = shuffled(
      g,
      CREATURES.filter((c) => c.world === w).map((c) => c.id),
    );
  // Space contents per world: 2 lairs, a disaster, a riddle, a cache.
  // v10 (owner: "map same rhe har game mein but kis block pe land karke kya hoga it changes every game… koi pattern na ho"): every
  // land deals a fixed core and a random draw from the wider pool, shuffled per match; no two matches hide the same things.
  for (const w of WORLDS) {
    const kinds = shuffled<Content>(g, [...TUNE.contentsCore, ...shuffled(g, TUNE.contentsPool).slice(0, 9 - TUNE.contentsCore.length)] as Content[]);
    g.board.filter((s) => s.world === w).forEach((s, i) => (s.content = kinds[i]!));
  }
  const heroes = shuffled(g, HEROES);
  const commons = shuffled(
    g,
    CREATURES.filter((c) => c.rarity === 'common' && c.power <= 5).map((c) => c.id),
  );
  const offset = Math.floor(rand(g) * 24);
  names.forEach((name, seat) => {
    const deck: Owned[] = [];
    for (let i = 0; i < TUNE.startDeck; i++) {
      const cid = commons.pop()!;
      takeFromBag(g, cid);
      deck.push({ uid: g.uid++, cid, ascended: false, wins: 0, tired: false });
    }
    const at = (offset + Math.round((seat * 24) / names.length)) % 24;
    g.board[at]!.seen = true;
    const [lo, hi] = TUNE.goldenTurns as [number, number];
    g.players.push({
      seat,
      name,
      hero: heroes[seat % heroes.length]!,
      hearts: TUNE.hearts,
      deck,
      relics: 0,
      boons: [],
      at,
      from: null,
      out: false,
      betUsed: false,
      goldenAt: lo + Math.floor(rand(g) * (hi - lo + 1)),
      golden: 'none',
      eatHitRound: -9,
      turns: 0,
      usedRound: -1,
      nextDraw: 0,
      bonusDraws: 0,
      guardTurn: -1,
      skip: false,
      lastLost: null,
      peek: false,
      mapTurn: -1,
      marked: false,
      harmedRound: -1,
      sleeper: null,
      slept: false,
      powerAt: TUNE.powerFirst,
      shieldTurn: -1,
      flex: false,
      curse: false,
      nap: false,
      skipWhy: 'vines',
      doorUsed: false,
      insured: false,
      loan: false,
      demon: null,
      haunt: 0,
      hauntBy: null,
    });
  });
  g.eatBag = shuffled(g, WORLDS);
  g.firstSeat = Math.floor(rand(g) * names.length);
  return g;
}

// ── Hearts, creatures, boons ────────────────────────────────────────────────────────────────────────────────────────────
/** Lose a heart. `soft`: it may never knock anyone out (a Big Moment's swallow). */
function loseHeart(g: Game, p: Player, why: HeartWhy, by: number | null, cid?: string, soft = false): void {
  // (A hero already at zero is mid-fall: a switch or a rope that echoes back can never take a heart below nothing.)
  if (p.out || p.hearts <= 0) return;
  if (p.shieldTurn === p.turns && why !== 'suddenDeath' && why !== 'allIn' && alive(g).length > 1) {
    // v16: the sleep keeps the first heart only (then the sleeper is awake).
    p.shieldTurn = -1;
    say(g, { t: 'news', text: `[[${p.seat}]] sleeps through it. No heart is taken.`, seat: p.seat, tone: 'gold' }, 2);
    return;
  }
  // Always one survivor: the last one never falls (except in the Last Stand, where the world can keep them).
  if (alive(g).length === 1 && !g.stand) return;
  if (soft && p.hearts === 1) {
    news(g, `[[${p.seat}]] is on their last heart. This one cannot take it.`, p.seat);
    return;
  }
  // No knock-out before the middle of the match (books-v8 V8): the blow takes a creature instead — by a hair. v14: a hero with no
  // creature is spared too (never knocked out early just for being empty-handed).
  if (p.hearts === 1 && progress(g) < TUNE.noKnockoutBefore && why !== 'world' && why !== 'suddenDeath' && why !== 'allIn') {
    if (!p.deck.length) {
      news(g, `[[${p.seat}]] hangs on by a thread. Too early in the end of the world to fall.`, p.seat);
      return;
    }
    const o = weakest(p.deck);
    p.deck = p.deck.filter((x) => x !== o);
    say(g, { t: 'lost', seat: p.seat, cid: o.cid, why: 'hair' }, 2.5);
    return;
  }
  if (p.hearts === 1 && p.boons.includes('phoenix') && why !== 'allIn') {
    useBoon(g, p, 'phoenix');
    return;
  }
  if (p.insured && why !== 'suddenDeath' && why !== 'allIn') {
    p.insured = false;
    say(g, { t: 'moment', seat: p.seat, kicker: 'THE INSURANCE', title: 'THE POLICY PAYS', text: '[[' + p.seat + ']] keeps the heart. The policy is spent.', tone: 'gold' }, 2.5);
    return;
  }
  p.hearts--;
  say(g, { t: 'heart', seat: p.seat, hearts: p.hearts, why, by, ...(cid ? { cid } : {}) }, 2.5);
  // v12 VENGEANCE (the Ludo "kaat diya" grudge): a hero who takes your heart is marked; your next duel, the winner takes two.
  if (by !== null && by !== p.seat && p.hearts > 0 && !g.players[by]!.out && !g.vendettas.some((v) => v.by === p.seat && v.on === by)) {
    g.vendettas.push({ by: p.seat, on: by });
    say(g, { t: 'vendetta', by: p.seat, on: by, on2: true }, 1.5);
  }
  // v15 THE ASSASSIN'S CONTRACT: a secret mark pays out, and is revealed, the moment the marked loses a heart.
  for (const c of g.contracts.filter((x) => x.on === p.seat)) {
    const k = g.players[c.by]!;
    g.contracts = g.contracts.filter((x) => x !== c);
    if (k.out) continue;
    say(g, { t: 'moment', seat: k.seat, kicker: "THE ASSASSIN'S CONTRACT", title: 'THE CONTRACT PAYS', text: `[[${k.seat}]] had a secret contract on [[${p.seat}]] all along. It pays: a heart (a rare creature if whole).`, tone: 'gold' }, 3);
    if (!heal(g, k, 'chance')) g.owed.push(k.seat);
  }
  // v12 THE DEAD MAN'S SWITCH: take this heart and you lose one too (once).
  const sw = by !== null && by !== p.seat ? g.switches.find((x) => x.seat === p.seat && p.turns <= x.until) : undefined;
  if (sw) {
    g.switches = g.switches.filter((x) => x !== sw);
    const k = g.players[by!]!;
    news(g, `The Dead Man's Switch clicks. [[${k.seat}]] took a heart from [[${p.seat}]], and pays one back.`, k.seat, 'bad', 2.5);
    loseHeart(g, k, 'chance', p.seat);
  }
  for (const v of g.vultures) {
    const vb = g.players[v.by]!;
    if (vb === p || vb.out || vb.turns > v.until || !p.deck.length || vb.deck.length >= TUNE.hold) continue;
    const o = strongest(p.deck);
    p.deck = p.deck.filter((x) => x !== o);
    say(g, { t: 'lost', seat: p.seat, cid: o.cid, why: 'stolen' }, 1.5);
    vb.deck.push({ ...o, tired: false });
    say(g, { t: 'capture', seat: vb.seat, cid: o.cid, why: 'wager' }, 2);
    break;
  }
  // v11 DEATH'S DOOR (owner: "baal baal bache heroic moments"): once a match, a falling hero rolls in front of everyone.
  if (p.hearts <= 0 && !p.doorUsed && why !== 'suddenDeath') {
    p.doorUsed = true;
    const roll = 1 + Math.floor(rand(g) * 6);
    const saved = roll >= TUNE.doorAt;
    say(g, { t: 'door', seat: p.seat, roll, saved }, sec('door'));
    if (saved) {
      p.hearts = 1;
      say(g, { t: 'heal', seat: p.seat, hearts: 1, why: 'door' }, 1.5);
      return;
    }
  }
  if (p.hearts <= 0) {
    p.out = true;
    g.wagers = g.wagers.filter((w) => w.by !== p.seat && w.on !== p.seat && w.to !== p.seat);
    g.bounties = g.bounties.filter((b) => b.on !== p.seat);
    g.vendettas = g.vendettas.filter((v) => v.by !== p.seat && v.on !== p.seat);
    g.allies = g.allies.filter(([a, b]) => a !== p.seat && b !== p.seat);
    g.contracts = g.contracts.filter((c) => c.by !== p.seat && c.on !== p.seat);
    if (g.bomb?.holder === p.seat) g.bomb = null;
    say(g, { t: 'out', seat: p.seat }, 4);
  }
}
function heal(g: Game, p: Player, why: Extract<Beat, { t: 'heal' }>['why']): boolean {
  if (p.hearts >= TUNE.hearts) return false;
  p.hearts++;
  say(g, { t: 'heal', seat: p.seat, hearts: p.hearts, why }, 2.5);
  return true;
}
function takeFromBag(g: Game, cid: string): void {
  const w = creature(cid).world;
  if (!g.drawn.includes(cid)) g.drawn.push(cid);
  g.bag[w] = g.bag[w].filter((x) => x !== cid);
}
function* gain(g: Game, p: Player, cid: string, why: Extract<Beat, { t: 'capture' }>['why']): Gen<Owned> {
  const o: Owned = { uid: g.uid++, cid, ascended: false, wins: 0, tired: false };
  if (cid === 'kumbhakarna') p.sleeper = o.uid;
  p.deck.push(o);
  say(g, { t: 'capture', seat: p.seat, cid, why }, 2);
  yield* settleHold(g, p);
  return o;
}
function* settleHold(g: Game, p: Player): Gen {
  while (p.deck.length > TUNE.hold) {
    const a = yield* ask({ k: 'release', seat: p.seat, deck: p.deck, why: 'full' }, 'release');
    const o = p.deck.find((x) => x.uid === a?.uid) ?? weakest(p.deck);
    p.deck = p.deck.filter((x) => x !== o);
    say(g, { t: 'lost', seat: p.seat, cid: o.cid, why: 'release' }, 1);
  }
}
/** Lose one creature (the weakest by default, or the strongest). Returns false when there was none to lose. */
function loseCreature(
  g: Game,
  p: Player,
  why: Extract<Beat, { t: 'lost' }>['why'],
  pick: 'weakest' | 'strongest' = 'weakest',
  among?: Owned[],
): boolean {
  const pool = among?.length ? among.filter((o) => p.deck.includes(o)) : p.deck;
  const from = pool.length ? pool : p.deck;
  if (!from.length) return false;
  const o = pick === 'strongest' ? strongest(from) : weakest(from);
  if (p.guardTurn >= p.turns && why !== 'release' && why !== 'fee') {
    say(g, { t: 'guarded', seat: p.seat, cid: o.cid }, 2);
    return true;
  }
  p.deck = p.deck.filter((x) => x !== o);
  p.lastLost = o.cid;
  say(g, { t: 'lost', seat: p.seat, cid: o.cid, why }, 2.5);
  // Bound by Rope: the other end falls too (once; a rope never pulls itself).
  if (why !== 'rope' && why !== 'release' && why !== 'fee')
    for (const r of [...g.ropes]) {
      const other = r.a === p.seat ? r.b : r.b === p.seat ? r.a : null;
      if (other === null || g.players[r.a]!.turns > r.until) continue;
      const q = g.players[other]!;
      g.ropes = g.ropes.filter((x) => x !== r);
      if (!q.out && q.deck.length) {
        news(g, `The rope pulls tight. [[${q.seat}]] falls with [[${p.seat}]].`, q.seat, 'bad');
        loseCreature(g, q, 'rope');
      }
    }
  return true;
}
/**
 * v14 (owner: "0 cards mein injustice na ho"): a blow aimed at a creature only ever takes a creature. A hero with none left has
 * nothing for it to take: it passes them by, said out loud (it never turns into a heart).
 */
function strike(g: Game, p: Player, why: Extract<Beat, { t: 'lost' }>['why']): void {
  if (!loseCreature(g, p, why)) news(g, `[[${p.seat}]] has no creature left to lose. The blow passes over them.`, p.seat);
}
function drawRare(g: Game, min = 0): string {
  const rares = CREATURES.filter(
    (c) => c.rarity === 'rare' && c.power >= min && g.bag[c.world].includes(c.id),
  );
  const pick = rares.length
    ? pickOne(g, rares).id
    : pickOne(
        g,
        CREATURES.filter((c) => c.rarity === 'rare'),
      ).id;
  takeFromBag(g, pick);
  return pick;
}
const wonder = (g: Game): BoonKey =>
  pickOne(
    g,
    BOONS.filter((b) => !b.sacred),
  ).key;
const sacred = (g: Game, n: number): BoonKey[] =>
  shuffled(
    g,
    BOONS.filter((b) => b.sacred).map((b) => b.key),
  ).slice(0, n);
function useBoon(g: Game, p: Player, key: BoonKey): boolean {
  const i = p.boons.indexOf(key);
  if (i < 0) return false;
  p.boons.splice(i, 1);
  say(g, { t: 'boonUsed', seat: p.seat, key }, 2.5);
  return true;
}
/** A boon takes effect (or is held, for the ones that wait for their moment: Brahmastra, the Phoenix at full hearts). */
function* giveBoon(g: Game, p: Player, key: BoonKey, why: string): Gen {
  say(g, { t: 'boon', seat: p.seat, key, why }, 3.5);
  if (key === 'phoenix') {
    if (!heal(g, p, 'phoenix')) p.boons.push('phoenix');
  } else if (key === 'airavata' || key === 'fleece') p.guardTurn = p.turns + 1;
  else if (key === 'kamadhenu') {
    const a = yield* ask({ k: 'wish', seat: p.seat }, 'wish');
    const pick = a?.pick ?? (p.hearts < TUNE.hearts ? 'heart' : 'creature');
    if (pick === 'heart' && heal(g, p, 'kamadhenu')) return;
    if (pick !== 'rest') {
      const w = g.board[p.at]!.world ?? pickOne(g, WORLDS);
      const best = [...g.bag[w]].sort((x, y) => rank(y) - rank(x))[0];
      if (best) {
        takeFromBag(g, best);
        yield* gain(g, p, best, 'boon');
        return;
      }
    }
    for (const o of p.deck) o.tired = false;
    p.nextDraw = 1;
  } else if (key === 'sanjeevani') {
    if (p.lastLost) yield* gain(g, p, p.lastLost, 'boon');
    p.lastLost = null;
    for (const o of p.deck) o.tired = false;
  } else if (key === 'patra' || key === 'purse') p.bonusDraws = 3;
  else if (key === 'garuda' || key === 'boots' || key === 'vimana') {
    const options = open(g)
      .filter((s) =>
        key === 'vimana' ? s.ring === 'inner' : true,
      )
      .map((s) => s.id);
    // v15: a flight lands where the wind takes it (never a place you name: the die must always matter).
    const to = options.length ? pickOne(g, options) : undefined;
    if (to !== undefined) {
      say(g, { t: 'portal', seat: p.seat, from: p.at, to, why: key }, 3);
      p.at = to;
      p.from = null;
      g.board[to]!.seen = true;
    }
  } else if (key === 'kalpavriksha') {
    g.sheltered.push({ at: p.at, until: g.round + 2, tree: true });
    say(g, { t: 'tree', seat: p.seat, at: p.at }, 2.5);
  } else if (key === 'stone') {
    yield* gain(g, p, drawRare(g), 'boon');
  } else p.boons.push(key);
}

// ── Wild teams ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A wild team of this world (rarely a neighbour joins), sized and powered by how far the match has gone. */
function makeTeam(g: Game, world: WorldId, size = g.round < TUNE.smallTeamsUntil ? 2 : 3): string[] {
  const cap = Math.round(TUNE.powerCap.base + TUNE.powerCap.slope * progress(g));
  const team: string[] = [];
  const near = g.petals[(g.petals.indexOf(world) + 1) % 8]!;
  for (let i = 0; i < size; i++) {
    const w = i === 2 && rand(g) < 0.3 ? near : world;
    if (!g.bag[w].length)
      g.bag[w] = shuffled(
        g,
        CREATURES.filter((c) => c.world === w && !team.includes(c.id)).map((c) => c.id),
      );
    const bag = g.bag[w];
    const roll = rand(g);
    const want =
      roll < TUNE.legendaryChance
        ? 'legendary'
        : roll < TUNE.legendaryChance + TUNE.rareChance
          ? 'rare'
          : null;
    const plain = (id: string) => creature(id).rarity !== 'legendary' && creature(id).rarity !== 'rare';
    const pick =
      (want && bag.find((id) => creature(id).rarity === want)) ||
      bag.find((id) => plain(id) && creature(id).power <= cap) ||
      bag.find((id) => creature(id).rarity !== 'legendary') ||
      bag[0]!;
    takeFromBag(g, pick);
    team.push(pick);
  }
  return team;
}

// ── The clash ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * v15 THE CHASE (owner, 2026-11-04: "strays… creatures collect karne ki zarurat hi nahi rahegi… sirf 0 creatures fix karo, 1 v 1,
 * 2 v 2 theek the"). A fight is as wide as your ready hand. With none at all there is no fight and no free heart either: you RUN,
 * one die in front of everyone. 4 or more: you get away. 1 to 3: caught, and a heart goes.
 */
function* chase(g: Game, p: Player, from: string, by: number | null, need = 4, last = false): Gen<'lose' | 'standoff'> {
  const roll = 1 + Math.floor(rand(g) * 6);
  const free = roll >= need;
  // At the last fire there is nowhere left to run to: one run around the flames, and the one who misses goes in.
  const text = last
    ? `[[${p.seat}]] has no creature at the last fire and must outrun ${from}. ${need} or more: ${from} loses the meeting. [[${p.seat}]] rolls ${roll}.`
    : `[[${p.seat}]] has no creature to fight with and runs from ${from}. ${need} or more to get away: [[${p.seat}]] rolls ${roll}.`;
  say(g, { t: 'moment', seat: p.seat, kicker: last ? 'THE LAST CHASE' : 'THE CHASE', title: free ? 'ESCAPED!' : 'CAUGHT', text, tone: free ? 'gold' : 'bad', dice: [roll] }, 3);
  if (last) return free ? 'standoff' : 'lose';
  if (!free) loseHeart(g, p, by !== null ? 'player' : 'creature', by);
  yield* settle(g, p.seat, free ? 'standoff' : 'lose');
  return free ? 'standoff' : 'lose';
}
function drawHand(g: Game, p: Player, all = false): Owned[] {
  const ready = p.deck.filter((o) => !o.tired && !(o.uid === p.sleeper && g.round % 2 === 1));
  if (all) return ready;
  return shuffled(g, ready).slice(0, TUNE.draw);
}
const lanesOf = (n: number) => [0, 1, 2].slice(0, n);
/**
 * v13 TWISTS: in each lane, by pure luck (TUNE.twistChance), something happens to one side or the other, 50/50: a gust, mud, the
 * crowd. Never aimed: the side, the sign and the size are drawn blind, before anyone knows who is ahead.
 */
const TWIST_UP = ['A GUST', 'A LUCKY STEP', 'THE CROWD ROARS', 'SECOND WIND', 'MOONLIGHT', 'A WAR CRY', 'HIGH GROUND'];
const TWIST_DOWN = ['MUD', 'A STUMBLE', 'SUN IN THE EYES', 'A CRAMP', 'A LOOSE STONE', 'SLIPPERY MOSS', 'A WASP'];
function twistsFor(g: Game): ({ side: Side; v: number; text: string } | null)[] {
  return [0, 1, 2].map(() => {
    if (rand(g) >= TUNE.twistChance) return null;
    const side: Side = rand(g) < 0.5 ? 'me' : 'foe';
    const up = rand(g) < 0.6;
    const v = Math.round(TUNE.twistLo + rand(g) * (TUNE.twistHi - TUNE.twistLo));
    return { side, v: up ? v : -v, text: pickOne(g, up ? TWIST_UP : TWIST_DOWN) };
  });
}
/**
 * The wild side's call for one card. v12 (owner: "game ke paas dimaag na ho… wo randomly ho"): a blind draw, every stat equally
 * likely, decided without looking at either card. It is drawn before the reveal and shown as a draw.
 */
function wildCall(g: Game, cid: string): Stat {
  // v15: blind (it never looks at your card), but a beast fights with what it has: one of its own best TUNE.wildTop stats.
  const st = wildFighter(cid).stats;
  const top = [...STATS].sort((a, b) => st[b] - st[a]).slice(0, TUNE.wildTop);
  return pickOne(g, top);
}
function orderOf(p: Player, hand: Owned[], ids: number[], size = 3): (Owned | null)[] {
  const pick: Owned[] = [];
  for (const u of ids) {
    const o = hand.find((x) => x.uid === u);
    if (o && !pick.includes(o)) pick.push(o);
  }
  for (const o of [...hand].sort((a, b) => power(b) - power(a)))
    if (pick.length < size && !pick.includes(o)) pick.push(o);
  const team: (Owned | null)[] = pick.slice(0, size);
  // Leads With His Best: the strongest picked creature stands in lane 1.
  if (p.hero.weak === 'leadsBest' && pick.length) {
    const s = strongest(pick.slice(0, 3));
    team.splice(team.indexOf(s), 1);
    team.unshift(s);
  }
  while (team.length < 3) team.push(null);
  return team;
}
/** v9: no heart bet inside battles (bets live on chance cards). */
const canBet = (p: Player) => (void p, false);
const fireOf = (team: (Owned | null)[], f: Fire | null | undefined, side: Side): Fired | null => {
  const o = f ? team[f.lane] : null;
  if (!f || !o) return null;
  const moves = fighter(o).moves;
  return {
    side,
    lane: f.lane,
    move: f.move && moves.includes(f.move) ? f.move : moves[0]!,
    target: Math.max(0, Math.min(2, f.target)),
  };
};
/** A wild team's special (pure random, owner R3): a random member fires at a random lane, two times in three. */
function wildFire(g: Game, theirs: (Fighter | null)[]): Fired | null {
  const lanes = theirs.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  if (!lanes.length || rand(g) < 0.34) return null;
  const lane = pickOne(g, lanes);
  return { side: 'foe', lane, move: theirs[lane]!.moves[0]!, target: Math.floor(rand(g) * 3) };
}
const view = (r: ClashResult): LaneView[] =>
  r.lanes.map((l) => ({
    stat: l.stat,
    stat2: l.stat2,
    me: l.me?.id ?? null,
    foe: l.foe?.id ?? null,
    mine: l.mine,
    theirs: l.theirs,
    chips: l.chips,
    cause: l.cause,
    res: l.res,
    idle: l.idle,
  }));
/**
 * v16 GROWTH (owner: "cards collect karun, kho sakun, enhance karun… mehnat ki hai, chala gaya toh"): every lane a creature wins
 * for you is remembered. Two: it ASCENDS (+TUNE.ascendLift to every number). Four: it is EXALTED (the same again). The more a
 * creature has carried you, the more it hurts to lose it: the wild and your rivals go for the proud ones first.
 */
function evolve(g: Game, p: Player, team: (Owned | null)[], r: ClashResult, side: Side): void {
  const mine = side === 'me' ? r.mine : r.theirs;
  r.lanes.forEach((l, i) => {
    const o = team.find((x) => x && x.cid === mine[i]?.id) ?? null;
    if (o && l.res === side && !l.idle && p.deck.includes(o)) o.wins++;
  });
  for (const o of team) {
    if (!o || !p.deck.includes(o)) continue;
    if (!o.ascended && o.wins >= TUNE.ascendWins) {
      o.ascended = true;
      say(g, { t: 'ascend', seat: p.seat, cid: o.cid, tier: 1 }, 2.5);
    } else if (o.ascended && !o.exalted && o.wins >= TUNE.exaltWins) {
      o.exalted = true;
      say(g, { t: 'ascend', seat: p.seat, cid: o.cid, tier: 2 }, 2.5);
    }
  }
}

/** A clash between a player and a wild team on space `at`. */
function* clashWild(
  g: Game,
  p: Player,
  team: string[],
  at: number,
  source: Source,
  by: number | null,
): Gen<'win' | 'lose' | 'standoff'> {
  const law = lawAt(g, at);
  // v10 (owner: "creatures 3 se kam reh jayein toh 2 v 2 ya 1 v 1"; v15: "1 v 1, 2 v 2 toh theek the"): as wide as your ready hand.
  const hand = drawHand(g, p);
  const size = Math.min(3, hand.length, team.length);
  if (size === 0) {
    if (p.deck.length) {
      news(g, `[[${p.seat}]]'s creatures are all too tired to fight. The beasts sniff, and pass by.`, p.seat);
      yield* settle(g, p.seat, 'standoff');
      return 'standoff';
    }
    return yield* chase(g, p, source === 'boss' ? 'the beast' : source === 'hunter' ? 'the hunting pack' : 'the wild', by);
  }
  if (team.length > size) team = source === 'boss' ? [team[0]!, ...shuffled(g, team.slice(1)).slice(0, size - 1)] : shuffled(g, team).slice(0, size);
  say(g, { t: 'emerge', seat: p.seat, at, team, source, by, law }, sec('emerge'));
  const faces: (string | null)[] = [...team, null, null, null].slice(0, 3);
  const order: (string | null)[] = [...shuffled(g, team), null, null, null].slice(0, 3);
  // One honest tell per wild team ("the Kraken always strikes first"); the Mirror Pool shows lane 1 too.
  const filled = order.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  // v9: no free tell; their order stays hidden (only the Mirror Pool, a rare boon, shows lane 1).
  const tellLanes = new Set<number>();
  void filled;
  if (p.peek && order[0]) tellLanes.add(0);
  p.peek = false;
  const tells = [...tellLanes].sort().map((lane) => ({ lane, cid: order[lane]! }));
  if (tells.length) say(g, { t: 'tell', seat: p.seat, tells }, sec('tell'));
  const bet0 = canBet(p);
  const a = yield* ask(
    {
      k: 'team',
      seat: p.seat,
      drawn: hand,
      faces,
      // v10 (owner: "saamne kya aane wala hai chupa ke hi rakho… zero idea"): nothing of the other side shows before the reveal.
      dark: true,
      tells,
      canBet: bet0,
      secret: false,
      vs: null,
      law,
      leadBest: p.hero.weak === 'leadsBest',
      calls: lanesOf(size),
      size,
    },
    'team',
  );
  const mine = orderOf(p, hand, a?.order ?? [], size);
  const calls = merge(callsOf(mine, a?.calls, lanesOf(size)), []);
  const bet = bet0 && !!a?.bet;
  if (bet) p.betUsed = true;
  say(g, { t: 'team', seat: p.seat, uids: mine.filter((o): o is Owned => !!o).map((o) => o.uid), bet }, 1);
  const theirs = order.map((c) => (c ? wildFighter(c) : null));
  const foeCalls = order.map((c) => (c ? wildCall(g, c) : null));
  say(g, { t: 'wildDraw', seat: p.seat, calls: foeCalls }, 1.5);
  say(g, { t: 'orders', seat: p.seat, vs: null, mine: mine.map((o) => o?.cid ?? ''), theirs: order, calls, foeCalls }, sec('orders'));
  const fired: Fired[] = [];
  // v9: no special moves in battles.
  const wf = null as Fired | null;
  void wildFire;
  const sayFire = (f: Fired, seat: number | null, byCid: string, free: boolean, secs = sec('fired')) => {
    fired.push(f);
    say(
      g,
      { t: 'fired', side: f.side, seat, move: f.move, lane: f.lane, target: f.target, by: byCid, free },
      secs,
    );
  };
  // The Jungle Cheats: the wild team fires after you. Everywhere else it fires first, and you answer.
  if (wf && law !== 'jungleCheats') sayFire(wf, null, order[wf.lane]!, false);
  const free = mine.map((o, i) => (o?.ascended ? i : -1)).filter((i) => i >= 0);
  const bench: Owned[] = [];
  const m = null as Extract<Answer, { k: 'move' }> | null;
  if (m?.bench && bench.length) {
    const inc = bench.find((o) => o.uid === m.bench!.uid) ?? bench[0]!;
    const lane = Math.max(0, Math.min(2, m.bench.lane));
    say(g, { t: 'bench', seat: p.seat, lane, out: mine[lane]?.cid ?? '', in: inc.cid }, 3);
    mine[lane] = inc;
  } else {
    const f = fireOf(mine, m?.fire, 'me');
    if (f) sayFire(f, p.seat, mine[f.lane]!.cid, false);
  }
  for (const ff of m?.free ?? []) {
    if (!free.includes(ff.lane) || (m?.fire && m.fire.lane === ff.lane)) continue;
    const f = fireOf(mine, ff, 'me');
    if (f) sayFire(f, p.seat, mine[f.lane]!.cid, true);
  }
  if (wf && law === 'jungleCheats') sayFire(wf, null, order[wf.lane]!, false);
  const r = resolve(
    mine.map((o) => (o ? fighter(o) : null)),
    theirs,
    fired,
    {
      law,
      ties: law === 'homeSoil' ? 'foe' : null,
      mirror: false,
      calls,
      foeCalls,
      // v15 (owner: "ferocity… felt like it only rewards the wild… annoying"): no fury for one side. The only luck in a lane is a
      // twist, which falls on either side by pure chance.
      twists: twistsFor(g),
    },
  );
  let outcome = r.outcome;
  const crowd = false;
  if (crowd) outcome = 'win';
  // Brahmastra: once, against the world only, a lost clash is undone.
  if (outcome === 'lose' && source !== 'tame' && useBoon(g, p, 'brahmastra')) outcome = 'standoff';
  say(g, { t: 'clash', seat: p.seat, vs: null, at, law, lanes: view(r), outcome, crowd }, sec('clash'));
  evolve(g, p, mine, r, 'me');
  const team3 = mine.filter((o): o is Owned => !!o);
  if (outcome === 'win') {
    const pool = source === 'boss' ? team.slice(1) : [...team];
    const prizes = pool.sort((x, y) => rank(y) - rank(x)).slice(0, law === 'plunder' || g.blood ? 2 : 1);
    for (const cid of prizes) yield* gain(g, p, cid, 'clash');
    for (const li of r.snatched) {
      const cid = r.theirs[li]?.id;
      if (cid && !prizes.includes(cid) && !(source === 'boss' && cid === team[0])) yield* gain(g, p, cid, 'snatch');
    }
  } else if (outcome === 'lose') {
    const losers = team3.filter((o) => r.lanes.some((l, i) => r.mine[i]?.id === o.cid && l.res === 'foe'));
    // Pride before the fall: if a proud (ascended) creature lost its lane, it is the one that falls.
    const proud = losers.some((o) => o.ascended) || p.hero.weak === 'showOff';
    const pride = losers.filter((o) => o.ascended);
    const had = loseCreature(g, p, source === 'tame' ? 'fled' : 'clash', proud ? 'strongest' : 'weakest', pride.length ? pride : losers);
    // A heavy loss (two lanes or more lost — owner G2) or bare hands also costs a heart (a lone beast only scares yours off).
    if (source !== 'tame' && (!had || g.blood || r.lost >= TUNE.heartAtLanes)) loseHeart(g, p, 'creature', by, team[0]);
  }
  if (bet) {
    const won = outcome === 'win';
    say(g, { t: 'bet', seat: p.seat, won }, 3);
    if (won) yield* giveBoon(g, p, wonder(g), 'bet');
    else loseHeart(g, p, 'bet', null);
  }
  if (outcome === 'win' && p.hero.weak === 'victoryNap') p.nap = true;
  g.lastWon = r.won;
  yield* settle(g, p.seat, outcome);
  return outcome;
}

/** A clash between two players: both set order and special behind the cover (the one secret screen). */
function* clashPlayers(
  g: Game,
  p: Player,
  q: Player,
  at: number,
  mode: 'normal' | 'parrot' | 'final' = 'normal',
): Gen<'win' | 'lose' | 'standoff'> {
  const law = mode === 'final' ? null : lawAt(g, at);
  // At the last fire every creature fights, tired or not (nobody runs from a finale with creatures in hand).
  const hands = new Map([p, q].map((x) => [x, mode === 'final' ? [...x.deck] : drawHand(g, x)]));
  const size = Math.min(3, hands.get(p)!.length, hands.get(q)!.length);
  if (size === 0) {
    // Creatures too tired to fight are not empty hands: the meeting passes.
    if ((!hands.get(p)!.length && p.deck.length) || (!hands.get(q)!.length && q.deck.length)) {
      news(g, `[[${p.seat}]] and [[${q.seat}]] meet, but tired creatures will not fight. They part.`, p.seat);
      yield* settle(g, p.seat, 'standoff');
      yield* settle(g, q.seat, 'standoff');
      return 'standoff';
    }
    // v15 THE CHASE: whoever has nothing at all runs from the other (both empty-handed: they glare, and part).
    const bareP = !hands.get(p)!.length;
    const bareQ = !hands.get(q)!.length;
    if (bareP && bareQ) {
      news(g, `[[${p.seat}]] and [[${q.seat}]] meet with empty hands. They glare, and part.`, p.seat);
      yield* settle(g, p.seat, 'standoff');
      yield* settle(g, q.seat, 'standoff');
      return 'standoff';
    }
    const [runner, hunter] = bareP ? [p, q] : [q, p];
    if (mode === 'final') {
      // The finale needs a loser: the runner escapes on a 5 or 6 and the hunter loses the meeting; otherwise the runner does.
      const out = yield* chase(g, runner, `[[${hunter.seat}]]`, hunter.seat, 5, true);
      const runnerWon = out === 'standoff';
      // Like any lost duel: the loser of the meeting pays a heart (the sudden death that may follow takes the rest).
      loseHeart(g, runnerWon ? hunter : runner, g.dimmed ? 'suddenDeath' : 'player', runnerWon ? runner.seat : hunter.seat);
      yield* settle(g, runner.seat, runnerWon ? 'win' : 'lose');
      yield* settle(g, hunter.seat, runnerWon ? 'lose' : 'win');
      return runnerWon === (runner === p) ? 'win' : 'lose';
    }
    const out = yield* chase(g, runner, `[[${hunter.seat}]]`, hunter.seat);
    // Chasing the empty-handed is never free: if they get away, they snatch the hunter's weakest creature as they run.
    if (out === 'standoff' && hunter.deck.length && !runner.out) {
      news(g, `[[${runner.seat}]] slips away, and snatches a creature from [[${hunter.seat}]] on the way.`, runner.seat, 'gold');
      yield* handOver(g, hunter, runner, weakest(hunter.deck), 'stolen');
    }
    yield* settle(g, hunter.seat, out === 'lose' ? 'win' : 'standoff', false);
    return out === 'standoff' ? 'standoff' : runner === p ? 'lose' : 'win';
  }
  say(g, { t: 'emerge', seat: p.seat, at, team: [], source: 'rival', by: q.seat, law }, 3);
  const pickTeam = function* (
    x: Player,
    vs: Player,
    callLanes: number[],
  ): Gen<{ team: (Owned | null)[]; bet: boolean; fire: Fire | null; calls: (Stat | null)[] }> {
    const hand = hands.get(x)!;
    const b0 = canBet(x) && mode !== 'parrot';
    const a = yield* ask(
      {
        k: 'team',
        seat: x.seat,
        drawn: hand,
        faces: null,
        dark: false,
        tells: [],
        canBet: b0,
        secret: true,
        vs: vs.seat,
        law,
        leadBest: x.hero.weak === 'leadsBest',
        calls: callLanes,
        size,
      },
      'team',
    );
    const team = orderOf(x, hand, a?.order ?? [], size);
    const calls = callsOf(team, a?.calls, callLanes);
    const bet = b0 && !!a?.bet;
    if (bet) x.betUsed = true;
    return { team, bet, fire: a?.fire ?? null, calls };
  };
  // v10: each player calls a stat for every one of their own lanes; in each lane both calls count for both cards.
  const A = yield* pickTeam(p, q, lanesOf(size));
  const B = yield* pickTeam(q, p, lanesOf(size));
  const calls = merge(A.calls, []);
  const foeCalls = B.calls;
  say(
    g,
    {
      t: 'orders',
      seat: p.seat,
      vs: q.seat,
      mine: A.team.map((o) => o?.cid ?? ''),
      theirs: B.team.map((o) => o?.cid ?? null),
      calls,
      foeCalls,
    },
    4,
  );
  const fired: Fired[] = [];
  for (const [side, x, s] of [
    ['foe', q, B],
    ['me', p, A],
  ] as const) {
    const f = null as Fired | null;
    void fireOf;
    if (f) {
      fired.push(f);
      say(
        g,
        {
          t: 'fired',
          side,
          seat: x.seat,
          move: f.move,
          lane: f.lane,
          target: f.target,
          by: s.team[f.lane]!.cid,
          free: false,
        },
        3,
      );
    }
  }
  const r = resolve(
    A.team.map((o) => (o ? fighter(o) : null)),
    B.team.map((o) => (o ? fighter(o) : null)),
    fired,
    { law, ties: law === 'homeSoil' ? 'foe' : null, mirror: false, calls, foeCalls, twists: twistsFor(g) },
  );
  say(
    g,
    { t: 'clash', seat: p.seat, vs: q.seat, at, law, lanes: view(r), outcome: r.outcome, crowd: false },
    sec('clash') + 1,
  );
  evolve(g, p, A.team, r, 'me');
  evolve(g, q, B.team, r, 'foe');
  if (r.outcome === 'standoff') {
    yield* settle(g, p.seat, 'standoff');
    yield* settle(g, q.seat, 'standoff');
    return 'standoff';
  }
  const [w, l, lt] = r.outcome === 'win' ? [p, q, B] : [q, p, A];
  if (mode !== 'parrot') loseHeart(g, l, mode === 'final' && g.dimmed ? 'suddenDeath' : 'player', w.seat);
  // The winner takes one of the loser's three (two under Winner Plunders or a sworn oath); a relic instead for the Captain.
  {
    const sworn = g.oaths.some(([a, b]) => (a === p.seat && b === q.seat) || (a === q.seat && b === p.seat));
    const pair = (v: { by: number; on: number }) => (v.by === p.seat && v.on === q.seat) || (v.by === q.seat && v.on === p.seat);
    const feud = g.vendettas.some(pair);
    if (feud) {
      g.vendettas = g.vendettas.filter((v) => !pair(v));
      news(g, `Vengeance is settled. [[${w.seat}]] takes two.`, w.seat, 'gold', 2.5);
    }
    // v15: the Snake-Oil Salesman's weakness (Wanted) is real: beat them in a duel and you take two.
    const n = law === 'plunder' || sworn || feud || g.blood || l.hero.weak === 'wanted' ? 2 : 1;
    const pool =
      l.hero.weak === 'labels' ? [...l.deck] : lt.team.filter((o): o is Owned => !!o && l.deck.includes(o));
    // v16: the proud (ascended) are taken first, then the strongest.
    for (const o of pool.sort((x, y) => Number(!!y.ascended) - Number(!!x.ascended) || power(y) - power(x)).slice(0, n)) {
      if (l.guardTurn >= l.turns) {
        say(g, { t: 'guarded', seat: l.seat, cid: o.cid }, 2);
        continue;
      }
      l.deck = l.deck.filter((x) => x !== o);
      l.lastLost = o.cid;
      say(g, { t: 'lost', seat: l.seat, cid: o.cid, why: 'stolen' }, 1.5);
      w.deck.push({ ...o, tired: false });
      say(g, { t: 'capture', seat: w.seat, cid: o.cid, why: 'steal' }, 2);
      yield* settleHold(g, w);
    }
  }
  // WANTED: whoever beats the hunted in a duel claims the price (a heart; a rare creature if they are whole).
  const price = g.bounties.find((b) => b.on === l.seat && b.by !== w.seat);
  if (price) {
    g.bounties = g.bounties.filter((b) => b !== price);
    say(g, { t: 'bounty', on: l.seat, by: price.by, claimed: w.seat }, 2.5);
    if (!heal(g, w, 'chance')) yield* gain(g, w, drawRare(g), 'wager');
  }
  if (w.hero.weak === 'victoryNap') w.nap = true;
  for (const [x, s, won] of [
    [p, A, r.outcome === 'win'],
    [q, B, r.outcome === 'lose'],
  ] as const)
    if (s.bet) {
      say(g, { t: 'bet', seat: x.seat, won }, 3);
      if (won) yield* giveBoon(g, x, wonder(g), 'bet');
      else loseHeart(g, x, 'bet', null);
    }
  yield* settle(g, p.seat, r.outcome);
  yield* settle(g, q.seat, r.outcome === 'win' ? 'lose' : 'win');
  return r.outcome;
}

// ── Landing ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Change what a place holds; if anyone has seen it, the map is told (a beat), so the screen never keeps a stale marker. */
function setContent(g: Game, s: Space, c: Content): void {
  // v16: anything but an empty place, set by an event, is kept for whoever lands next (the landing draw respects it).
  s.fixed = c !== 'empty';
  if (s.content === c) return;
  s.content = c;
  if (s.seen) say(g, { t: 'content', at: s.id, content: c }, 0.3);
}
/**
 * v10 (owner: "har block unpredictable, kuch na pata ho kahaan land karke kya hoga"): no place shows what it holds until a hero
 * stands on it, and once it has played out it is dealt again, in secret, from the whole pool. No spot can be learned or farmed.
 */
function* land(g: Game, p: Player): Gen {
  const at = p.at;
  yield* landHere(g, p);
  const s = g.board[at]!;
  if (s.id !== CENTRE && !s.void && s.world && !g.lairs[s.id]) s.content = pickOne(g, [...TUNE.contentsCore, ...TUNE.contentsPool]) as Content;
}
function* landHere(g: Game, p: Player): Gen {
  const s = g.board[p.at]!;
  s.seen = true;
  // The fog (owner Q18, "hidden until near"): what lies one road away from where you stop is revealed.
  const near = s.adj.filter((x) => !g.board[x]!.seen && !g.board[x]!.void && x !== CENTRE);
  if (near.length) {
    for (const x of near) g.board[x]!.seen = true;
    say(g, { t: 'reveal', spaces: near, for: p.seat }, 0.6);
  }
  // The wandering shrine: once per match, by pure luck.
  if (!g.shrineUsed && g.shrine === p.at) {
    g.shrineUsed = true;
    g.shrine = null;
    const full = p.hearts >= TUNE.hearts;
    say(g, { t: 'shrine', seat: p.seat, at: p.at, gain: full ? 'boon' : 'heart' }, 5);
    if (full) yield* giveBoon(g, p, sacred(g, 1)[0]!, 'shrine');
    else heal(g, p, 'shrine');
  }
  if (p.at === CENTRE) {
    // v10: the Burning Heart joins every land to every other: stop in it and it throws you somewhere random (v15).
    say(g, { t: 'land', seat: p.seat, at: p.at, content: 'gate' }, 2);
    if (g.depth > 1) {
      news(g, 'The fire is tired of throwing you. It lets you rest.', p.seat);
      return;
    }
    const options = open(g).filter((x) => x.id !== CENTRE && x.world).map((x) => x.id);
    // (When every land has been eaten there is nowhere left to throw anyone: the fire holds you.)
    if (!options.length) {
      news(g, 'Every land is gone. The fire has nowhere left to throw you, and holds you close.', p.seat);
      return;
    }
    // v15 (owner: "teleport kidhar bhi… loophole… game randomly choose kare… bahut galat jagah pe thro kar de"): the fire throws
    // you somewhere it chooses, blind: a safe land, or ground that is already falling. A gamble, never a free ride.
    const to = pickOne(g, options);
    say(g, { t: 'portal', seat: p.seat, from: p.at, to, why: 'heart' }, 2.5);
    p.at = to;
    p.from = null;
    g.depth++;
    yield* land(g, p);
    g.depth--;
    return;
  }
  // The Last Stand: a trap the fallen laid springs.
  const trap = g.stand && g.stand.seat === p.seat ? g.traps.find((t) => t.at === p.at) : undefined;
  if (trap) {
    g.traps = g.traps.filter((t) => t !== trap);
    say(g, { t: 'trapSprung', by: trap.by, at: p.at, seat: p.seat }, 2.5);
    yield* clashWild(g, p, makeTeam(g, s.world ?? pickOne(g, g.petals)), p.at, 'trap', trap.by);
    return;
  }
  if (treeAt(g, p.at)) {
    say(g, { t: 'land', seat: p.seat, at: p.at, content: 'shelter' }, 2);
    return;
  }
  const friend = fair(g, alive(g)).find((q) => q !== p && q.at === p.at);
  if (friend) {
    say(g, { t: 'land', seat: p.seat, at: p.at, content: 'friend' }, 2);
    if (sworn(g, p, friend)) yield* allyMeet(g, p, friend);
    else yield* clashPlayers(g, p, friend, p.at);
    return;
  }
  // You walked into the beasts that hunt someone: they turn on you.
  const met = g.hunters.find((h) => h.at === p.at);
  if (met) {
    yield* caught(g, met, p);
    return;
  }
  if (g.boss && g.boss.at === p.at) {
    yield* bossFight(g, p);
    return;
  }
  // The Show Must Go On: end next to the Ringmaster and you may pull him into the ring instead of landing.
  const ring = alive(g).find(
    (q) => q !== p && q.hero.weak === 'showGoesOn' && g.board[q.at]!.adj.includes(p.at),
  );
  if (ring) {
    const a = yield* ask({ k: 'pull', seat: p.seat, ringmaster: ring.seat }, 'yes');
    if (a?.yes) {
      yield* clashPlayers(g, p, ring, p.at);
      return;
    }
  }
  // v15 (owner: "fog hat jati to pata lag jata hai kahan pe kya hai… outsmart… purely random… koi engine nahi"): what a place
  // holds is drawn the moment someone stands on it, blind, from the whole pool. Nothing on the map can be learned or farmed.
  // (A star-fall cache, a rumoured lair, a refilled place in the Last Stand: an event put it there, and it stays for this landing.)
  if (s.world && TUNE.contentsPool.length && !s.fixed) {
    const kind = pickOne(g, TUNE.contentsPool) as Content;
    if (kind !== 'lair') delete g.lairs[s.id];
    s.content = kind;
  }
  s.fixed = false;
  say(g, { t: 'land', seat: p.seat, at: p.at, content: s.content }, sec('land'));
  if (s.content === 'lair') {
    const team = (g.lairs[s.id] ??= makeTeam(g, s.world!));
    const out = yield* clashWild(g, p, team, s.id, 'lair', null);
    if (out === 'win') {
      delete g.lairs[s.id];
      setContent(g, s, 'empty');
    } else if (!p.out && g.hunters.length < TUNE.huntersMax) {
      // Beaten back but not beaten: the beasts break out of their lair and come after you.
      delete g.lairs[s.id];
      setContent(g, s, 'empty');
      loose(g, team, s.id, p, 'loose');
    }
  } else if (s.content === 'disaster') yield* disaster(g, p, s.world!);
  else if (s.content === 'riddle' && rand(g) < TUNE.encounterShare) yield* encounter(g, p, s);
  else if (s.content === 'riddle') {
    const pool = RIDDLES.filter((r) => r.world === s.world || r.world === 'any');
    const r = pickOne(g, pool.length ? pool : RIDDLES);
    const random = p.hero.weak === 'riddlesBore';
    const a = random ? null : yield* ask({ k: 'riddle', seat: p.seat, riddle: r }, 'riddle');
    const pick = random ? (rand(g) < 0.5 ? 'a' : 'b') : (a?.pick ?? 'b');
    say(g, { t: 'riddle', seat: p.seat, riddle: r, pick, random }, sec('riddle'));
    yield* riddleFx(g, p, pick === 'a' ? r.fa : r.fb, s);
  } else if (s.content === 'cache') yield* cache(g, p, s);
  else if (s.content === 'nest') {
    // The Wild Nest (owner: "kisi kisi place pe mauka mile to gain creatures, rarely, pure luck"): roll a die.
    // A 6: something hatches and follows you. A 1: the mother is home, and she bites. Anything else: an empty nest.
    const roll = 1 + Math.floor(rand(g) * 6);
    say(g, { t: 'nest', seat: p.seat, roll }, sec('nest'));
    if (roll === 6) yield* gain(g, p, makeTeam(g, s.world ?? pickOne(g, g.petals), 1)[0]!, 'nest');
    else if (roll === 1) loseCreature(g, p, 'trial');
  } else if (s.content === 'empty') yield* drawChance(g, p);
  else if (s.content === 'hilo') yield* hilo(g, p, s);
  else if (s.content === 'tame') {
    const beast = makeTeam(g, s.world ?? pickOne(g, g.petals), 1);
    yield* clashWild(g, p, beast, s.id, 'tame', null);
    setContent(g, s, 'empty');
  } else if (s.content === 'altar') yield* altar(g, p, s);
  else if (s.content === 'golden') {
    p.golden = 'held';
    say(g, { t: 'golden', seat: p.seat }, 3);
    yield* playGolden(g, p);
  } else if (s.content === 'wheel') yield* wheel(g, p);
  else if (s.content === 'cave') yield* cave(g, p, s);
  else if (s.content === 'gauntlet') yield* gauntlet(g, p, s);
  else if (s.content === 'trust') yield* trust(g, p, s);
  else if (s.content === 'ring') yield* challengeRing(g, p, s);
  else if (s.content === 'pier') yield* pier(g, p, s);
  else if (s.content === 'shrine') yield* shrine(g, p);
  else if (s.content === 'oathStone') yield* oathStone(g, p);
  else if (s.content === 'trader') yield* trader(g, p, s);
}

const sworn = (g: Game, p: Player, q: Player) => g.allies.some(([a, b]) => (a === p.seat && b === q.seat) || (a === q.seat && b === p.seat));
/** Turning on your sworn ally (the Ring, the Whistle) breaks the oath, out loud, before the blow lands. */
function breakOath(g: Game, p: Player, q: Player): void {
  if (!sworn(g, p, q)) return;
  g.allies = g.allies.filter(([a, b]) => !((a === p.seat && b === q.seat) || (a === q.seat && b === p.seat)));
  say(g, { t: 'allies', pairs: g.allies.map(([a, b]) => [a, b] as [number, number]) }, 0.2);
  say(g, { t: 'moment', seat: p.seat, kicker: 'THE OATH STONE', title: 'THE OATH IS BROKEN', text: `[[${p.seat}]] turns on their own ally, [[${q.seat}]]. The stone cracks.`, tone: 'bad' }, 2.5);
}
const allyOf = (g: Game, p: Player): number | null => {
  const pair = g.allies.find(([a, b]) => (a === p.seat || b === p.seat) && !g.players[a === p.seat ? b : a]!.out);
  return pair ? (pair[0] === p.seat ? pair[1] : pair[0]) : null;
};
/**
 * v15 THE OATH STONE (research: Diplomacy, Cosmic Encounter, Cole Wehrle's "King Me": alliances and betrayal are the stories a
 * table retells; owner: "alliance bane… do bande ek teesre ko target karein… betrayal… baad mein regret"). Offer a rival an
 * alliance. Sworn allies share every battle won. When allies meet on one place, each chooses in secret: KEEP the oath or BETRAY.
 */
function* oathStone(g: Game, p: Player): Gen {
  const mine = allyOf(g, p);
  if (mine !== null) {
    news(g, `[[${p.seat}]] is already sworn to [[${mine}]]. The stone hums, and a card falls from it instead.`, p.seat);
    yield* drawChance(g, p);
    return;
  }
  const free = others(g, p).filter((x) => allyOf(g, x) === null);
  if (!free.length) {
    news(g, 'Everyone is already sworn to someone. The stone stays silent.', p.seat);
    return;
  }
  const a = yield* ask({ k: 'choice', seat: p.seat, title: 'The Oath Stone', sub: 'Offer a rival an alliance: while sworn, whenever one of you wins a battle, the other gains a creature too. If you ever meet, each chooses in secret: keep the oath, or betray. Or walk away.', options: ['Offer an oath', 'Walk away'], def: 1 }, 'pick');
  if (a?.i !== 0) return;
  const q = (yield* askTarget(g, p, 'ally', seatsOf(free))) ?? pickOne(g, free);
  const b = yield* ask({ k: 'choice', seat: q.seat, title: 'The Oath Stone', sub: `[[${p.seat}]] offers you an alliance. Accept, and you share every battle won, until one of you betrays the other.`, options: ['Swear the oath', 'Refuse'], def: Math.floor(rand(g) * 2) }, 'pick');
  if (b?.i !== 0) {
    say(g, { t: 'moment', seat: q.seat, kicker: 'THE OATH STONE', title: 'REFUSED', text: `[[${q.seat}]] looks at the offered hand of [[${p.seat}]], and walks past it.`, tone: 'bad' }, 2.5);
    return;
  }
  g.allies.push([p.seat, q.seat]);
  say(g, { t: 'allies', pairs: g.allies.map(([a, b]) => [a, b] as [number, number]) }, 0.2);
  say(g, { t: 'moment', seat: p.seat, kicker: 'THE OATH STONE', title: 'SWORN', text: `[[${p.seat}]] and [[${q.seat}]] press their palms to the stone. Allies, for now.`, tone: 'gold' }, 2.5);
}
/** Two sworn allies on one place: each chooses behind the cover, KEEP or BETRAY. */
function* allyMeet(g: Game, p: Player, q: Player): Gen {
  const pick = function* (x: Player, y: Player) {
    const a = yield* ask({ k: 'choice', seat: x.seat, title: 'The Oath Stone', sub: `You and your ally [[${y.seat}]] stand on one place. Keep the oath (if you both keep it, nothing happens), or betray them: a lone traitor takes their top creature, and they lose a heart. If you both betray, you duel.`, options: ['Keep the oath', 'Betray'], def: 0, secret: true }, 'pick');
    return a?.i === 1;
  };
  const bp = yield* pick(p, q);
  const bq = yield* pick(q, p);
  g.allies = g.allies.filter((pair) => !((pair[0] === p.seat && pair[1] === q.seat) || (pair[0] === q.seat && pair[1] === p.seat)));
  if (bp || bq) say(g, { t: 'allies', pairs: g.allies.map(([a, b]) => [a, b] as [number, number]) }, 0.2);
  if (!bp && !bq) {
    g.allies.push([p.seat, q.seat]);
    say(g, { t: 'moment', seat: p.seat, kicker: 'THE OATH STONE', title: 'THE OATH HOLDS', text: `[[${p.seat}]] and [[${q.seat}]] clasp hands. Both kept their word. For now.`, tone: 'gold' }, 2.5);
    return;
  }
  if (bp && bq) {
    say(g, { t: 'moment', seat: p.seat, kicker: 'THE OATH STONE', title: 'BOTH DRAW STEEL', text: `[[${p.seat}]] and [[${q.seat}]] both chose betrayal. The oath is ash. They duel.`, tone: 'bad' }, 2.5);
    yield* clashPlayers(g, p, q, p.at);
    return;
  }
  const [traitor, victim] = bp ? [p, q] : [q, p];
  say(g, { t: 'moment', seat: traitor.seat, kicker: 'THE OATH STONE', title: 'BETRAYED', text: `[[${victim.seat}]] kept the oath. [[${traitor.seat}]] did not: [[${victim.seat}]] loses a heart, and their best creature goes to [[${traitor.seat}]].`, tone: 'bad' }, 3);
  const o = topOf(victim);
  if (o) yield* handOver(g, victim, traitor, o, 'stolen');
  loseHeart(g, victim, 'player', traitor.seat);
}
/** v14 THE CHALLENGE RING: call any rival, anywhere, into the ring for a duel (the duel is three on three, like every fight). */
function* challengeRing(g: Game, p: Player, s: Space): Gen {
  const rivals = others(g, p);
  if (!rivals.length) return;
  const a = yield* ask({ k: 'choice', seat: p.seat, title: 'The Challenge Ring', sub: 'Call any rival, wherever they stand, into the ring. The loser pays a heart, and the winner takes a creature. Or walk away.', options: ['Throw down the glove', 'Walk away'], def: 1 }, 'pick');
  if (a?.i !== 0) return;
  const q = (yield* askTarget(g, p, 'ring', seatsOf(rivals))) ?? pickOne(g, rivals);
  breakOath(g, p, q);
  say(g, { t: 'moment', seat: p.seat, kicker: 'THE CHALLENGE RING', title: 'THE GLOVE IS DOWN', text: `[[${p.seat}]] calls [[${q.seat}]] into the ring. Nobody refuses the ring.`, tone: 'bad' }, 2.5);
  yield* clashPlayers(g, p, q, s.id);
}
/** v14 THE FISHING PIER: cast a line (or walk away) and let one die decide what bites. */
function* pier(g: Game, p: Player, s: Space): Gen {
  const a = yield* ask({ k: 'choice', seat: p.seat, title: 'The Fishing Pier', sub: 'Roll one die. 6: a rare creature. 4 or 5: a creature of this land. 2 or 3: nothing. 1: your BEST creature is dragged under.', options: ['Cast the line', 'Walk away'], def: 0 }, 'pick');
  if (a?.i !== 0) return;
  const roll = 1 + Math.floor(rand(g) * 6);
  const [title, tone] = roll === 6 ? ['A MONSTER OF A CATCH', 'gold'] : roll >= 4 ? ['SOMETHING BITES', 'gold'] : roll >= 2 ? ['NOT A NIBBLE', ''] : ['THE LINE PULLS BACK', 'bad'];
  say(g, { t: 'moment', seat: p.seat, kicker: 'THE FISHING PIER', title, text: `[[${p.seat}]] rolls ${roll}.`, tone: tone as 'gold' | 'bad' | '', dice: [roll] }, 3);
  if (roll === 6) yield* gain(g, p, drawRare(g), 'gamble');
  else if (roll >= 4) yield* gain(g, p, makeTeam(g, s.world ?? pickOne(g, g.petals), 1)[0]!, 'gamble');
  else if (roll === 1 && !loseCreature(g, p, 'trial', 'strongest')) news(g, `[[${p.seat}]] has nothing on the hook to lose.`, p.seat);
}
/** v14 THE BEAST'S SHRINE: ring the bell and the world beast hunts the rival you name next (a sleeping beast wakes for it). */
function* shrine(g: Game, p: Player): Gen {
  const rivals = others(g, p);
  if (!rivals.length) return;
  if (!g.boss && (g.bossDone || g.lastLight)) {
    news(g, 'The shrine is cold. Its beast is gone from the world. A card lies on the altar instead.', p.seat);
    yield* drawChance(g, p);
    return;
  }
  const a = yield* ask({ k: 'choice', seat: p.seat, title: "The Beast's Shrine", sub: g.boss ? 'Ring the bell and name a rival: the beast hunts them on its next hunt. Or leave it be.' : 'Ring the bell and the world beast wakes, far away, hunting the rival you name. Or leave it sleeping.', options: ['Ring the bell', 'Leave it be'], def: 1 }, 'pick');
  if (a?.i !== 0) return;
  const q = (yield* askTarget(g, p, 'whistle', seatsOf(rivals))) ?? pickOne(g, rivals);
  if (!g.boss) yield* bossWakes(g, true);
  if (!g.boss) return;
  g.boss.marked = q.seat;
  say(g, { t: 'moment', seat: p.seat, kicker: "THE BEAST'S SHRINE", title: 'THE BELL TOLLS', text: `[[${p.seat}]] rings the bell. The beast will hunt [[${q.seat}]] next.`, tone: 'bad', cid: g.boss.cid }, 2.5);
}
function drawLegend(g: Game): string {
  const legends = CREATURES.filter((c) => c.rarity === 'legendary' && g.bag[c.world].includes(c.id));
  const cid = legends.length ? pickOne(g, legends).id : drawRare(g);
  takeFromBag(g, cid);
  return cid;
}
/**
 * v13 THE DRAGON'S TEETH (the whole table's nerve, a game of chicken): six teeth in the jaw, one is a trap. Starting with the one
 * who found it, every hero in turn pulls one, or pays their weakest creature to pass. The one who pulls the trap loses a heart.
 */
function* dragonTeeth(g: Game, p: Player): Gen {
  const live = alive(g);
  const order = [...live.slice(live.indexOf(p)), ...live.slice(0, live.indexOf(p))];
  let left = 6;
  say(g, { t: 'moment', seat: p.seat, kicker: "THE DRAGON'S TEETH", title: 'SIX TEETH. ONE BITES.', text: `Starting with [[${p.seat}]], everyone pulls a tooth or pays their weakest creature to pass. The one who pulls the wrong tooth loses a heart.`, tone: 'bad' }, 3);
  for (let k = 0; k < 40 && left > 0; k++) {
    const q = order[k % order.length]!;
    if (q.out || g.winner !== null) continue;
    // A hero with no creature to pay passes free (they have nothing to stake but their skin).
    let pass = !q.deck.length;
    if (q.deck.length) {
      const a = yield* ask({ k: 'choice', seat: q.seat, title: `The Dragon's Teeth: ${left} left`, sub: `One of the ${left} bites (${Math.round(100 / left)}%). Pull, or pay your weakest creature to pass.`, options: ['Pull a tooth', 'Pay to pass'], def: 0 }, 'pick');
      pass = a?.i === 1;
    }
    if (pass) {
      const paid = loseCreature(g, q, 'fee');
      say(g, { t: 'moment', seat: q.seat, kicker: "THE DRAGON'S TEETH", title: 'PASSES', text: `[[${q.seat}]] ${paid ? 'pays a creature and passes' : 'has nothing to pay, and passes'}. ${left} teeth left.`, tone: '' }, 1.5);
      continue;
    }
    const bites = rand(g) < 1 / left;
    left--;
    if (bites) {
      say(g, { t: 'moment', seat: q.seat, kicker: "THE DRAGON'S TEETH", title: 'THE JAW SNAPS', text: `[[${q.seat}]] pulled the wrong tooth.`, tone: 'bad' }, 2.5);
      loseHeart(g, q, 'chance', null);
      return;
    }
    say(g, { t: 'moment', seat: q.seat, kicker: "THE DRAGON'S TEETH", title: 'SAFE', text: `[[${q.seat}]] pulls a tooth. Nothing. ${left} left.`, tone: '' }, 1.5);
  }
}
/**
 * v13 THE BLACK MARKET (an open auction, Bigg Boss's luxury budget with teeth): a legend on the block. From the finder round the
 * table, each hero raises by one creature or drops out. The last bidder pays the bid (weakest first) and takes the legend.
 */
function* blackMarket(g: Game, p: Player): Gen {
  const legend = drawLegend(g);
  const live = alive(g);
  const order = [...live.slice(live.indexOf(p)), ...live.slice(0, live.indexOf(p))];
  let bid = 0;
  let leader: Player | null = null;
  const inn = new Set(order.filter((q) => q.deck.length));
  say(g, { t: 'moment', seat: p.seat, kicker: 'THE BLACK MARKET', title: creature(legend).name.split(',')[0]!.toUpperCase(), text: 'A legend is for sale. Bid in creatures, one more each time. The last bidder pays and takes it.', tone: 'gold', cid: legend }, 3.5);
  for (let k = 0; k < 40 && inn.size > (leader ? 1 : 0); k++) {
    const q = order[k % order.length]!;
    if (!inn.has(q) || q === leader) continue;
    if (q.deck.length < bid + 1) {
      inn.delete(q);
      continue;
    }
    const a = yield* ask({ k: 'choice', seat: q.seat, title: `The Black Market: ${bid ? `${bid} bid` : 'no bid yet'}`, sub: `Raise to ${bid + 1} of your creatures, or drop out.`, options: [`Bid ${bid + 1}`, 'Drop out'], def: 1 }, 'pick');
    if (a?.i === 0) {
      bid++;
      leader = q;
      say(g, { t: 'moment', seat: q.seat, kicker: 'THE BLACK MARKET', title: `${bid} BID`, text: `[[${q.seat}]] bids ${bid}.`, tone: '' }, 1.2);
    } else inn.delete(q);
    if (leader && inn.size === 1 && inn.has(leader)) break;
  }
  if (!leader) {
    g.bag[creature(legend).world].push(legend);
    say(g, { t: 'moment', seat: p.seat, kicker: 'THE BLACK MARKET', title: 'NO SALE', text: 'Nobody bids. The legend slips back into the dark.', tone: '' }, 2);
    return;
  }
  for (let i = 0; i < bid; i++) loseCreature(g, leader, 'fee');
  say(g, { t: 'moment', seat: leader.seat, kicker: 'THE BLACK MARKET', title: 'SOLD', text: `[[${leader.seat}]] pays ${bid} and takes the legend.`, tone: 'gold', cid: legend }, 2.5);
  yield* gain(g, leader, legend, 'trade');
}
/**
 * v13 THE CHAMPION'S WAR (the card game War, with a blind stat): you and a rival each turn the top of a shuffled deck; the stat is
 * drawn at random; the higher number takes the other card. A tie: both go to the void.
 */
function* championWar(g: Game, p: Player, rivals: Player[]): Gen {
  const pool = rivals.filter((q) => q.deck.length);
  if (!pool.length || !p.deck.length) {
    news(g, 'No champions to turn. The war is called off.', p.seat);
    return;
  }
  const q = (yield* askTarget(g, p, 'quick', seatsOf(pool))) ?? pickOne(g, pool);
  const a = shuffled(g, p.deck)[0]!;
  const b = shuffled(g, q.deck)[0]!;
  const stat = pickOne(g, STATS);
  const [va, vb] = [fighter(a).stats[stat], fighter(b).stats[stat]];
  const text = `${creature(a.cid).name.split(',')[0]} ${va} against ${creature(b.cid).name.split(',')[0]} ${vb}, in ${stat}.`;
  say(g, { t: 'moment', seat: p.seat, kicker: "THE CHAMPION'S WAR", title: va === vb ? 'BOTH FALL' : `${va > vb ? '[[' + p.seat + ']]' : '[[' + q.seat + ']]'} WINS THE WAR`, text, tone: va > vb ? 'gold' : va < vb ? 'bad' : '' }, 3.5);
  if (va > vb) yield* handOver(g, q, p, b, 'stolen');
  else if (vb > va) yield* handOver(g, p, q, a, 'stolen');
  else {
    loseCreature(g, p, 'void', 'weakest', [a]);
    loseCreature(g, q, 'void', 'weakest', [b]);
  }
}
/**
 * v13 THE GAMBLER'S STAIRS (dice press-your-luck): climb a step by rolling at least 2, then 3, then 4, then 5. Stop on any step
 * to take its prize (a creature, two, a rare, a legend). Miss a roll: the prize is lost and so is your weakest creature.
 */
function* gamblerStairs(g: Game, p: Player): Gen {
  const need = [2, 3, 4, 5];
  const prize = ['a creature', 'two creatures', 'a rare creature', 'a legend'];
  let step = 0;
  for (; step < need.length; step++) {
    if (step > 0) {
      const a = yield* ask({ k: 'choice', seat: p.seat, title: `The Gambler's Stairs: step ${step}`, sub: `Keep ${prize[step - 1]}, or climb: roll ${need[step]}+ for ${prize[step]}. Miss and you lose it all, and your weakest.`, options: ['Climb', `Keep ${prize[step - 1]}`], def: 1 }, 'pick');
      if (a?.i !== 0) break;
    }
    const roll = 1 + Math.floor(rand(g) * 6);
    const ok = roll >= need[step]!;
    say(g, { t: 'moment', seat: p.seat, kicker: "THE GAMBLER'S STAIRS", title: ok ? `STEP ${step + 1}: ${prize[step]!.toUpperCase()}` : 'A MISSED STEP', text: `[[${p.seat}]] needs ${need[step]} and rolls ${roll}.`, tone: ok ? 'gold' : 'bad', dice: [roll] }, 2.5);
    if (!ok) {
      loseCreature(g, p, 'gamble');
      return;
    }
  }
  const world = g.board[p.at]!.world ?? pickOne(g, g.petals);
  if (step >= 4) yield* gain(g, p, drawLegend(g), 'gamble');
  else if (step === 3) yield* gain(g, p, drawRare(g), 'gamble');
  else for (let i = 0; i < step; i++) yield* gain(g, p, makeTeam(g, world, 1)[0]!, 'gamble');
}
/**
 * v13 THE GAUNTLET (a battle press-your-luck): lone beasts come one at a time, one on one. Beat one and it follows you; then step
 * out, or face the next. Lose and your fighter runs away, and the gauntlet ends.
 */
function* gauntlet(g: Game, p: Player, s: Space): Gen {
  const world = s.world ?? pickOne(g, g.petals);
  for (let k = 0; k < 3 && !p.out && g.winner === null; k++) {
    if (!p.deck.length) return;
    if (k > 0) {
      const a = yield* ask({ k: 'choice', seat: p.seat, title: `The Gauntlet: ${k} beaten`, sub: 'Another beast waits. Face it (win: it joins you; lose: your fighter runs), or step out now.', options: ['Face the next', 'Step out'], def: 1 }, 'pick');
      if (a?.i !== 0) return;
    }
    const out = yield* clashWild(g, p, makeTeam(g, world, 1), s.id, 'tame', null);
    if (out !== 'win') return;
  }
}
/**
 * v12 THE CAVE OF ECHOES (press your luck: Incan Gold, Can't Stop). Each step deeper finds a creature, or brings the roof down:
 * then everything found is buried and your weakest is lost with it. Walk out whenever you like with what you hold.
 */
function* cave(g: Game, p: Player, s: Space): Gen {
  const world = s.world ?? pickOne(g, g.petals);
  const found: string[] = [];
  for (let depth = 0; depth < TUNE.caveRisk.length; depth++) {
    const risk = TUNE.caveRisk[depth]!;
    if (depth > 0) {
      const a = yield* ask({ k: 'deeper', seat: p.seat, found, risk, depth }, 'yes');
      if (!a?.yes) break;
    }
    if (rand(g) < risk) {
      say(g, { t: 'cave', seat: p.seat, depth, cid: null, fell: true, risk }, sec('cave'));
      for (const cid of found) g.bag[creature(cid).world].push(cid);
      found.length = 0;
      loseCreature(g, p, 'trial');
      return;
    }
    const cid = makeTeam(g, world, 1)[0]!;
    found.push(cid);
    say(g, { t: 'cave', seat: p.seat, depth, cid, fell: false, risk }, sec('cave'));
  }
  say(g, { t: 'caveOut', seat: p.seat, kept: [...found] }, 1.5);
  for (const cid of found) yield* gain(g, p, cid, 'cache');
}
/**
 * v12 THE BRIDGE OF TRUST (the prisoner's dilemma of Golden Balls, on a rope bridge): you name a rival; both choose in secret.
 * Both SHARE: a creature each. One TAKES: the taker gets two, the trusting one loses a creature. Both TAKE: each loses a creature.
 */
function* trust(g: Game, p: Player, s: Space): Gen {
  const rivals = others(g, p);
  if (!rivals.length) return;
  const q = (yield* askTarget(g, p, 'trust', seatsOf(rivals))) ?? pickOne(g, rivals);
  const choose = function* (x: Player, vs: Player) {
    const a = yield* ask({ k: 'pick', seat: x.seat, why: 'trust', options: ['share', 'take'], secret: true, vs: vs.seat }, 'pick');
    return a?.i === 1 ? ('take' as const) : ('share' as const);
  };
  const pa = yield* choose(p, q);
  const pb = yield* choose(q, p);
  say(g, { t: 'trust', a: p.seat, b: q.seat, pa, pb }, sec('trust'));
  const world = s.world ?? pickOne(g, g.petals);
  const give = function* (x: Player, n: number) {
    for (let i = 0; i < n && !x.out; i++) yield* gain(g, x, makeTeam(g, world, 1)[0]!, 'gift');
  };
  if (pa === 'share' && pb === 'share') {
    yield* give(p, 1);
    yield* give(q, 1);
  } else if (pa === 'take' && pb === 'take') {
    strike(g, p, 'trial');
    strike(g, q, 'trial');
  } else {
    const [taker, fool] = pa === 'take' ? [p, q] : [q, p];
    yield* give(taker, 2);
    strike(g, fool, 'trial');
  }
}
/**
 * v12 THE EMPTY-HANDED WAGER (owner: "zero card… bas uska automatically betting system chalta rahega… kisi bhi player pe bet kar
 * sakta hai… jeetta hai to ek creature… else heart"). Name a rival and call their next battle. Right: a creature comes to you
 * (call LOSE and it is THEIR top creature). Wrong: you lose a heart. One wager at a time.
 */
function* emptyWager(g: Game, p: Player): Gen {
  if (p.deck.length || p.out || g.winner !== null) return;
  if (g.wagers.some((w) => (w.card === 'empty' || w.card === 'emptyLife') && w.by === p.seat)) {
    news(g, `[[${p.seat}]] has nothing to fight with. Their wager still stands.`, p.seat);
    return;
  }
  const rivals = others(g, p);
  if (!rivals.length) return;
  // (A call on someone with no creature would be a call on a coin: only rivals who can fight are offered.)
  if (!rivals.some((x) => x.deck.length)) return;
  // v15 THE LAST GAMBLE (owner: "0 creatures pe bet system… haar gaya toh game se bahar… human psychology"): no creature, so the
  // only weapon left is a call on someone else's fate, and you choose the stake. A heart, or your whole life. Or walk on, empty.
  const lay = yield* ask({ k: 'choice', seat: p.seat, title: 'The Last Gamble', sub: "No creatures left. Call a rival's next battle: WIN or LOSE. Stake a heart: right, gain a creature; wrong, lose a heart. Stake your life: right, two creatures and a heart; wrong, you are out.", options: ['Stake a heart', 'Stake your life', 'Walk on'], def: 2 }, 'pick');
  if (lay?.i !== 0 && lay?.i !== 1) return;
  const card = lay.i === 1 ? 'emptyLife' : 'empty';
  say(g, { t: 'chance', seat: p.seat, card }, sec('chance'));
  const armed = rivals.filter((x) => x.deck.length);
  const q = (yield* askTarget(g, p, 'empty', seatsOf(armed))) ?? pickOne(g, armed);
  const a = yield* ask({ k: 'predict', seat: p.seat, on: q.seat }, 'yes');
  wager(g, card, p, q, a?.yes === false ? 'lose' : 'win');
}
/**
 * v11 THE WHEEL OF PRALAYA (Mario Party's Chance Time, as a mechanism: a public spectacle of three reels that stop one by one and
 * can turn the whole match over, for anyone, either way): WHO · WHAT · WITH WHOM.
 */
function* wheel(g: Game, p: Player): Gen {
  const live = alive(g);
  if (live.length < 2) {
    news(g, 'The wheel spins, and finds no one to play with. It stops.', p.seat);
    return;
  }
  const a = pickOne(g, live);
  const b = pickOne(g, live.filter((x) => x !== a));
  const acts: WheelAct[] = ['swapHearts', 'swapDecks', 'giveTop', 'stealHeart', 'legend', 'curseAll'];
  const act = pickOne(g, acts.filter((k) => k !== 'swapHearts' || a.hearts !== b.hearts));
  say(g, { t: 'wheel', seat: p.seat, a: a.seat, act, b: b.seat }, sec('wheel'));
  const swapped = (what: 'hearts' | 'decks') =>
    say(g, { t: 'swapAll', a: a.seat, b: b.seat, what, aHearts: a.hearts, bHearts: b.hearts, aCount: a.deck.length, bCount: b.deck.length }, 2.5);
  switch (act) {
    case 'swapHearts':
      [a.hearts, b.hearts] = [b.hearts, a.hearts];
      swapped('hearts');
      return;
    case 'swapDecks':
      [a.deck, b.deck] = [b.deck, a.deck];
      swapped('decks');
      yield* settleHold(g, a);
      yield* settleHold(g, b);
      return;
    case 'giveTop': {
      const o = topOf(a);
      if (o) yield* handOver(g, a, b, o, 'given');
      return;
    }
    case 'stealHeart':
      {
        const before = b.hearts;
        loseHeart(g, b, 'chance', a.seat, undefined, true);
        if (!a.out && b.hearts < before) heal(g, a, 'chance');
      }
      return;
    case 'legend': {
      const legends = CREATURES.filter((c) => c.rarity === 'legendary' && g.bag[c.world].includes(c.id));
      const cid = (legends.length ? pickOne(g, legends) : pickOne(g, CREATURES.filter((c) => c.rarity === 'legendary'))).id;
      takeFromBag(g, cid);
      yield* gain(g, a, cid, 'gift');
      return;
    }
    case 'curseAll':
      // Everyone but these two loses their weakest creature.
      news(g, `[[${a.seat}]] and [[${b.seat}]] are spared. Everyone else loses a creature.`, null, 'bad');
      for (const x of alive(g)) if (x !== a && x !== b) loseCreature(g, x, 'void');
      return;
  }
}
/** The Oracle's Ladder: three guesses, higher or lower, on one stat; all three right and the last creature joins you. */
function* hilo(g: Game, p: Player, s: Space): Gen {
  const w = s.world ?? pickOne(g, g.petals);
  const stat = pickOne(g, STATS);
  let pool = shuffled(g, g.bag[w]);
  if (pool.length < 4) pool = shuffled(g, CREATURES.filter((c) => c.world === w).map((c) => c.id));
  const rungs = pool.slice(0, 4);
  const val = (cid: string) => statsOf(creature(cid))[stat];
  say(g, { t: 'hilo', seat: p.seat, stat, cid: rungs[0]!, val: val(rungs[0]!), step: 0, guess: null, ok: null }, sec('hilo'));
  for (let step = 1; step < rungs.length; step++) {
    const cur = rungs[step - 1]!;
    const a = yield* ask({ k: 'hilo', seat: p.seat, stat, cid: cur, val: val(cur), step }, 'yes');
    const guess = a?.yes === false ? 'lo' : 'hi';
    const nx = rungs[step]!;
    const ok = guess === 'hi' ? val(nx) >= val(cur) : val(nx) <= val(cur);
    say(g, { t: 'hilo', seat: p.seat, stat, cid: nx, val: val(nx), step, guess, ok }, sec('hilo'));
    if (!ok) {
      setContent(g, s, 'empty');
      return;
    }
  }
  const prize = rungs[rungs.length - 1]!;
  takeFromBag(g, prize);
  setContent(g, s, 'empty');
  yield* gain(g, p, prize, 'hilo');
}
/** The Altar of Bargains: a creature for a heart, a heart for a rare creature, or nothing. */
function* altar(g: Game, p: Player, s: Space): Gen {
  const offers: { key: 'creature' | 'heart' | 'walk'; text: string }[] = [];
  if (p.hearts < TUNE.hearts && p.deck.length) offers.push({ key: 'creature', text: 'Offer your strongest creature: gain a heart' });
  if (p.hearts >= 2) offers.push({ key: 'heart', text: 'Offer a heart: a rare creature joins you' });
  offers.push({ key: 'walk', text: 'Walk away' });
  const a = offers.length > 1 ? yield* ask({ k: 'pick', seat: p.seat, why: 'altar', options: offers.map((o) => o.text) }, 'pick') : null;
  const pick = offers[a && a.i >= 0 && a.i < offers.length ? a.i : offers.length - 1]!.key;
  say(g, { t: 'altar', seat: p.seat, pick }, 2);
  if (pick === 'creature') {
    loseCreature(g, p, 'altar', 'strongest');
    heal(g, p, 'altar');
  } else if (pick === 'heart') {
    p.hearts--;
    say(g, { t: 'heart', seat: p.seat, hearts: p.hearts, why: 'altar', by: null }, 2.5);
    yield* gain(g, p, drawRare(g), 'altar');
  }
  if (pick !== 'walk') setContent(g, s, 'empty');
}
/** The Masked Trader: one of yours for one you cannot see (anything from a common to a legend). */
function* trader(g: Game, p: Player, s: Space): Gen {
  if (!p.deck.length) {
    news(g, 'The Masked Trader looks at your empty hands and laughs.', p.seat);
    return;
  }
  const a = yield* ask({ k: 'pick', seat: p.seat, why: 'trader', options: ['Trade one creature, blind', 'Walk away'] }, 'pick');
  if (a?.i !== 0) {
    say(g, { t: 'trade', seat: p.seat, gave: null, got: null }, 1.5);
    return;
  }
  const r = yield* ask({ k: 'release', seat: p.seat, deck: p.deck, why: 'trade' }, 'release');
  const o = p.deck.find((x) => x.uid === r?.uid) ?? weakest(p.deck);
  const w = s.world ?? pickOne(g, g.petals);
  const x = rand(g);
  const want = x < 0.07 ? 'legendary' : x < 0.27 ? 'rare' : x < 0.57 ? 'uncommon' : 'common';
  const pool = CREATURES.filter((c) => c.rarity === want && g.bag[c.world].includes(c.id));
  const near = pool.filter((c) => c.world === w);
  const got = (near.length ? pickOne(g, near) : pool.length ? pickOne(g, pool) : pickOne(g, CREATURES)).id;
  takeFromBag(g, got);
  say(g, { t: 'trade', seat: p.seat, gave: o.cid, got }, 3);
  p.deck = p.deck.filter((y) => y !== o);
  say(g, { t: 'lost', seat: p.seat, cid: o.cid, why: 'trade' }, 1.5);
  yield* gain(g, p, got, 'trade');
  setContent(g, s, 'empty');
}
/** A relic (v > 0) or a hex (v < 0) on one creature. */
function modify(g: Game, p: Player, o: Owned, name: string, v: number, by: number | null): void {
  o.mod = (o.mod ?? 0) + v;
  o.modName = o.modName && o.modName !== name ? `${o.modName} · ${name}` : name;
  say(g, { t: 'mod', seat: p.seat, cid: o.cid, name, v, by }, sec('mod'));
}
/** v10 THE LAND STRIKES: before a turn, rarely, the land the hero stands on attacks. The top card of a shuffled deck must
 *  reach the land's number on one stat: stop it and a creature of that land follows you; fail and that creature is taken. */
function* landStrikes(g: Game, p: Player): Gen {
  const w = g.board[p.at]!.world;
  if (!w || g.round < 1 || rand(g) >= TUNE.attackBase + TUNE.attackRamp * progress(g)) return;
  const A = ATTACKS[w];
  const power = Math.round(TUNE.attackLo + rand(g) * (TUNE.attackHi - TUNE.attackLo) + progress(g) * TUNE.attackGrow);
  if (!p.deck.length) {
    // v12: nothing to throw in the way. The land passes over the bare-handed (they lay the wager on their turn instead).
    return;
  }
  const top = shuffled(g, p.deck)[0]!;
  const value = fighter(top).stats[A.stat];
  const ok = value >= power;
  const guarded = !ok && p.guardTurn >= p.turns;
  say(g, { t: 'attack', seat: p.seat, world: w, cid: top.cid, value, power, ok, guarded }, sec('attack'));
  if (ok) yield* gain(g, p, makeTeam(g, w, 1)[0]!, 'attack');
  else loseCreature(g, p, 'attack', 'weakest', [top]);
}
/** An encounter: three look alike; one blesses (a heart, or an ally if your hearts are full), one harms (a heart), one is nothing. */
function* encounter(g: Game, p: Player, s: Space): Gen {
  const pool = ENCOUNTERS.filter((e) => e.world === s.world || e.world === 'any');
  const e = pickOne(g, pool.length ? pool : ENCOUNTERS);
  const a = yield* ask({ k: 'encounter', seat: p.seat, enc: e }, 'encounter');
  const pick = Math.max(0, Math.min(2, Math.round(a?.pick ?? 0)));
  const fates = shuffled<'good' | 'bad' | 'none'>(g, ['good', 'bad', 'none']);
  say(g, { t: 'encounter', seat: p.seat, enc: e.id, pick, fates }, sec('encounter'));
  const f = fates[pick]!;
  if (f === 'good') {
    if (p.hearts < TUNE.hearts) heal(g, p, 'encounter');
    else yield* gain(g, p, drawRare(g), 'boon');
  } else if (f === 'bad') loseHeart(g, p, 'encounter', null, undefined, progress(g) < TUNE.noKnockoutBefore);
  setContent(g, s, 'empty');
}

function* cache(g: Game, p: Player, s: Space): Gen {
  // v10: no relics to collect any more; a cache holds a creature, a relic for one of yours, or a boon.
  const x = rand(g);
  const relic = x < 0.35 && p.deck.length > 0;
  const cid = !relic && x < 0.7 ? makeTeam(g, s.world!, 1)[0]! : null;
  const boon = !relic && !cid ? wonder(g) : null;
  say(g, { t: 'cache', seat: p.seat, at: s.id, relic, cid, boon }, sec('cache'));
  if (relic) yield* equip(g, p, null);
  if (cid) yield* gain(g, p, cid, 'cache');
  if (boon) yield* giveBoon(g, p, boon, 'cache');
  setContent(g, s, 'empty');
}
/** A relic of the old world: its finder chooses which creature carries it. */
function* equip(g: Game, p: Player, by: number | null): Gen {
  if (!p.deck.length) return;
  const r = pickOne(g, RELICS);
  const a = yield* ask({ k: 'release', seat: p.seat, deck: p.deck, why: 'equip', relic: r.name }, 'release');
  const o = p.deck.find((x) => x.uid === a?.uid) ?? strongest(p.deck);
  modify(g, p, o, r.name, r.bonus, by);
}

// ── Disasters ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Push a player `n` steps along `step` (Floaty adds 2 more: pushes he did not choose). */
function push(
  g: Game,
  p: Player,
  n: number,
  why: Extract<Beat, { t: 'pushed' }>['why'],
  step: (at: number) => number | null,
): void {
  const total = n + (p.hero.weak === 'floaty' ? 2 : 0);
  const from = p.at;
  for (let i = 0; i < total; i++) {
    const nx = step(p.at);
    if (nx === null || g.board[nx]!.void) break;
    p.at = nx;
  }
  if (p.at !== from) {
    p.from = null;
    g.board[p.at]!.seen = true;
    say(g, { t: 'pushed', seat: p.seat, from, to: p.at, why }, 2);
  }
}
function* disaster(g: Game, p: Player, world: WorldId): Gen {
  const d = DISASTERS.find((x) => x.world === world)!;
  const dodge = p.deck.find(
    (o) =>
      !o.tired &&
      ((d.dodgeType && fighter(o).types.includes(d.dodgeType)) ||
        (d.dodgeGift && giftsOf(o).includes(d.dodgeGift))),
  );
  const slept = false;
  const astra = !dodge && !slept && p.boons.includes('brahmastra');
  const why = dodge ? 'dodge' : slept ? 'slept' : astra ? 'brahmastra' : null;
  say(g, { t: 'disaster', seat: p.seat, world, dodged: dodge?.cid ?? null, why }, sec('disaster'));
  if (dodge) {
    if (d.dodgeGift && giftsOf(dodge).includes(d.dodgeGift)) {
      dodge.tired = true;
      say(g, { t: 'tired', seat: p.seat, cid: dodge.cid, gift: d.dodgeGift }, 1);
    }
    return;
  }
  if (slept) {
    p.slept = true;
    return;
  }
  if (astra) {
    useBoon(g, p, 'brahmastra');
    return;
  }
  const lose = (who: Player, pick: 'weakest' | 'strongest' = 'weakest') => {
    // An undodged disaster takes a heart (and, where it says so, a creature): the collection you keep is the dodge.
    if (pick === 'strongest') loseCreature(g, who, 'disaster', pick);
    loseHeart(g, who, 'disaster', null);
  };
  switch (d.fx) {
    case 'washInward3':
      push(g, p, 3, 'washed', (at) => towards(g.board, at, (s) => s.ring === 'inner'));
      lose(p);
      break;
    case 'stoneStrongest':
    case 'anvilStrongest':
      lose(p, 'strongest');
      break;
    case 'pullCentre2':
      push(g, p, 2, 'pulled', (at) => {
        const nx = towards(g.board, at, (s) => s.id === CENTRE);
        return nx === CENTRE && p.relics < TUNE.escapeRelics ? null : nx;
      });
      lose(p);
      break;
    case 'dragBack3':
      push(g, p, 3, 'dragged', (at) =>
        g.board[at]!.ring === 'outer' ? (at + 23) % 24 : towards(g.board, at, (s) => s.ring === 'outer'),
      );
      lose(p);
      break;
    case 'darkAll':
      for (const s of g.board) s.seen = false;
      g.board[p.at]!.seen = true;
      lose(p);
      break;
    case 'stampede':
      for (const q of alive(g))
        if (q === p || (g.board[q.at]!.world === 'lost' && g.board[q.at]!.ring === 'outer')) lose(q);
      break;
    case 'vines':
      lose(p);
      p.skip = true;
      break;
  }
}

// ── Riddles ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function* payFee(g: Game, p: Player): Gen<boolean> {
  if (!p.deck.length) return false;
  const a = yield* ask({ k: 'release', seat: p.seat, deck: p.deck, why: 'fee' }, 'release');
  const o = p.deck.find((x) => x.uid === a?.uid) ?? weakest(p.deck);
  p.deck = p.deck.filter((x) => x !== o);
  say(g, { t: 'lost', seat: p.seat, cid: o.cid, why: 'fee' }, 2);
  return true;
}
function* riddleFx(g: Game, p: Player, fx: RiddleFx, s: Space): Gen {
  const world = s.world ?? 'wild';
  switch (fx) {
    case 'walkOn':
      return;
    case 'ferryGive':
      if (yield* payFee(g, p)) {
        const inner = open(g).filter((x) => x.ring === 'inner');
        if (inner.length) {
          const to = pickOne(g, inner).id;
          say(g, { t: 'portal', seat: p.seat, from: p.at, to, why: 'ferry' }, 3);
          p.at = to;
          p.from = null;
        }
      }
      return;
    case 'roarDoor': {
      const out = yield* clashWild(g, p, makeTeam(g, world, 2), s.id, 'riddle', null);
      if (out === 'win') yield* equip(g, p, null);
      return;
    }
    case 'silentDoor':
      if (rand(g) < 0.5) yield* gain(g, p, makeTeam(g, world, 1)[0]!, 'gamble');
      else loseCreature(g, p, 'gamble');
      return;
    case 'rubLamp': {
      const cid = drawRare(g, 7);
      if (p.deck.length) loseCreature(g, p, 'fee', 'strongest');
      yield* gain(g, p, cid, 'riddle');
      return;
    }
    case 'polishLamp':
      p.nextDraw = 1;
      return;
    case 'mirrorTrade': {
      if (p.deck.length < 2) return;
      const w = weakest(p.deck);
      const b = strongest(p.deck);
      p.deck = p.deck.filter((x) => x !== w);
      say(g, { t: 'lost', seat: p.seat, cid: w.cid, why: 'fee' }, 1.5);
      yield* gain(g, p, b.cid, 'riddle');
      return;
    }
    case 'lookCloser':
      yield* gain(g, p, makeTeam(g, s.world ?? pickOne(g, g.petals), 1)[0]!, 'riddle');
      return;
    case 'oath': {
      const options = alive(g)
        .filter((q) => q !== p)
        .map((q) => q.seat);
      if (!options.length) return;
      const a = yield* ask({ k: 'target', seat: p.seat, why: 'oath', options }, 'target');
      const q = a && options.includes(a.seat) ? a.seat : pickOne(g, options);
      if (q !== undefined) {
        g.oaths.push([p.seat, q]);
        say(g, { t: 'oath', a: p.seat, b: q }, 3);
      }
      return;
    }
    case 'refuseOath':
      // v15: refusing costs nothing, and the screen says so (no hidden aim of the world).
      news(g, `[[${p.seat}]] refuses the oath. Nothing follows them but a long stare.`, p.seat);
      return;
    case 'burnMap':
      g.honestRound = g.round;
      return;
    case 'keepMap':
      p.mapTurn = p.turns + 1;
      return;
    case 'merchant':
      if (yield* payFee(g, p)) {
        const options = g.petals.filter((w) => open(g).some((x) => x.world === w));
        const a = yield* ask({ k: 'world', seat: p.seat, why: 'merchant', options }, 'world');
        g.skyWorld = a && options.includes(a.world) ? a.world : (options[0] ?? null);
      }
      return;
    case 'wakeGiant': {
      const cid =
        CREATURE['kumbhakarna'] && g.bag.india.includes('kumbhakarna') ? 'kumbhakarna' : drawRare(g);
      takeFromBag(g, cid);
      yield* gain(g, p, cid, 'riddle');
      return;
    }
    case 'tiptoe':
      yield* walk(g, p, 2, {});
      return;
    case 'littleCup': {
      const commons = g.bag[world].filter((id) => creature(id).rarity === 'common');
      const cid = commons[0] ?? makeTeam(g, world, 1)[0]!;
      takeFromBag(g, cid);
      yield* gain(g, p, cid, 'riddle');
      return;
    }
    case 'greatCup':
      if (rand(g) < 1 / 3) {
        const leg = CREATURES.find(
          (c) => c.world === world && c.rarity === 'legendary' && g.bag[world].includes(c.id),
        );
        const cid = leg?.id ?? drawRare(g);
        takeFromBag(g, cid);
        yield* gain(g, p, cid, 'riddle');
      } else loseCreature(g, p, 'riddle', 'strongest');
      return;
    case 'payTroll':
      if (yield* payFee(g, p)) {
        const br = g.board[p.at]!.adj.find((n) => isBridge(g.board, p.at, n) && !g.board[n]!.void);
        const to = br ?? towards(g.board, p.at, (x) => x.ring === 'spoke');
        if (to !== null && to !== undefined) {
          say(g, { t: 'portal', seat: p.seat, from: p.at, to, why: 'bridge' }, 2.5);
          p.at = to;
          p.from = null;
        }
      }
      return;
    case 'fightTroll':
    case 'fightGiant': {
      const lone = fx === 'fightTroll' ? 'troll' : 'bakasura';
      const team = CREATURE[lone] ? [lone] : makeTeam(g, world, 1);
      yield* clashWild(g, p, team, s.id, 'riddle', null);
      return;
    }
    case 'feedGiant':
      p.nap = true;
      return;
    case 'grabSafe': {
      if (g.relics.includes(s.id)) {
        g.relics = g.relics.filter((x) => x !== s.id);
        p.relics++;
        say(g, { t: 'relic', seat: p.seat, from: null, relics: p.relics }, 2.5);
      } else yield* giveBoon(g, p, wonder(g), 'riddle');
      loseCreature(g, p, 'riddle', 'strongest');
      return;
    }
  }
}

// ── Moving ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Rule = Extract<FateFx, { k: 'move' }>['rule'];
/** Where you may step next: never back where you came from (unless that is the only way), never into the void (chalk aside). */
function stepOptions(g: Game, p: Player, chalk: boolean): number[] {
  const adj = g.board[p.at]!.adj;
  const ok = (n: number) =>
    !g.board[n]!.void || (chalk && g.board[n]!.adj.some((m) => m !== p.at && !g.board[m]!.void));
  const all = adj.filter(ok);
  const fwd = all.filter((n) => n !== p.from);
  return fwd.length ? fwd : all;
}
const leftOf = (g: Game, p: Player) => {
  const live = alive(g);
  return live[(live.indexOf(p) + 1) % live.length]!;
};
function* walk(g: Game, p: Player, steps: number, o: { rule?: Rule }): Gen {
  let left = Math.min(steps, p.hero.weak === 'badKnees' ? 4 : 99);
  const startWorld = g.board[p.at]!.world;
  let dir: 1 | -1 = 1;
  let extra = o.rule === 'leaveWorld' ? 3 : 0;
  if (o.rule === 'outerRing' && g.board[p.at]!.ring === 'outer') {
    const options = [(p.at + 1) % 24, (p.at + 23) % 24].filter((n) => !g.board[n]!.void);
    if (options.length > 1) {
      const a = yield* ask({ k: 'fork', seat: p.seat, mover: p.seat, at: p.at, options, left }, 'fork');
      dir = a?.to === (p.at + 23) % 24 ? -1 : 1;
    } else if (options[0] === (p.at + 23) % 24) dir = -1;
  }
  let first = true;
  while (left > 0) {
    const chalk = false;
    let opts = stepOptions(g, p, chalk);
    if (o.rule === 'backward' && first && p.from !== null && !g.board[p.from]!.void) opts = [p.from];
    if (o.rule === 'outerRing') {
      if (g.board[p.at]!.ring !== 'outer') {
        const nx = towards(g.board, p.at, (s) => s.ring === 'outer');
        opts = nx === null ? [] : [nx];
      } else opts = [(p.at + (dir === 1 ? 1 : 23)) % 24].filter((n) => !g.board[n]!.void);
    }
    if (o.rule === 'inward') {
      const d0 = distance(g.board, p.at, CENTRE);
      opts = opts.filter(
        (n) =>
          !g.board[n]!.void &&
          distance(g.board, n, CENTRE) < d0 &&
          (n !== CENTRE || p.relics >= TUNE.escapeRelics),
      );
    }
    if (o.rule === 'toUnseen') {
      const nx = towards(g.board, p.at, (s) => !s.seen && s.id !== CENTRE);
      opts = nx === null ? [] : [nx];
    }
    if (o.rule === 'chord') {
      const br = opts.find((n) => isBridge(g.board, p.at, n) && !g.board[n]!.void);
      if (br !== undefined) opts = [br];
    }
    if (!opts.length && first && o.rule) {
      // The card's rule cannot be followed from here: walk it as a plain move instead.
      o = {};
      continue;
    }
    if (!opts.length) {
      // Cut off by the void: the jungle carries you to the nearest ground that still has a way out.
      if (first) {
        const exitsOf = (id: number) => g.board[id]!.adj.filter((n) => !g.board[n]!.void).length;
        const ground = open(g)
          .filter((x) => x.id !== p.at && x.id !== CENTRE && exitsOf(x.id) > 0)
          .sort((a, b) => Math.hypot(a.x - g.board[p.at]!.x, a.y - g.board[p.at]!.y) - Math.hypot(b.x - g.board[p.at]!.x, b.y - g.board[p.at]!.y))[0];
        if (ground && !o.rule) {
          say(g, { t: 'portal', seat: p.seat, from: p.at, to: ground.id, why: 'carried' }, 2.5);
          p.at = ground.id;
          p.from = null;
          first = false;
          continue;
        }
        say(g, { t: 'stuck', seat: p.seat }, 1.5);
      }
      break;
    }
    let to = opts[0]!;
    if (opts.length > 1) {
      const chooser = o.rule === 'leftChooses' ? leftOf(g, p) : p;
      // The Truffle Baron (and the kept Old Map) see the first space down each branch.
      if (p.mapTurn >= p.turns) {
        for (const n of opts) g.board[n]!.seen = true;
        say(g, { t: 'reveal', spaces: opts, for: p.seat }, 1.5);
      }
      const a = yield* ask(
        { k: 'fork', seat: chooser.seat, mover: p.seat, at: p.at, options: opts, left },
        'fork',
      );
      to = a && opts.includes(a.to) ? a.to : opts[0]!;
      if (p.hero.weak === 'measures') left--;
    }
    const crossing = g.board[to]!.void;
    if (crossing) p.usedRound = g.round;
    say(g, { t: 'step', seat: p.seat, from: p.at, to, chalk: crossing }, 0.45);
    p.from = p.at;
    p.at = to;
    left--;
    first = false;
    if (crossing) {
      left = Math.max(left, 1);
      continue;
    }
    if (p.at === CENTRE) return;
    if (o.rule === 'toUnseen' && !g.board[p.at]!.seen) break;
    // The Pig Decides.
    if (p.hero.weak === 'pigDecides' && left > 0 && rand(g) < 1 / 6) {
      say(g, { t: 'stop', seat: p.seat, by: p.seat, at: p.at, why: 'pig' }, 2);
      break;
    }
    // Sit Down and Eat: the Grandmother stops anyone passing her space or a neighbour.
    const gran = alive(g).find(
      (q) =>
        q !== p &&
        (false as boolean) &&
        q.usedRound !== g.round &&
        (q.at === p.at || g.board[q.at]!.adj.includes(p.at)),
    );
    if (gran && left > 0) {
      const a = yield* ask({ k: 'stop', seat: gran.seat, mover: p.seat, at: p.at }, 'yes');
      if (a?.yes) {
        gran.usedRound = g.round;
        say(g, { t: 'stop', seat: p.seat, by: gran.seat, at: p.at, why: 'sitDown' }, 2.5);
        break;
      }
    }
    if (left === 0 && extra > 0 && g.board[p.at]!.world === startWorld) {
      left++;
      extra--;
    }
  }
  if (g.board[p.at]!.void) p.at = nearestOpen(g, p.at);
}
function* portal(g: Game, p: Player, to: Extract<FateFx, { k: 'portal' }>['to']): Gen {
  const here = g.board[p.at]!;
  const worldsOpen = g.petals.filter((w) => open(g).some((s) => s.world === w));
  let spots: Space[] = [];
  if (to === 'named') {
    const a = yield* ask({ k: 'world', seat: p.seat, why: 'portal', options: worldsOpen }, 'world');
    const w = a && worldsOpen.includes(a.world) ? a.world : worldsOpen[0];
    spots = open(g).filter((s) => s.world === w && s.ring === 'outer');
    if (!spots.length) spots = open(g).filter((s) => s.world === w);
  } else if (to === 'elsewhere') spots = open(g).filter((s) => s.world && s.world !== here.world);
  else if (to === 'inner') spots = open(g).filter((s) => s.ring === 'inner');
  else {
    const k = (g.petals.indexOf(here.world ?? g.petals[0]!) + 4) % 8;
    const mirror =
      here.ring === 'outer' ? 3 * k + (p.at % 3) : here.ring === 'spoke' ? SPOKE0 + k : INNER0 + k;
    spots = [g.board[g.board[mirror]!.void ? nearestOpen(g, mirror) : mirror]!];
  }
  if (p.hero.weak === 'seasick') spots = spots.filter((s) => s.world !== 'pirate');
  if (!spots.length) return;
  const dest = pickOne(g, spots).id;
  say(g, { t: 'portal', seat: p.seat, from: p.at, to: dest, why: 'fate' }, 3);
  p.at = dest;
  p.from = null;
}

/** Where a fate card can end (for the ghost trail and the Seasick Captain): every endpoint over the fork choices. */
export function reach(g: Game, p: Player, f: Fate): number[] {
  const fx = f.fx;
  if (fx.k === 'portal') {
    const here = g.board[p.at]!;
    if (fx.to === 'inner')
      return open(g)
        .filter((s) => s.ring === 'inner')
        .map((s) => s.id);
    if (fx.to === 'elsewhere')
      return open(g)
        .filter((s) => s.world && s.world !== here.world)
        .map((s) => s.id);
    if (fx.to === 'named')
      return open(g)
        .filter((s) => s.ring === 'outer')
        .map((s) => s.id);
    return [];
  }
  if (fx.k !== 'move') return [p.at];
  const out = new Set<number>();
  const bounce = 0;
  const maxSteps = Math.min(fx.steps + bounce, p.hero.weak === 'badKnees' ? 4 : 99);
  const minSteps = Math.max(1, (fx.min ?? fx.steps) - bounce);
  const go = (at: number, from: number | null, n: number) => {
    if (n >= minSteps) out.add(at);
    if (n >= maxSteps || out.size > 40) return;
    const adj = g.board[at]!.adj.filter((m) => !g.board[m]!.void);
    const fwd = adj.filter((m) => m !== from);
    for (const m of fwd.length ? fwd : adj) go(m, at, n + 1);
  };
  go(p.at, p.from, 0);
  return [...out];
}

function* askTarget(g: Game, p: Player, why: TargetWhy, options: number[]): Gen<Player | null> {
  if (!options.length) return null;
  const a = yield* ask({ k: 'target', seat: p.seat, why, options }, 'target');
  return g.players[a && options.includes(a.seat) ? a.seat : pickOne(g, options)]!;
}
/** A friend-chosen harm: at most one per target per round; the Escapologist may pass it to someone within 2 spaces. */
function* harm(g: Game, p: Player, why: TargetWhy): Gen<Player | null> {
  const fresh = alive(g).filter((q) => q !== p && q.harmedRound !== g.round);
  if (!fresh.length) {
    say(g, { t: 'fizzle', seat: p.seat }, 2);
    return null;
  }
  let q = yield* askTarget(
    g,
    p,
    why,
    fresh.map((x) => x.seat),
  );
  if (!q) return null;
  q.harmedRound = g.round;
  return q;
}

function* doFate(g: Game, p: Player, f: Fate): Gen {
  const fx = f.fx;
  if (fx.k === 'move') {
    let n = fx.steps;
    const lo = fx.min ?? fx.steps;
    const options = new Set<number>();
    for (let k = lo; k <= fx.steps; k++) options.add(k);
    if (options.size > 1) {
      const opts = [...options].sort((a, b) => a - b);
      const a = yield* ask({ k: 'steps', seat: p.seat, options: opts }, 'steps');
      n = a && opts.includes(a.n) ? a.n : fx.steps;
    }
    yield* walk(g, p, n, { rule: fx.rule });
    if (fx.slow) p.nap = true;
  } else if (fx.k === 'portal') yield* portal(g, p, fx.to);
  else if (fx.k === 'unleash') {
    const q = yield* harm(g, p, 'unleash');
    if (q)
      yield* clashWild(
        g,
        q,
        makeTeam(g, g.board[q.at]!.world ?? pickOne(g, g.petals)),
        q.at,
        'unleash',
        p.seat,
      );
  } else if (fx.k === 'swap') {
    const q = yield* harm(g, p, 'swap');
    if (q) {
      [p.at, q.at] = [q.at, p.at];
      p.from = q.from = null;
      say(g, { t: 'swap', seat: p.seat, with: q.seat }, 3);
    }
  } else if (fx.k === 'parrot') {
    const near = alive(g).filter((q) => q !== p && distance(g.board, p.at, q.at) <= 3);
    const q = near.length
      ? yield* askTarget(
          g,
          p,
          'parrot',
          near.map((x) => x.seat),
        )
      : null;
    if (q) yield* clashPlayers(g, p, q, p.at, 'parrot');
  } else if (fx.k === 'sky') {
    const options = g.petals.filter((w) => open(g).some((s) => s.world === w && s.id !== p.at));
    const a = yield* ask({ k: 'world', seat: p.seat, why: 'sky', options }, 'world');
    g.skyWorld = a && options.includes(a.world) ? a.world : (options[0] ?? null);
  } else if (fx.k === 'unknown') {
    const spots = open(g).filter((s) => !s.seen && s.id !== CENTRE);
    if (spots.length) {
      const to = pickOne(g, spots).id;
      say(g, { t: 'portal', seat: p.seat, from: p.at, to, why: 'unknown' }, 3);
      p.at = to;
      p.from = null;
    }
    const w = g.board[p.at]!.world ?? 'wild';
    if (rand(g) < 0.5) yield* gain(g, p, makeTeam(g, w, 1)[0]!, 'gamble');
    else loseCreature(g, p, 'gamble');
  } else if (fx.k === 'jar') {
    const pool = CREATURES.filter((c) => c.rarity !== 'legendary' && g.bag[c.world].includes(c.id));
    const c = pickOne(g, pool.length ? pool : CREATURES);
    takeFromBag(g, c.id);
    const low = p.deck.length > 0 && c.power < power(weakest(p.deck));
    if (low) {
      say(g, { t: 'capture', seat: p.seat, cid: c.id, why: 'gamble' }, 1.5);
      say(g, { t: 'lost', seat: p.seat, cid: c.id, why: 'escaped' }, 1.5);
      loseCreature(g, p, 'gamble');
    } else yield* gain(g, p, c.id, 'gamble');
  } else if (fx.k === 'tea') {
    for (const o of p.deck) o.tired = false;
    g.sheltered.push({ at: p.at, until: g.round, tree: false });
  }
}

function* playGolden(g: Game, p: Player): Gen {
  p.golden = 'used';
  // v15 (owner: "choices spam nahi… golden card mein 10 choices overpower"): three of the big moments, dealt at random.
  const all: BigEffect[] = ['stampede', 'swallow', 'exile', 'plunder'];
  if (p.deck.length >= 2) all.push('fuse');
  const effects = shuffled(g, all).slice(0, 3);
  const a = yield* ask({ k: 'golden', seat: p.seat, effects }, 'golden');
  const e = a && effects.includes(a.effect) ? a.effect : effects[0]!;
  if (e === 'fuse') {
    const f = yield* ask({ k: 'fuse', seat: p.seat, deck: p.deck }, 'fuse');
    const x = p.deck.find((o) => o.uid === f?.a && !o.fused) ?? p.deck.find((o) => !o.fused) ?? p.deck[0]!;
    const y = p.deck.find((o) => o.uid === f?.b && o !== x && !o.fused) ?? p.deck.find((o) => o !== x)!;
    say(g, { t: 'big', seat: p.seat, effect: e, target: null }, 3);
    p.deck = p.deck.filter((o) => o !== y);
    x.fused = y.cid;
    x.ascended = x.ascended || y.ascended;
    x.exalted = x.exalted || y.exalted;
    x.wins = Math.max(x.wins, y.wins);
    say(g, { t: 'fuse', seat: p.seat, a: x.cid, b: y.cid }, 4.5);
    return;
  }
  if (e === 'swallow') {
    const options = g.petals.filter((w) => g.weather[w] !== 'sun' && open(g).some((s) => s.world === w));
    const w = yield* ask({ k: 'world', seat: p.seat, why: 'swallow', options }, 'world');
    const world = w && options.includes(w.world) ? w.world : options[0]!;
    say(g, { t: 'big', seat: p.seat, effect: e, target: world }, 3);
    yield* eat(
      g,
      g.board.filter((s) => s.world === world && !s.void).map((s) => s.id),
      world,
      'world',
      true,
      true,
    );
    return;
  }
  const pool = alive(g).filter((q) => q !== p && (e !== 'plunder' || q.deck.length > 0));
  const q = yield* askTarget(
    g,
    p,
    e,
    (pool.length ? pool : alive(g).filter((x) => x !== p)).map((x) => x.seat),
  );
  say(g, { t: 'big', seat: p.seat, effect: e, target: q?.seat ?? null }, 3);
  if (!q) return;
  if (e === 'stampede') yield* clashWild(g, q, makeTeam(g, 'wild', 3), q.at, 'stampede', p.seat);
  else if (e === 'exile') {
    [p.at, q.at] = [q.at, p.at];
    p.from = q.from = null;
    say(g, { t: 'swap', seat: p.seat, with: q.seat }, 3);
  } else if (e === 'plunder') {
    const o = topOf(q);
    if (o) yield* handOver(g, q, p, o, 'stolen');
  }
}

// ── v9: the roll, the hero's power, chance cards, bets, the bomb, the boss, stampedes ────────────────────────────────────
const others = (g: Game, p: Player) => alive(g).filter((q) => q !== p);
const topOf = (q: Player): Owned | null => (q.deck.length ? strongest(q.deck) : null);
const seatsOf = (xs: readonly Player[]) => xs.map((x) => x.seat);
/** A plain sentence for the screen; [[n]] is seat n's name. */
function news(g: Game, text: string, seat: number | null, tone: 'good' | 'bad' | 'gold' | '' = '', secs = sec('news')): void {
  say(g, { t: 'news', text, seat, tone }, secs);
}
/** Hand a creature from one player to another, in plain sight. */
function* handOver(g: Game, from: Player, to: Player, o: Owned, why: 'given' | 'stolen' | 'wager'): Gen {
  if (from.guardTurn >= from.turns) {
    say(g, { t: 'guarded', seat: from.seat, cid: o.cid }, 2);
    return;
  }
  from.deck = from.deck.filter((x) => x !== o);
  from.lastLost = o.cid;
  say(g, { t: 'lost', seat: from.seat, cid: o.cid, why }, 1.5);
  to.deck.push({ ...o, tired: false });
  say(g, { t: 'capture', seat: to.seat, cid: o.cid, why: why === 'given' ? 'gift' : why === 'wager' ? 'wager' : 'steal' }, 2);
  yield* settleHold(g, to);
}

/** The roll: one d6 (or the power's way), then the walk with a choice at every fork. */
/** Every place exactly n steps away (no doubling straight back), with one road to each: the player's free choice. */
export function destinations(g: Game, from: number, n: number, prevAt: number | null): Map<number, number[]> {
  type St = { at: number; prev: number | null; path: number[] };
  let layer: St[] = [{ at: from, prev: prevAt, path: [] }];
  for (let k = 0; k < n; k++) {
    const next = new Map<string, St>();
    for (const st of layer)
      for (const m of g.board[st.at]!.adj) {
        if (g.board[m]!.void || m === st.prev) continue;
        // The Burning Heart is an end, never a road: stop in it (and it throws you somewhere random), never walk through it.
        if (st.at === CENTRE && k > 0) continue;
        const key = `${m}|${st.at}`;
        if (!next.has(key)) next.set(key, { at: m, prev: st.at, path: [...st.path, m] });
      }
    layer = [...next.values()];
    if (!layer.length) break;
  }
  const out = new Map<number, number[]>();
  for (const st of layer) if (st.path.length === n && st.at !== from && !out.has(st.at)) out.set(st.at, st.path);
  return out;
}
/** The move (owner: "4 aaya toh its on me"): every place the roll reaches lights up; you choose where to go. */
function* travel(g: Game, p: Player, n: number): Gen {
  let ends = destinations(g, p.at, n, p.from);
  if (!ends.size) ends = destinations(g, p.at, n, null);
  if (!ends.size) {
    yield* walk(g, p, n, {});
    return;
  }
  let options = [...ends.keys()];
  // Measures Twice: the Geometry Professor only ever gets to choose between two of them.
  if (p.hero.weak === 'measures' && options.length > 2) options = shuffled(g, options).slice(0, 2);
  const a = options.length > 1 ? yield* ask({ k: 'space', seat: p.seat, why: 'roll', options, n }, 'space') : null;
  const to = a && options.includes(a.at) ? a.at : options[0]!;
  for (const x of ends.get(to)!) {
    say(g, { t: 'step', seat: p.seat, from: p.at, to: x, chalk: false }, 0.45);
    p.from = p.at;
    p.at = x;
    if (x !== to && p.hero.weak === 'pigDecides' && rand(g) < 1 / 6) {
      say(g, { t: 'stop', seat: p.seat, by: p.seat, at: x, why: 'pig' }, 2);
      break;
    }
  }
}
function* rollAndWalk(g: Game, p: Player, mode: RollMode): Gen {
  const d6 = () => 1 + Math.floor(rand(g) * 6);
  if (mode === 'roll' && p.bonusDraws > 0) {
    p.bonusDraws--;
    mode = 'lucky';
  }
  let dice: number[];
  let n: number;
  if (mode === 'measure') {
    const opts = [1, 2, 3, 4, 5, 6];
    const a = yield* ask({ k: 'steps', seat: p.seat, options: opts }, 'steps');
    n = a && opts.includes(a.n) ? a.n : 3;
    dice = [n];
  } else if (mode === 'two' || mode === 'lucky') {
    dice = [d6(), d6()];
    const opts = [...new Set(dice)].sort((x, y) => x - y);
    const a = mode === 'two' && opts.length > 1 ? yield* ask({ k: 'steps', seat: p.seat, options: opts }, 'steps') : null;
    n = a && opts.includes(a.n) ? a.n : Math.max(...dice);
  } else {
    dice = [d6()];
    n = mode === 'moon' ? dice[0]! * 2 : mode === 'flex' ? dice[0]! + 3 : dice[0]!;
  }
  let bonus = 0;
  if (p.nextDraw > 0) {
    bonus = 2;
    n += 2;
  }
  p.nextDraw = 0;
  if (p.haunt) {
    // The Fallen Whisper: a ghost's +2 or −2 on this roll (never below one step).
    bonus += p.haunt;
    n = Math.max(1, n + p.haunt);
    p.haunt = 0;
    p.hauntBy = null;
  }
  let cap: 'nap' | 'knees' | 'curse' | null = null;
  if (p.curse) {
    p.curse = false;
    if (n > 2) {
      n = 2;
      cap = 'curse';
    }
  }
  if (p.nap) {
    p.nap = false;
    if (n > 3) {
      n = 3;
      cap = 'nap';
    }
  }
  if (p.hero.weak === 'badKnees' && n > 4) {
    n = 4;
    cap = 'knees';
  }
  say(g, { t: 'dice', seat: p.seat, dice, n, mode, cap, bonus }, sec('dice'));
  yield* travel(g, p, n);

  // v16 (2,000 matches: the Astronaut won 18–21%): a moon jump may come down on a falling star (5 or 6): a creature of that land.
  if (mode === 'moon' && !p.out && g.winner === null) {
    const star = 1 + Math.floor(rand(g) * 6);
    const w = g.board[p.at]!.world;
    say(g, { t: 'moment', seat: p.seat, kicker: 'THE MOON JUMP', title: star >= 5 && w ? 'A FALLING STAR' : 'A SOFT LANDING', text: `[[${p.seat}]] comes down and rolls ${star}.${star >= 5 && w ? ' Something rode the star down with them.' : ''}`, tone: star >= 5 && w ? 'gold' : '', dice: [star] }, 2);
    if (star >= 5 && w) yield* gain(g, p, makeTeam(g, w, 1)[0]!, 'power');
  }
  if (!p.out && p.hero.weak === 'seasick' && g.board[p.at]!.world === 'pirate' && p.deck.length) {
    news(g, `[[${p.seat}]] is seasick. A creature goes overboard.`, p.seat, 'bad');
    loseCreature(g, p, 'overboard');
  }
}

/**
 * v16 (owner: "kisi ki power over-powered na ho, kisi ki weakness bekaar na ho"; 2,000 4p matches: movement powers 18–20%, creature
 * powers 28–32%): a power that only moves you (and the Ringmaster's lions, measured weak) recharges every 2 turns.
 */
export const MOVERS = new Set(['moonJump', 'twoDice', 'lions']);
export const powerEvery = (p: { hero: { gift: string } }): number => (MOVERS.has(p.hero.gift) ? 2 : TUNE.powerEvery);
/** The hero's active power (ready every powerEvery turns). Returns how the roll that follows is made. */
function* usePower(g: Game, p: Player): Gen<RollMode> {
  const key = p.hero.gift;
  say(g, { t: 'power', seat: p.seat, key }, sec('power'));
  const rivals = others(g, p);
  const near = (n: number) => rivals.filter((q) => distance(g.board, q.at, p.at) <= n);
  switch (key) {
    case 'measure':
      return 'measure';
    case 'twoDice':
      return 'two';
    case 'moonJump':
      return 'moon';
    case 'flex': {
      // v16 (2,000 matches: the Strongman won 19%): he trains as he flexes. One creature never trained before gains +4 for good.
      const raw = p.deck.filter((o) => !(o.modName ?? '').includes('Trained'));
      if (raw.length) modify(g, p, strongest(raw), 'Trained', 4, p.seat);
      return 'flex';
    }
    case 'sleep':
      p.shieldTurn = p.turns;
      return 'roll';
    case 'dig': {
      const w = g.board[p.at]!.world ?? pickOne(g, g.petals);
      yield* gain(g, p, makeTeam(g, w, 1)[0]!, 'power');
      return 'roll';
    }
    case 'lions': {
      const q = yield* askTarget(g, p, 'lions', seatsOf(rivals));
      if (q) {
        const team = makeTeam(g, g.board[q.at]!.world ?? pickOne(g, g.petals));
        const out = yield* clashWild(g, q, team, q.at, 'unleash', p.seat);
        // v16 (3,000 matches: the Ringmaster won 19–22%): a pack that wins comes home, and one of its lions stays with him.
        if (out === 'lose' && !p.out && g.winner === null) yield* gain(g, p, team[0]!, 'power');
      }
      return 'roll';
    }
    case 'swapAny': {
      const q = yield* askTarget(g, p, 'swapAny', seatsOf(rivals));
      if (q) {
        [p.at, q.at] = [q.at, p.at];
        p.from = q.from = null;
        say(g, { t: 'swap', seat: p.seat, with: q.seat }, 3);
      }
      return 'roll';
    }
    case 'jar': {
      const pool = near(3).filter((q) => q.deck.length);
      if (!pool.length) {
        news(g, 'No rival within 3 steps. The jar stays empty.', p.seat);
        return 'roll';
      }
      const q = yield* askTarget(g, p, 'jar', seatsOf(pool));
      if (q && q.deck.length) {
        // v16: a jar is fragile. Roll 3 or more and the lid holds; less, and it shatters and the creature runs home.
        const roll = 1 + Math.floor(rand(g) * 6);
        say(g, { t: 'moment', seat: p.seat, kicker: 'THE JAR', title: roll >= 3 ? 'THE LID HOLDS' : 'THE JAR SHATTERS', text: `[[${p.seat}]] jars a creature of [[${q.seat}]] and rolls ${roll}.${roll >= 3 ? '' : ' It slips out and runs home.'}`, tone: roll >= 3 ? 'gold' : 'bad', dice: [roll] }, 2.5);
        if (roll >= 3) yield* handOver(g, q, p, pickOne(g, q.deck), 'stolen');
      }
      return 'roll';
    }
    case 'switch': {
      const pool = rivals.filter((q) => q.deck.length);
      if (!pool.length || !p.deck.length) {
        news(g, 'Nothing to switch. The salesman sulks.', p.seat);
        return 'roll';
      }
      const q = yield* askTarget(g, p, 'switch', seatsOf(pool));
      if (q) {
        const theirs = pickOne(g, q.deck);
        const mine = weakest(p.deck);
        // Take theirs first: at the hold limit they may release one, and it must never be the one already promised.
        yield* handOver(g, q, p, theirs, 'stolen');
        if (p.deck.includes(mine)) yield* handOver(g, p, q, mine, 'given');
      }
      return 'roll';
    }
    case 'slipper': {
      const q = yield* askTarget(g, p, 'slipper', seatsOf(rivals));
      if (q) {
        q.skip = true;
        q.skipWhy = 'slipper';
        news(g, `The slipper flies. [[${q.seat}]] will skip their next turn.`, q.seat, 'bad');
      }
      return 'roll';
    }
    case 'plunder': {
      const pool = near(2);
      if (!pool.length) {
        news(g, 'No rival within 2 steps. Nothing to plunder.', p.seat);
        return 'roll';
      }
      const q = yield* askTarget(g, p, 'plunder', seatsOf(pool));
      if (q) {
        // v15 (owner: "powers kisi ko overpowered na banayein"; 1,000 matches: the Captain won 38% of 4p): a blind grab, not the best.
        const o = q.deck.length ? pickOne(g, q.deck) : null;
        if (o) yield* handOver(g, q, p, o, 'stolen');
      }
      return 'roll';
    }
  }
  return 'roll';
}

/** A timed trial: press as the ring meets the mark, n times (0 miss · 1 good · 2 perfect; no answer counts as good). */
function* trial(g: Game, p: Player, card: string, n: number): Gen<number[]> {
  const a = yield* ask({ k: 'trial', seat: p.seat, card, n }, 'trial');
  const hits = Array.from({ length: n }, (_, i) => Math.max(0, Math.min(2, Math.round(a?.hits?.[i] ?? 1))));
  say(g, { t: 'trial', seat: p.seat, card, hits }, sec('trial'));
  return hits;
}

// Bets: laid on someone's NEXT battle; everyone watches that turn.
function wager(g: Game, card: string, by: Player, on: Player, call: 'win' | 'lose' | null, to?: Player): void {
  const w: Wager = { id: ++g.wagerId, card, by: by.seat, on: on.seat, call, ...(to ? { to: to.seat } : {}) };
  g.wagers.push(w);
  say(g, { t: 'wager', ...w }, sec('wager'));
}
function* settle(g: Game, seat: number, outcome: 'win' | 'lose' | 'standoff', spoils = true): Gen {
  const hero = g.players[seat]!;
  // v15 THE OATH STONE: a sworn ally shares every battle you win (a creature for them too; never for catching someone empty-handed).
  if (spoils && outcome === 'win' && !hero.out && g.winner === null)
    for (const [a, b] of g.allies) {
      const other = a === seat ? b : b === seat ? a : null;
      if (other === null || g.players[other]!.out) continue;
      const o = g.players[other]!;
      say(g, { t: 'moment', seat: other, kicker: 'THE OATH STONE', title: 'AN ALLY SHARES THE SPOILS', text: `[[${seat}]] won a battle. Their sworn ally [[${other}]] gains a creature too.`, tone: 'gold' }, 2);
      yield* gain(g, o, makeTeam(g, g.board[o.at]!.world ?? pickOne(g, g.petals), 1)[0]!, 'gift');
    }
  if (outcome === 'win' && g.pot.length && !hero.out && g.winner === null) {
    const pot = g.pot;
    g.pot = [];
    say(g, { t: 'moment', seat, kicker: 'THE SWEEPSTAKE', title: 'THE POT IS TAKEN', text: `[[${seat}]] wins a battle and takes the whole pot: ${pot.length} creature${pot.length > 1 ? 's' : ''}.`, tone: 'gold' }, 3);
    for (const cid of pot) yield* gain(g, hero, cid, 'wager');
  }
  if (hero.loan && outcome !== 'standoff' && !hero.out) {
    hero.loan = false;
    if (outcome === 'win') say(g, { t: 'moment', seat, kicker: 'THE LOAN SHARK', title: 'PAID IN FULL', text: `[[${seat}]] won the battle. The shark smiles and swims away.`, tone: 'gold' }, 2.5);
    else {
      say(g, { t: 'moment', seat, kicker: 'THE LOAN SHARK', title: 'THE SHARK COLLECTS', text: `[[${seat}]] lost the battle. The shark takes a heart.`, tone: 'bad' }, 2.5);
      loseHeart(g, hero, 'bet', null);
    }
  }
  const due = g.wagers.filter((w) => w.on === seat);
  if (!due.length) return;
  g.wagers = g.wagers.filter((w) => w.on !== seat);
  for (const w of due) {
    const by = g.players[w.by]!;
    const on = g.players[w.on]!;
    if (by.out || outcome === 'standoff' || g.winner !== null) {
      say(g, { t: 'wagerEnd', id: w.id, card: w.card, by: w.by, on: w.on, result: 'void' }, 2);
      continue;
    }
    const won = outcome === 'win';
    const good = w.card === 'prophet' || w.card === 'empty' || w.card === 'emptyLife' || w.card === 'crowd' ? (w.call === 'win') === won : FOR.has(w.card) ? won : !won;
    // (The Dark Pact pays nobody: their win breaks the chain quietly, their loss drags you both.)
    say(g, { t: 'wagerEnd', id: w.id, card: w.card, by: w.by, on: w.on, result: w.card === 'darkPact' ? (won ? 'void' : 'lose') : good ? 'win' : 'lose' }, sec('wager'));
    switch (w.card) {
      case 'longOdds': {
        const [from, to] = won ? [by, on] : [on, by];
        const o = topOf(from);
        if (o && !to.out) yield* handOver(g, from, to, o, 'wager');
        break;
      }
      case 'bloodWager':
        if (won) loseHeart(g, by, 'bet', null);
        else if (!heal(g, by, 'chance')) news(g, `[[${by.seat}]] is already whole. The blood runs dry.`, by.seat);
        break;
      case 'cutCrown':
        if (won) loseHeart(g, by, 'bet', null);
        else loseHeart(g, on, 'bet', null);
        break;
      case 'prophet':
        if (good) yield* gain(g, by, drawRare(g), 'wager');
        else if (!loseCreature(g, by, 'wager', 'strongest')) loseHeart(g, by, 'bet', null);
        break;
      case 'unholy':
      case 'hitch':
        // You rode their win: mostly a creature, rarely a heart. Their loss drags you down with them.
        if (won) {
          if (by.hearts < TUNE.hearts && rand(g) < TUNE.rideHeart) heal(g, by, 'chance');
          else yield* gain(g, by, makeTeam(g, g.board[on.at]!.world ?? pickOne(g, g.petals), 1)[0]!, 'wager');
        } else {
          const o = topOf(by);
          if (o) {
            if (w.card === 'hitch' && !on.out) yield* handOver(g, by, on, o, 'wager');
            else loseCreature(g, by, 'wager', 'strongest');
          }
        }
        break;
      case 'shared':
        // Shared fate: whatever they win, you win; whatever they lose, you lose.
        if (won) yield* gain(g, by, makeTeam(g, g.board[on.at]!.world ?? pickOne(g, g.petals), 1)[0]!, 'wager');
        else if (!loseCreature(g, by, 'wager')) loseHeart(g, by, 'bet', on.seat);
        break;
      case 'empty':
        if (good) {
          const o = w.call === 'lose' ? topOf(on) : null;
          if (o && !on.out) yield* handOver(g, on, by, o, 'wager');
          else yield* gain(g, by, makeTeam(g, g.board[on.at]!.world ?? pickOne(g, g.petals), 1)[0]!, 'wager');
        } else loseHeart(g, by, 'bet', on.seat);
        break;
      case 'emptyLife':
        // The Last Gamble, all in: right, two creatures and a heart; wrong, the whole life (only Death's Door can answer).
        if (good) {
          for (let k = 0; k < 2 && !by.out; k++) yield* gain(g, by, makeTeam(g, g.board[on.at]!.world ?? pickOne(g, g.petals), 1)[0]!, 'wager');
          heal(g, by, 'chance');
        } else {
          say(g, { t: 'moment', seat: by.seat, kicker: 'THE LAST GAMBLE', title: 'ALL IN, AND LOST', text: `[[${by.seat}]] staked their life on [[${on.seat}]]'s battle, and called it wrong.`, tone: 'bad' }, 3);
          for (let k = 0; k < 4 && !by.out && by.hearts > 0; k++) {
            const door = by.doorUsed;
            loseHeart(g, by, 'allIn', null);
            if (!door && by.doorUsed && !by.out) break; // Death's Door answered: they stand, by a hair.
          }
        }
        break;
      case 'crowd':
        // The Colosseum: the crowd called it. Right: a creature from the stands. Wrong: their weakest runs off.
        if (good) yield* gain(g, by, makeTeam(g, g.board[on.at]!.world ?? pickOne(g, g.petals), 1)[0]!, 'wager');
        else loseCreature(g, by, 'wager');
        break;
      case 'mirror': {
        // Your result, reflected on the one you named: you win, they lose their top creature; you lose, they gain one.
        const t = w.to !== undefined ? g.players[w.to]! : null;
        if (!t || t.out) break;
        if (won) {
          if (!loseCreature(g, t, 'wager', 'strongest')) news(g, `[[${t.seat}]] has nothing for the mirror to take.`, t.seat);
        } else yield* gain(g, t, makeTeam(g, g.board[t.at]!.world ?? pickOne(g, g.petals), 1)[0]!, 'wager');
        break;
      }
      case 'darkPact':
        // v15 THE DARK PACT: they lost their battle; the chain pulls you both down a heart.
        if (!won) {
          loseHeart(g, on, 'bet', by.seat);
          loseHeart(g, by, 'bet', null);
        }
        break;
      case 'pact': {
        // The Blood Pact: you and the one you named share your result. Win: a creature each. Lose: a heart each.
        const t = w.to !== undefined ? g.players[w.to]! : null;
        if (won) {
          yield* gain(g, by, makeTeam(g, g.board[by.at]!.world ?? pickOne(g, g.petals), 1)[0]!, 'wager');
          if (t && !t.out) yield* gain(g, t, makeTeam(g, g.board[t.at]!.world ?? pickOne(g, g.petals), 1)[0]!, 'wager');
        } else {
          loseHeart(g, by, 'bet', null);
          if (t && !t.out) loseHeart(g, t, 'bet', by.seat);
        }
        break;
      }
      case 'doubleNothing':
        if (won) {
          const pool = others(g, by).filter((q) => q.deck.length);
          const q = yield* askTarget(g, by, 'double', seatsOf(pool));
          const o = q ? topOf(q) : null;
          if (q && o) yield* handOver(g, q, by, o, 'wager');
        } else loseHeart(g, by, 'bet', null);
        break;
    }
  }
}

// The ticking bomb: hot potato. Passed to anyone within 2 steps at the end of the holder's turn; explodes at a round's end.
function giveBomb(g: Game, to: Player, from: Player | null): void {
  g.bomb = { holder: to.seat, round: g.bomb?.round ?? g.round + 1 };
  say(g, { t: 'bomb', seat: to.seat, from: from?.seat ?? null, round: g.bomb.round }, sec('bomb'));
}
function* passBomb(g: Game, p: Player): Gen {
  if (!g.bomb || g.bomb.holder !== p.seat || p.out) return;
  const near = others(g, p).filter((q) => distance(g.board, q.at, p.at) <= 2);
  if (!near.length) return;
  const q = yield* askTarget(g, p, 'bomb', seatsOf(near));
  if (q) giveBomb(g, q, p);
}
function boom(g: Game): void {
  if (!g.bomb || g.round < g.bomb.round) return;
  const h = g.players[g.bomb.holder]!;
  g.bomb = null;
  if (h.out) return;
  say(g, { t: 'boom', seat: h.seat }, sec('bomb'));
  loseHeart(g, h, 'bomb', null);
}

// The world boss: wakes far from everyone, walks toward the nearest hero, one shared health bar, the last hit takes it.
function* bossWakes(g: Game, now = false): Gen {
  if (g.boss || g.bossDone || g.lastLight || (!now && progress(g) < TUNE.bossAt)) return;
  const live = alive(g);
  const legends = CREATURES.filter((c) => c.rarity === 'legendary' && g.bag[c.world].includes(c.id));
  const c = pickOne(g, legends.length ? legends : CREATURES.filter((x) => x.rarity === 'legendary'));
  const spots = open(g).filter((s) => s.id !== CENTRE && !live.some((q) => q.at === s.id));
  if (!spots.length) return;
  takeFromBag(g, c.id);
  const gap = (id: number) => Math.min(...live.map((q) => distance(g.board, id, q.at)));
  const far = spots.reduce((a, b) => (gap(b.id) > gap(a.id) ? b : a));
  const max = TUNE.bossHp.base + TUNE.bossHp.perSeat * g.players.length;
  g.boss = { cid: c.id, at: far.id, hp: max, max, prey: null, rest: false, last: null };
  say(g, { t: 'boss', cid: c.id, at: far.id, hp: max, max }, sec('boss'));
}
/**
 * v14 THE HUNT (owner: "boss wali cheez… like a hunter, jisse bachne ki strategy bhi ho sakti hai luck bhi; if tumne jidhar land
 * karna ye bhi udhar kar gya toh fir toh chalo"). At the end of every round the beast names its prey (the nearest hero; ties by
 * lot; never the one it just fought) and rolls its own die in front of everyone, then runs that many steps toward them. If it
 * reaches its prey, they fight. If it stops on anyone else, wrong place, wrong time: they fight. Strategy: keep more than six
 * steps away, shelter under a tree, or hunt it yourself for its legend. Luck: its die. After a fight it rests one round.
 */
function* bossWalks(g: Game): Gen {
  const b = g.boss;
  if (!b || g.winner !== null) return;
  if (g.board[b.at]!.void) {
    b.at = nearestOpen(g, b.at);
    say(g, { t: 'bossStep', to: b.at }, 0.8);
  }
  const live = alive(g);
  if (live.length < 2) return;
  // v15 (fun review: "no constraint forcing equal"): it hunts the nearest, ties by lot; the rest after a fight is the only mercy.
  const marked = b.marked != null ? live.find((q) => q.seat === b.marked) : undefined;
  const prey = marked ?? fair(g, live).reduce((a, x) => (distance(g.board, b.at, x.at) < distance(g.board, b.at, a.at) ? x : a));
  b.prey = prey.seat;
  if (b.rest) {
    b.rest = false;
    say(g, { t: 'bossHunt', prey: prey.seat, roll: 0, rest: true }, 2);
    return;
  }
  // The rested beast forgets its last fight (it may hunt them again later, never twice in a row) and spends any mark.
  b.marked = null;
  b.last = null;
  const roll = 1 + Math.floor(rand(g) * 6);
  say(g, { t: 'bossHunt', prey: prey.seat, roll, rest: false }, 2.5);
  for (let k = 0; k < roll && b.at !== prey.at; k++) {
    // Around the fire if it can; across it if that is the only road left (the prey is never safe just because land was eaten).
    const nx = towards(g.board, b.at, (x) => x.id === prey.at, CENTRE) ?? towards(g.board, b.at, (x) => x.id === prey.at);
    if (nx === null) break;
    b.at = nx;
    say(g, { t: 'bossStep', to: nx }, 0.8);
  }
  if (treeAt(g, b.at)) return;
  const here = live.filter((q) => q.at === b.at);
  const victim = here.includes(prey) ? prey : here.length ? pickOne(g, here) : null;
  if (victim) yield* bossFight(g, victim);
}
function* bossFight(g: Game, p: Player): Gen {
  const b = g.boss;
  if (!b) return;
  g.lastWon = 0;
  // It rests after every fight, and its next hunt is someone else (no hero is chased twice in a row).
  b.rest = true;
  b.last = p.seat;
  if (!drawHand(g, p, true).length) {
    if (p.deck.length) news(g, `[[${p.seat}]]'s creatures are too tired to fight. The beast sniffs, and turns away.`, p.seat);
    else yield* chase(g, p, 'the beast', null);
    return;
  }
  const out = yield* clashWild(g, p, [b.cid, ...makeTeam(g, creature(b.cid).world, 2)], p.at, 'boss', null);
  if (g.boss !== b || (out === 'standoff' && g.lastWon === 0)) return;
  const dmg = g.lastWon;
  b.hp = Math.max(0, b.hp - dmg);
  if (b.hp > 0) {
    say(g, { t: 'bossHit', seat: p.seat, dmg, hp: b.hp, max: b.max }, sec('bossHit'));
    return;
  }
  g.boss = null;
  g.bossDone = true;
  say(g, { t: 'bossDown', seat: p.seat, cid: b.cid }, sec('boss'));
  if (p.out) return;
  yield* gain(g, p, b.cid, 'boss');
  heal(g, p, 'boss');
}

/** Stampedes cross a land: every hero on it must dodge twice; each hit takes a creature (a heart if none are left). */
function* stampedes(g: Game): Gen {
  if (g.lastLight || progress(g) < TUNE.stampedeAt || rand(g) >= TUNE.stampedeChance) return;
  const lands = g.petals.filter((w) => g.weather[w] !== 'sun' && alive(g).some((q) => g.board[q.at]!.world === w));
  if (!lands.length) return;
  const w = pickOne(g, lands);
  const caught = alive(g).filter((q) => g.board[q.at]!.world === w);
  say(g, { t: 'stampede', world: w, seats: seatsOf(caught) }, sec('stampede'));
  for (const q of caught) {
    if (q.out || alive(g).length <= 1) continue;
    const hits = yield* trial(g, q, 'stampedeWorld', 2);
    for (const h of hits) if (h === 0) strike(g, q, 'trial');
  }
}

/** A chance card: drawn on every place that holds nothing else, and obeyed. */
function* drawChance(g: Game, p: Player): Gen {
  // v13 (owner: "jaise real ludo die cards mein no biasness"): ONE copy of every card, shuffled like a real deck; nothing
  // comes twice until the whole deck has gone round. The two jackpots (a Miracle, the Pharaoh's Curse) stay rare in the open:
  // when one turns up, a 1-in-3 roll decides whether it holds, or the next card is turned instead.
  const next = () => {
    if (!g.chance.length) g.chance = shuffled(g, CHANCES.flatMap((c) => Array.from({ length: c.w }, () => c.id)));
    return g.chance.pop()!;
  };
  let id = next();
  for (let k = 0; k < 4 && (id === 'miracle' || id === 'pharaoh') && rand(g) >= TUNE.jackpotHolds; k++) id = next();
  say(g, { t: 'chance', seat: p.seat, card: id }, sec('chance'));
  yield* doChance(g, p, id);
  // The Palm Reader tells everyone: the next player draws one too.
  if (p.hero.weak === 'tellsEveryone' && !g.telling && !p.out && g.winner === null && alive(g).length > 1) {
    const q = leftOf(g, p);
    if (q !== p) {
      g.telling = true;
      news(g, `[[${p.seat}]] tells everyone. [[${q.seat}]] draws a chance card too.`, q.seat);
      yield* drawChance(g, q);
      g.telling = false;
    }
  }
}
function* doChance(g: Game, p: Player, id: string): Gen {
  const rivals = others(g, p);
  const withDeck = (xs: Player[]) => xs.filter((x) => x.deck.length);
  const wild = (q: Player) => makeTeam(g, g.board[q.at]!.world ?? pickOne(g, g.petals));
  if (!rivals.length && !['ambush', 'rollAgain', 'jar', 'tea', 'ropeBridge', 'stampede', 'feather', 'relic', 'hex', 'quake', 'portal', 'unknown', 'loadedDie', 'legendFalls', 'demon', 'coin', 'allIn'].includes(id)) {
    news(g, 'The card finds no one else. It crumbles.', p.seat);
    return;
  }
  switch (id) {
    case 'longOdds':
    case 'bloodWager':
    case 'unholy':
    case 'shared':
      wager(g, id, p, leftOf(g, p), null);
      return;
    case 'hitch': {
      // v16 (owner: "game apna dimaag na rakhe"): no card aims at the leader by itself; you choose whose ride to hitch.
      const q = (yield* askTarget(g, p, 'hitch', seatsOf(rivals))) ?? pickOne(g, rivals);
      wager(g, id, p, q, null);
      return;
    }
    case 'vulture':
      g.vultures = g.vultures.filter((v) => v.by !== p.seat);
      g.vultures.push({ by: p.seat, until: p.turns + 1 });
      news(g, `[[${p.seat}]] circles like a vulture. Until their next turn, whoever loses a heart loses their top creature to them.`, p.seat, 'gold', 3);
      return;
    case 'cutCrown': {
      const q = (yield* askTarget(g, p, 'cutCrown', seatsOf(rivals))) ?? pickOne(g, rivals);
      wager(g, id, p, q, null);
      return;
    }
    case 'prophet': {
      const q = yield* askTarget(g, p, 'prophet', seatsOf(alive(g)));
      if (!q) return;
      const a = yield* ask({ k: 'predict', seat: p.seat, on: q.seat }, 'yes');
      wager(g, id, p, q, a?.yes === false ? 'lose' : 'win');
      return;
    }
    case 'doubleNothing':
      wager(g, id, p, p, null);
      return;
    case 'mirror':
    case 'pact': {
      const q = (yield* askTarget(g, p, id, seatsOf(rivals))) ?? pickOne(g, rivals);
      wager(g, id, p, p, null, q);
      return;
    }
    case 'bounty': {
      const q = (yield* askTarget(g, p, 'bounty', seatsOf(rivals))) ?? pickOne(g, rivals);
      g.bounties = g.bounties.filter((b) => b.on !== q.seat);
      g.bounties.push({ on: q.seat, by: p.seat });
      say(g, { t: 'bounty', on: q.seat, by: p.seat, claimed: null }, 2.5);
      return;
    }
    case 'deadman':
      g.switches = g.switches.filter((x) => x.seat !== p.seat);
      g.switches.push({ seat: p.seat, until: p.turns + 1 });
      news(g, `[[${p.seat}]] arms the Dead Man's Switch. Until their next turn ends, whoever takes their heart loses one too.`, p.seat, 'gold', 3);
      return;
    case 'miracle': {
      // The royal flush: a heart AND a legend, the rarest card in the deck.
      if (!heal(g, p, 'chance')) news(g, `[[${p.seat}]] is already whole. The miracle pours into the legend instead.`, p.seat, 'gold');
      const legends = CREATURES.filter((c) => c.rarity === 'legendary' && g.bag[c.world].includes(c.id));
      const cid = legends.length ? pickOne(g, legends).id : drawRare(g);
      takeFromBag(g, cid);
      yield* gain(g, p, cid, 'gift');
      return;
    }
    case 'teeth':
      yield* dragonTeeth(g, p);
      return;
    case 'market':
      yield* blackMarket(g, p);
      return;
    case 'war':
      yield* championWar(g, p, rivals);
      return;
    case 'colosseum': {
      // Your next battle is a show: every other hero must call it, out loud, now.
      say(g, { t: 'moment', seat: p.seat, kicker: 'THE COLOSSEUM', title: 'THE CROWD MUST CALL IT', text: `Every other hero calls [[${p.seat}]]'s next battle: WIN or LOSE. Right: a creature. Wrong: their weakest runs off.`, tone: 'gold' }, 3);
      for (const q of rivals) {
        const a = yield* ask({ k: 'predict', seat: q.seat, on: p.seat }, 'yes');
        wager(g, 'crowd', q, p, a?.yes === false ? 'lose' : 'win');
      }
      return;
    }
    case 'sweepstake': {
      // Everyone throws their weakest into the pot; the next hero to win any battle takes it all.
      const live = alive(g).filter((q) => q.deck.length);
      for (const q of live) {
        const o = weakest(q.deck);
        q.deck = q.deck.filter((x) => x !== o);
        say(g, { t: 'lost', seat: q.seat, cid: o.cid, why: 'wager' }, 1);
        g.pot.push(o.cid);
      }
      say(g, { t: 'moment', seat: p.seat, kicker: 'THE SWEEPSTAKE', title: `${g.pot.length} IN THE POT`, text: 'Everyone threw in their weakest. The next hero to win a battle, anywhere, takes the whole pot.', tone: 'gold' }, 3);
      return;
    }
    case 'insurance': {
      const a = yield* ask({ k: 'choice', seat: p.seat, title: 'The Insurance', sub: 'Pay your weakest creature now. The next heart you would lose, the policy pays instead.', options: ['Buy the policy', 'Walk away'], def: 1 }, 'pick');
      if (a?.i === 1 || !p.deck.length) return;
      loseCreature(g, p, 'fee');
      p.insured = true;
      say(g, { t: 'moment', seat: p.seat, kicker: 'THE INSURANCE', title: 'INSURED', text: '[[' + p.seat + ']] is covered: the next lost heart is paid by the policy.', tone: 'gold' }, 2);
      return;
    }
    case 'loan': {
      const a = yield* ask({ k: 'choice', seat: p.seat, title: 'The Loan Shark', sub: 'A rare creature, right now. But you must WIN your next battle, or the shark takes a heart.', options: ['Take the loan', 'Walk away'], def: 1 }, 'pick');
      if (a?.i !== 0) return;
      p.loan = true;
      yield* gain(g, p, drawRare(g), 'wager');
      return;
    }
    case 'oracleDie': {
      const a = yield* ask({ k: 'choice', seat: p.seat, title: "The Oracle's Number", sub: 'Name the number the die will show. Exact: a legend. One off: a creature. Further: your weakest is lost.', options: ['1', '2', '3', '4', '5', '6'], def: 2 }, 'pick');
      const guess = (a?.i ?? 2) + 1;
      const roll = 1 + Math.floor(rand(g) * 6);
      const off = Math.abs(roll - guess);
      say(g, { t: 'moment', seat: p.seat, kicker: "THE ORACLE'S NUMBER", title: off === 0 ? 'EXACTLY!' : off === 1 ? 'SO CLOSE' : 'NOT EVEN NEAR', text: `[[${p.seat}]] called ${guess}. The die shows ${roll}.`, tone: off === 0 ? 'gold' : off === 1 ? '' : 'bad', dice: [roll] }, 3);
      if (off === 0) yield* gain(g, p, drawLegend(g), 'gamble');
      else if (off === 1) yield* gain(g, p, makeTeam(g, g.board[p.at]!.world ?? pickOne(g, g.petals), 1)[0]!, 'gamble');
      else loseCreature(g, p, 'gamble');
      return;
    }
    case 'stairs':
      yield* gamblerStairs(g, p);
      return;
    case 'whistle': {
      const b = g.boss;
      // The beast never runs at the hero it just fought.
      const pool = b ? rivals.filter((x) => x.seat !== b.last) : rivals;
      if (!pool.length) {
        news(g, 'The beast will not turn on the one it just fought. The whistle echoes away.', p.seat);
        return;
      }
      const q = (yield* askTarget(g, p, 'whistle', seatsOf(pool))) ?? pickOne(g, pool);
      breakOath(g, p, q);
      if (!b) {
        news(g, `No beast walks the world yet. A wild pack answers the whistle and runs at [[${q.seat}]].`, q.seat, 'bad');
        yield* clashWild(g, q, wild(q), q.at, 'unleash', p.seat);
        return;
      }
      b.marked = q.seat;
      if (b.rest) {
        news(g, `The beast is resting. Its next hunt is [[${q.seat}]].`, q.seat, 'bad');
        return;
      }
      yield* bossWalks(g);
      return;
    }
    case 'melee': {
      const ins = fair(g, alive(g).filter((q) => q.deck.length));
      if (ins.length < 2) {
        news(g, 'Too few champions for a melee. The ring stays empty.', p.seat);
        return;
      }
      const stat = pickOne(g, STATS);
      const thrown = ins.map((q) => ({ q, o: topOf(q)!, v: fighter(topOf(q)!).stats[stat] }));
      const best = Math.max(...thrown.map((x) => x.v));
      const top = thrown.filter((x) => x.v === best);
      const list = thrown.map((x) => `[[${x.q.seat}]] ${creature(x.o.cid).name.split(',')[0]} ${x.v}`).join(' · ');
      const w = top.length === 1 ? top[0]!.q : null;
      // v15 (fun review: taking all of them is a reversal so big that playing well feels pointless): the best of the rest only.
      const prize = w ? thrown.filter((x) => x.q !== w).sort((x, y) => power(y.o) - power(x.o))[0] : undefined;
      say(g, { t: 'moment', seat: p.seat, kicker: 'THE GRAND MELEE', title: w ? `${stat}: ONE CHAMPION STANDS` : `${stat}: A TIE AT THE TOP`, text: `${list}. ${w && prize ? `[[${w.seat}]] claims the best of the rest, from [[${prize.q.seat}]].` : 'Everyone takes their own back.'}`, tone: w === p ? 'gold' : w ? 'bad' : '' }, 4);
      if (w && prize && prize.q.deck.includes(prize.o)) yield* handOver(g, prize.q, w, prize.o, 'stolen');
      return;
    }
    case 'demon': {
      if (p.demon !== null) {
        news(g, 'The demon already holds your marker. It only smiles.', p.seat);
        return;
      }
      const a = yield* ask({ k: 'choice', seat: p.seat, title: 'The Crossroads Demon', sub: 'A legendary creature, right now. In two rounds the demon comes back: roll 4 or more, or it takes a heart.', options: ['Shake the hand', 'Walk away'], def: 1 }, 'pick');
      if (a?.i !== 0) return;
      p.demon = g.round + 2;
      yield* gain(g, p, drawLegend(g), 'gamble');
      return;
    }
    case 'coin': {
      const a = yield* ask({ k: 'choice', seat: p.seat, title: 'Heads or Tails', sub: 'Call it. Right: a creature of this land. Wrong: your weakest runs off.', options: ['Heads', 'Tails'], def: 0 }, 'pick');
      const call = a?.i === 1 ? 1 : 0;
      const side = rand(g) < 0.5 ? 0 : 1;
      const right = call === side;
      say(g, { t: 'moment', seat: p.seat, kicker: 'HEADS OR TAILS', title: `${side ? 'TAILS' : 'HEADS'}. ${right ? 'CALLED IT' : 'WRONG CALL'}`, text: `[[${p.seat}]] called ${call ? 'tails' : 'heads'}.`, tone: right ? 'gold' : 'bad' }, 2.5);
      if (right) yield* gain(g, p, makeTeam(g, g.board[p.at]!.world ?? pickOne(g, g.petals), 1)[0]!, 'gamble');
      else loseCreature(g, p, 'gamble');
      return;
    }
    case 'hill': {
      const live = alive(g);
      let rolls = live.map(() => 1 + Math.floor(rand(g) * 6));
      // Ties at the top or the bottom roll again (at most five times; still tied: nobody pays).
      for (let k = 0; k < 5; k++) {
        const hi = Math.max(...rolls);
        const lo = Math.min(...rolls);
        if (rolls.filter((r) => r === hi).length === 1 && rolls.filter((r) => r === lo).length === 1) break;
        rolls = live.map(() => 1 + Math.floor(rand(g) * 6));
      }
      const hi = Math.max(...rolls);
      const lo = Math.min(...rolls);
      const ok = hi !== lo && rolls.filter((r) => r === hi).length === 1 && rolls.filter((r) => r === lo).length === 1;
      const w = live[rolls.indexOf(hi)]!;
      const l = live[rolls.indexOf(lo)]!;
      const list = live.map((q, i) => `[[${q.seat}]] ${rolls[i]}`).join(' · ');
      say(g, { t: 'moment', seat: p.seat, kicker: 'KING OF THE HILL', title: ok ? 'ONE STANDS TALL' : 'NOBODY HOLDS THE HILL', text: `${list}. ${ok ? `[[${w.seat}]] takes the top creature of [[${l.seat}]].` : 'Still tied. Nobody pays.'}`, tone: ok && w === p ? 'gold' : ok && l === p ? 'bad' : '', dice: rolls }, 4);
      if (ok && topOf(l)) yield* handOver(g, l, w, topOf(l)!, 'stolen');
      return;
    }
    case 'pickpocket': {
      const pool = rivals.filter((q) => q.deck.length);
      if (!pool.length || !p.deck.length) {
        news(g, p.deck.length ? 'Every pocket is empty. The pickpocket moves on.' : 'A pickpocket with empty pockets has nothing to risk. The card is laughed off.', p.seat);
        return;
      }
      const q = (yield* askTarget(g, p, 'pickpocket', seatsOf(pool))) ?? pickOne(g, pool);
      // v15: a face-off, not a target number: both roll, the higher hand wins; a tie and both walk off whistling.
      const ra = 1 + Math.floor(rand(g) * 6);
      const rb = 1 + Math.floor(rand(g) * 6);
      const ok = ra > rb;
      say(g, { t: 'moment', seat: p.seat, kicker: 'THE PICKPOCKET', title: ra === rb ? 'BOTH FREEZE' : ok ? 'CLEAN LIFT' : 'CAUGHT RED-HANDED', text: `[[${p.seat}]] rolls ${ra}, [[${q.seat}]] rolls ${rb}.${ra === rb ? ' Nobody moves. They walk off whistling.' : ''}`, tone: ra === rb ? '' : ok ? 'gold' : 'bad', dice: [ra, rb] }, 3);
      if (ra === rb) return;
      const [from, to] = ok ? [q, p] : [p, q];
      if (topOf(from)) yield* handOver(g, from, to, topOf(from)!, 'stolen');
      return;
    }
    case 'allIn': {
      const a = yield* ask({ k: 'choice', seat: p.seat, title: 'All In', sub: `Stake a heart on one die. 4 or more: gain a heart${p.hearts >= TUNE.hearts ? ' (you are whole: a legend instead)' : ''}. 3 or less: the heart is gone.`, options: ['All in', 'Fold'], def: 1 }, 'pick');
      if (a?.i !== 0) return;
      const roll = 1 + Math.floor(rand(g) * 6);
      say(g, { t: 'moment', seat: p.seat, kicker: 'ALL IN', title: roll >= 4 ? 'THE TABLE PAYS' : 'THE HOUSE WINS', text: `[[${p.seat}]] rolls ${roll}.`, tone: roll >= 4 ? 'gold' : 'bad', dice: [roll] }, 3);
      if (roll < 4) loseHeart(g, p, 'chance', null);
      else if (!heal(g, p, 'chance')) yield* gain(g, p, drawLegend(g), 'gamble');
      return;
    }
    case 'volcano': {
      if (!p.deck.length) return;
      const o = weakest(p.deck);
      const a = yield* ask({ k: 'choice', seat: p.seat, title: 'Feed the Volcano', sub: `Throw ${creature(o.cid).name.split(',')[0]} into the fire? Roll 4 or more and the fire gives back a rare creature. Less, and it is simply gone.`, options: ['Throw it in', 'Keep it'], def: 1 }, 'pick');
      if (a?.i !== 0) return;
      p.deck = p.deck.filter((x) => x !== o);
      say(g, { t: 'lost', seat: p.seat, cid: o.cid, why: 'void' }, 1.5);
      const roll = 1 + Math.floor(rand(g) * 6);
      say(g, { t: 'moment', seat: p.seat, kicker: 'FEED THE VOLCANO', title: roll >= 4 ? 'THE FIRE GIVES BACK' : 'THE FIRE KEEPS IT', text: `[[${p.seat}]] rolls ${roll}.`, tone: roll >= 4 ? 'gold' : 'bad', dice: [roll] }, 3);
      if (roll >= 4) yield* gain(g, p, drawRare(g), 'gamble');
      return;
    }
    case 'diceDuel': {
      const pool = rivals.filter((q) => q.deck.length);
      if (!pool.length || !p.deck.length) {
        news(g, 'Nobody has a creature to stake. The dice stay in the cup.', p.seat);
        return;
      }
      const q = (yield* askTarget(g, p, 'quick', seatsOf(pool))) ?? pickOne(g, pool);
      const d = () => 1 + Math.floor(rand(g) * 6);
      const [a1, a2, b1, b2] = [d(), d(), d(), d()];
      const [sa, sb] = [a1 + a2, b1 + b2];
      const [w, l] = sa > sb ? [p, q] : sb > sa ? [q, p] : [null, null];
      say(g, { t: 'moment', seat: p.seat, kicker: 'THE DICE DUEL', title: w ? `${sa} AGAINST ${sb}` : `${sa} AGAINST ${sb}: A DRAW`, text: w ? `[[${w.seat}]] takes the top creature of [[${l!.seat}]].` : 'Nobody wins. Nobody pays.', tone: w === p ? 'gold' : w ? 'bad' : '', dice: [a1, a2, b1, b2] }, 3.5);
      if (w && l && topOf(l)) yield* handOver(g, l, w, topOf(l)!, 'stolen');
      return;
    }
    case 'pharaoh':
      // The catastrophe, just as rare: the tomb keeps everything but your best.
      // (Bounded: a guarded deck would refuse forever.)
      for (let k = p.deck.length - 1; k > 0 && p.deck.length > 1; k--) loseCreature(g, p, 'void', 'weakest', p.deck.filter((o) => o !== strongest(p.deck)));
      return;
    case 'bomb': {
      if (g.bomb) {
        const h = g.players[g.bomb.holder]!;
        if (h !== p) {
          news(g, `The bomb finds its way to [[${p.seat}]].`, p.seat, 'bad');
          giveBomb(g, p, h);
        }
        return;
      }
      const q = yield* askTarget(g, p, 'bomb', seatsOf(rivals));
      if (q) giveBomb(g, q, p);
      return;
    }
    case 'curse': {
      const q = yield* askTarget(g, p, 'curse', seatsOf(rivals));
      if (q) {
        q.curse = true;
        say(g, { t: 'curse', seat: q.seat, by: p.seat }, sec('bomb'));
      }
      return;
    }
    case 'scent': {
      const q = yield* askTarget(g, p, 'scent', seatsOf(rivals));
      if (!q) return;
      const h = g.hunters[0];
      if (h) {
        h.prey = q.seat;
        news(g, `The hunters turn their heads. They smell [[${q.seat}]] now.`, q.seat, 'bad');
      } else if (!g.lastLight) {
        const ring = open(g).filter((s) => s.id !== CENTRE && distance(g.board, s.id, q.at) === 3);
        const at = ring.length ? pickOne(g, ring).id : nearestOpen(g, q.at);
        loose(g, makeTeam(g, g.board[at]!.world ?? pickOne(g, g.petals), 2), at, q, 'wake');
      } else news(g, 'The Last Light burns. No beast dares to hunt.', q.seat);
      return;
    }
    case 'kingmaker': {
      const pool = withDeck(rivals);
      if (!pool.length) {
        news(g, 'No one has a creature to give. The crown rolls away.', p.seat);
        return;
      }
      const from = yield* askTarget(g, p, 'kingFrom', seatsOf(pool));
      if (!from) return;
      const tos = rivals.filter((x) => x !== from);
      if (!tos.length) {
        loseCreature(g, from, 'void', 'strongest');
        return;
      }
      const to = yield* askTarget(g, p, 'kingTo', seatsOf(tos));
      const o = topOf(from);
      if (to && o) yield* handOver(g, from, to, o, 'given');
      return;
    }
    case 'toll': {
      const pool = withDeck(rivals);
      const q = pool.length ? yield* askTarget(g, p, 'toll', seatsOf(pool)) : null;
      if (q) loseCreature(g, q, 'void', 'strongest');
      else news(g, 'No one has anything to pay. The bridge sulks.', p.seat);
      return;
    }
    case 'chalice': {
      const top = topOf(p);
      let i = 0;
      if (top) {
        const a = yield* ask({ k: 'pick', seat: p.seat, why: 'chalice', options: ['Drink: lose a heart', 'Refuse: give away your top creature'] }, 'pick');
        i = a?.i === 1 ? 1 : 0;
      }
      if (i === 0) loseHeart(g, p, 'chance', null);
      else {
        const q = yield* askTarget(g, p, 'chalice', seatsOf(rivals));
        if (q && top) yield* handOver(g, p, q, top, 'given');
      }
      return;
    }
    case 'giftMust': {
      const q = yield* askTarget(g, p, 'gift', seatsOf(rivals));
      if (q) yield* gain(g, q, drawRare(g), 'gift');
      return;
    }
    case 'heartTax': {
      if (p.hearts >= 2) {
        const hurt = rivals.filter((x) => x.hearts < TUNE.hearts);
        const q = yield* askTarget(g, p, 'heartTax', seatsOf(hurt.length ? hurt : rivals));
        if (!q) return;
        const before = p.hearts;
        loseHeart(g, p, 'chance', q.seat);
        if (p.hearts < before && !heal(g, q, 'chance')) news(g, `[[${q.seat}]] is already whole. The heart drifts away.`, q.seat);
      } else {
        const top = topOf(p);
        if (!top) {
          news(g, 'Nothing left to tax. The collector leaves, disappointed.', p.seat);
          return;
        }
        news(g, `[[${p.seat}]] is on the last heart. The tax takes the top creature instead.`, p.seat, 'bad');
        const q = yield* askTarget(g, p, 'heartTax', seatsOf(rivals));
        if (q) yield* handOver(g, p, q, top, 'given');
      }
      return;
    }
    case 'robin': {
      // v16: Robin shoots where you point: name a rival who gives, and one who receives (never you).
      const givers = rivals.filter((x) => x.deck.length);
      if (!givers.length || rivals.length < 2) {
        news(g, 'Nobody has anything for Robin to take. He shrugs.', p.seat);
        return;
      }
      const a = (yield* askTarget(g, p, 'robinA', seatsOf(givers))) ?? pickOne(g, givers);
      const takers = rivals.filter((x) => x !== a);
      const b = (yield* askTarget(g, p, 'robinB', seatsOf(takers))) ?? pickOne(g, takers);
      const o = topOf(a);
      if (o) yield* handOver(g, a, b, o, 'given');
      return;
    }
    case 'ropeBridge': {
      const [h] = yield* trial(g, p, id, 1);
      if (h === 0) loseHeart(g, p, 'chance', null);
      else if (h === 2) yield* gain(g, p, drawRare(g), 'gift');
      return;
    }
    case 'stampede': {
      const hits = yield* trial(g, p, id, 3);
      for (const h of hits) if (h === 0) strike(g, p, 'trial');
      return;
    }
    case 'quickDraw': {
      const q = yield* askTarget(g, p, 'quick', seatsOf(rivals));
      if (!q) return;
      const [a] = yield* trial(g, p, id, 1);
      const [b] = yield* trial(g, q, id, 1);
      if (a === b) {
        news(g, 'Dead even. Both holster, eyes narrowed.', null);
        return;
      }
      const [w, l] = a! > b! ? [p, q] : [q, p];
      news(g, `[[${w.seat}]] draws first.`, w.seat, 'gold');
      const o = topOf(l);
      if (o) yield* handOver(g, l, w, o, 'stolen');
      return;
    }
    case 'fallingSky': {
      const land = g.board[p.at]!.world;
      for (const x of alive(g).filter((q) => g.board[q.at]!.world === land)) {
        if (x.out || alive(g).length <= 1) continue;
        const [h] = yield* trial(g, x, id, 1);
        if (h === 0) strike(g, x, 'trial');
      }
      return;
    }
    case 'feather': {
      const [h] = yield* trial(g, p, id, 1);
      if (h === 2 && !heal(g, p, 'chance')) yield* gain(g, p, drawRare(g), 'gift');
      return;
    }
    case 'ambush':
      yield* clashWild(g, p, wild(p), p.at, 'ambush', null);
      return;
    case 'duelCall': {
      const near = rivals.filter((x) => distance(g.board, x.at, p.at) <= 4);
      if (!near.length) {
        news(g, 'No one within reach. The ground answers instead.', p.seat, 'bad');
        yield* doChance(g, p, 'ambush');
        return;
      }
      const q = yield* askTarget(g, p, 'duel', seatsOf(near));
      if (q) yield* clashPlayers(g, p, q, p.at);
      return;
    }
    case 'arena': {
      if (rivals.length < 2) {
        news(g, 'The gods want a show. You are the show.', p.seat, 'gold');
        yield* clashPlayers(g, p, rivals[0]!, p.at);
        return;
      }
      const a = yield* askTarget(g, p, 'arenaA', seatsOf(rivals));
      if (!a) return;
      const b = yield* askTarget(g, p, 'arenaB', seatsOf(rivals.filter((x) => x !== a)));
      if (!b) return;
      news(g, `The gods demand a show: [[${a.seat}]] against [[${b.seat}]].`, null, 'gold');
      yield* clashPlayers(g, a, b, a.at);
      return;
    }
    case 'unleash': {
      const q = yield* askTarget(g, p, 'unleash', seatsOf(rivals));
      if (q) yield* clashWild(g, q, wild(q), q.at, 'unleash', p.seat);
      return;
    }
    case 'bossCall':
      if (!g.boss) {
        news(g, 'No beast walks the world yet. Something smaller answers.', p.seat, 'bad');
        yield* doChance(g, p, 'ambush');
        return;
      }
      g.boss.at = p.at;
      say(g, { t: 'bossStep', to: p.at }, 1.5);
      yield* bossFight(g, p);
      return;
    case 'rollAgain':
    case 'portal': {
      if (g.depth > 1) {
        news(g, 'Your legs refuse. Not again.', p.seat);
        return;
      }
      g.depth++;
      if (id === 'portal') yield* portal(g, p, 'named');
      else yield* rollAndWalk(g, p, 'roll');
      if (!p.out && g.winner === null) yield* land(g, p);
      g.depth--;
      return;
    }
    case 'swap': {
      const q = yield* askTarget(g, p, 'swap', seatsOf(rivals));
      if (q) {
        [p.at, q.at] = [q.at, p.at];
        p.from = q.from = null;
        say(g, { t: 'swap', seat: p.seat, with: q.seat }, 3);
      }
      return;
    }
    case 'jar':
    case 'unknown':
    case 'tea':
    case 'sky': {
      const f = FATES.find((x) => x.fx.k === id);
      if (f) yield* doFate(g, p, f);
      return;
    }
    case 'passLeft': {
      const live = alive(g);
      const tops = live.map((x) => topOf(x));
      news(g, 'Everyone passes to the left!', null, 'gold');
      for (let i = 0; i < live.length; i++) {
        const o = tops[i];
        const to = live[(i + 1) % live.length]!;
        if (o && to !== live[i] && live[i]!.deck.includes(o)) yield* handOver(g, live[i]!, to, o, 'given');
      }
      return;
    }
    case 'relic':
      if (!p.deck.length) news(g, 'No creature to carry the relic. It crumbles to dust.', p.seat);
      else yield* equip(g, p, null);
      return;
    case 'hex': {
      const o = topOf(p);
      if (o) modify(g, p, o, 'The Hex', -TUNE.hex, null);
      else news(g, 'The hex finds nothing to hold. It drifts away.', p.seat);
      return;
    }
    case 'hexGive':
    case 'relicGive': {
      const pool = withDeck(rivals);
      if (!pool.length) {
        news(g, 'No rival holds a creature. The card burns.', p.seat);
        return;
      }
      const q = yield* askTarget(g, p, id, seatsOf(pool));
      const o = q ? topOf(q) : null;
      if (q && o) {
        if (id === 'hexGive') modify(g, q, o, 'The Hex', -TUNE.hex, p.seat);
        else {
          const r = pickOne(g, RELICS);
          modify(g, q, o, r.name, r.bonus, p.seat);
        }
      }
      return;
    }
    case 'rope': {
      const q = yield* askTarget(g, p, 'rope', seatsOf(rivals));
      if (q) {
        g.ropes = g.ropes.filter((r) => r.a !== p.seat);
        g.ropes.push({ a: p.seat, b: q.seat, until: p.turns + 1 });
        say(g, { t: 'rope', a: p.seat, b: q.seat }, sec('wager'));
      }
      return;
    }
    case 'quake': {
      // v15: the ground under every hero cracks; each rolls one die, and on a 1 that ground falls (a heart, like any fall).
      const live = alive(g).filter((q) => q.at !== CENTRE);
      const rolls = live.map(() => 1 + Math.floor(rand(g) * 6));
      const fell = live.filter((_, i) => rolls[i] === 1);
      say(g, { t: 'moment', seat: p.seat, kicker: 'THE WORLD QUAKES', title: fell.length ? 'THE GROUND GIVES WAY' : 'EVERYONE KEEPS THEIR FEET', text: `${live.map((q, i) => `[[${q.seat}]] ${rolls[i]}`).join(' · ')}. A 1 and your ground falls.`, tone: fell.length ? 'bad' : 'gold', dice: rolls }, 3.5);
      for (const q of fell) {
        if (q.out || alive(g).length <= 1) continue;
        // Only the one who rolled the 1 falls: if anyone else shares that ground, the crack swallows the roller alone.
        if (alive(g).some((x) => x !== q && x.at === q.at)) loseHeart(g, q, 'world', null);
        else yield* eat(g, [q.at], g.board[q.at]!.world, 'spaces', true);
      }
      return;
    }
    case 'mutiny': {
      // v16: every crew mutinies at once: each hero passes a random creature to the hero on their left (no help for anyone).
      const live = alive(g).filter((x) => x.deck.length);
      news(g, 'Mutiny on every deck! Each hero loses a random creature to the left.', null, 'gold');
      const moves = live.map((x) => ({ from: x, o: pickOne(g, x.deck), to: leftOf(g, x) }));
      for (const m of moves) if (m.from.deck.includes(m.o) && m.to && !m.to.out && m.to !== m.from) yield* handOver(g, m.from, m.to, m.o, 'given');
      return;
    }
    case 'ransom': {
      // The mightiest creature anywhere, and who holds it.
      const holders = others(g, p).filter((x) => x.deck.length);
      const holder = holders.length ? ((yield* askTarget(g, p, 'ransom', seatsOf(holders))) ?? pickOne(g, holders)) : null;
      if (!holder) {
        news(g, 'No rival holds anything worth a ransom. The crown rolls away.', p.seat);
        return;
      }
      const prize = topOf(holder)!;
      const a = yield* ask(
        { k: 'pick', seat: p.seat, why: 'ransom', options: [`Lose a heart: ${creature(prize.cid).name.split(',')[0]} is destroyed`, `Keep your heart: [[${holder.seat}]] takes your top creature`] },
        'pick',
      );
      if (a?.i === 0 || !p.deck.length) {
        loseHeart(g, p, 'chance', holder.seat);
        if (holder.deck.includes(prize)) loseCreature(g, holder, 'void', 'strongest', [prize]);
      } else yield* handOver(g, p, holder, topOf(p)!, 'given');
      return;
    }
    case 'devil': {
      const lead = (yield* askTarget(g, p, 'devil', seatsOf(rivals))) ?? pickOne(g, rivals);
      const a = yield* ask(
        { k: 'pick', seat: p.seat, why: 'devil', options: [`Gain a heart: [[${lead.seat}]] gains a legendary creature`, `Lose a heart: [[${lead.seat}]] loses their top creature`] },
        'pick',
      );
      if (a?.i === 1) {
        loseHeart(g, p, 'chance', lead.seat);
        if (lead.deck.length) loseCreature(g, lead, 'void', 'strongest');
      } else {
        if (!heal(g, p, 'chance')) news(g, `[[${p.seat}]] is already whole. The devil still keeps his word to [[${lead.seat}]].`, p.seat);
        const legends = CREATURES.filter((c) => c.rarity === 'legendary' && g.bag[c.world].includes(c.id));
        const cid = (legends.length ? pickOne(g, legends) : pickOne(g, CREATURES.filter((c) => c.rarity === 'legendary'))).id;
        takeFromBag(g, cid);
        yield* gain(g, lead, cid, 'gift');
      }
      return;
    }
    case 'heel': {
      const pool = withDeck(rivals);
      const mine = topOf(p);
      if (!pool.length || !mine) {
        news(g, 'No blade to strike with, or nothing to strike. The heel stays hidden.', p.seat);
        return;
      }
      const q = yield* askTarget(g, p, 'heel', seatsOf(pool));
      if (!q) return;
      const theirs = topOf(q)!;
      const ts = fighter(theirs).stats;
      const stat = STATS.reduce((x, y) => (ts[y] < ts[x] ? y : x));
      const a = fighter(mine).stats[stat];
      const b = ts[stat];
      const hit = a > b;
      say(g, { t: 'heel', seat: p.seat, on: q.seat, mine: mine.cid, theirs: theirs.cid, stat, a, b, hit }, sec('attack'));
      if (hit) loseHeart(g, q, 'chance', p.seat);
      else loseCreature(g, p, 'void', 'strongest', [mine]);
      return;
    }
    case 'bloodPrice': {
      if (!p.deck.length) {
        news(g, 'The Blood Price needs a creature to pay with. You have none. The card crumbles.', p.seat);
        return;
      }
      const q = yield* askTarget(g, p, 'bloodPrice', seatsOf(rivals));
      if (!q) return;
      loseHeart(g, q, 'chance', p.seat);
      const top = topOf(p);
      if (top && !q.out) yield* handOver(g, p, q, top, 'given');
      return;
    }
    case 'darkPact': {
      // v15 (owner's own dilemma: "creature le lo, ya sametne wale ka bhi heart jaye, tumhara bhi"): a creature now, or chain
      // yourself to a rival's next battle: if they lose it, you BOTH lose a heart, on top of what the battle costs them.
      const a = yield* ask({ k: 'choice', seat: p.seat, title: 'The Dark Pact', sub: "Take a creature now. Or chain yourself to a rival's next battle: if they lose it, they lose an extra heart, and so do you. Worth it, if it finishes them.", options: ['Take the creature', 'Forge the chain'], def: 0 }, 'pick');
      if (a?.i !== 1) {
        yield* gain(g, p, makeTeam(g, g.board[p.at]!.world ?? pickOne(g, g.petals), 1)[0]!, 'gift');
        return;
      }
      const q = (yield* askTarget(g, p, 'anchor', seatsOf(rivals))) ?? pickOne(g, rivals);
      wager(g, 'darkPact', p, q, null);
      return;
    }
    case 'contract': {
      // v15 a hidden agenda: name a rival behind the cover. If they lose a heart before your next turn, you are paid.
      const opts = rivals.map((x) => x.name);
      const a = yield* ask({ k: 'choice', seat: p.seat, title: "The Assassin's Contract", sub: 'Behind the cover: name your mark. If they lose a heart, any way at all, before your next turn, you gain a heart. Nobody else knows.', options: opts, def: Math.floor(rand(g) * opts.length), secret: true }, 'pick');
      const q = rivals[a && a.i >= 0 && a.i < rivals.length ? a.i : 0]!;
      g.contracts.push({ by: p.seat, on: q.seat, until: p.turns });
      say(g, { t: 'moment', seat: p.seat, kicker: "THE ASSASSIN'S CONTRACT", title: 'A NAME IS WRITTEN', text: `[[${p.seat}]] signs a secret contract on someone at this table. Watch your back.`, tone: 'bad' }, 2.5);
      return;
    }
    case 'liarChest': {
      // v15 a bluff: you alone see inside the chest, then offer it to a rival. They take it, or it is yours.
      const pool = rivals;
      const good = rand(g) < 0.5;
      const inside = good ? 'a RARE CREATURE' : 'a CURSE: whoever takes it loses a heart';
      yield* ask({ k: 'choice', seat: p.seat, title: "The Liar's Chest", sub: `Only you see inside: ${inside}. Now offer it to a rival, and say whatever you like.`, options: ['Close the lid'], def: 0, secret: true }, 'pick');
      const q = (yield* askTarget(g, p, 'chest', seatsOf(pool))) ?? pickOne(g, pool);
      const b = yield* ask({ k: 'choice', seat: q.seat, title: "The Liar's Chest", sub: `[[${p.seat}]] offers you the chest. Take it, and whatever is inside is yours. Refuse, and it goes back to them.`, options: ['Take the chest', 'Refuse it'], def: Math.floor(rand(g) * 2) }, 'pick');
      const taker = b?.i === 0 ? q : p;
      say(g, { t: 'moment', seat: taker.seat, kicker: "THE LIAR'S CHEST", title: good ? 'A RARE CREATURE INSIDE' : 'A CURSE INSIDE', text: `[[${q.seat}]] ${b?.i === 0 ? 'takes' : 'refuses'} the chest. It goes to [[${taker.seat}]].`, tone: good === (taker === p) ? 'gold' : 'bad' }, 3);
      if (good) yield* gain(g, taker, drawRare(g), 'gift');
      else loseHeart(g, taker, 'chance', taker === p ? null : p.seat);
      return;
    }
    case 'bss': {
      // v15 a mind game for two: Blade beats Shield, Shield beats Spell, Spell beats Blade. Chosen in secret, shown together.
      const pool = rivals.filter((x) => x.deck.length);
      if (!pool.length || !p.deck.length) {
        news(g, 'Nobody has a creature to stake. The challenge is laughed off.', p.seat);
        return;
      }
      const q = (yield* askTarget(g, p, 'bss', seatsOf(pool))) ?? pickOne(g, pool);
      const ARMS = ['Blade', 'Shield', 'Spell'];
      const pickArm = function* (x: Player, vs: Player) {
        const a = yield* ask({ k: 'choice', seat: x.seat, title: 'Blade, Shield, Spell', sub: `Against [[${vs.seat}]]: Blade beats Shield, Shield beats Spell, Spell beats Blade. Choose in secret.`, options: ARMS, def: Math.floor(rand(g) * 3), secret: true }, 'pick');
        return a && a.i >= 0 && a.i < 3 ? a.i : Math.floor(rand(g) * 3);
      };
      let x = 0;
      let y = 0;
      for (let k = 0; k < 3; k++) {
        x = yield* pickArm(p, q);
        y = yield* pickArm(q, p);
        if (x !== y) break;
        say(g, { t: 'moment', seat: p.seat, kicker: 'BLADE, SHIELD, SPELL', title: `${ARMS[x]!.toUpperCase()} AND ${ARMS[y]!.toUpperCase()}`, text: 'The same. Again.', tone: '' }, 2);
      }
      if (x === y) {
        news(g, 'Three times the same. They lower their arms, and laugh.', p.seat);
        return;
      }
      // Blade(0) beats Shield(1), Shield(1) beats Spell(2), Spell(2) beats Blade(0): i beats (i + 1) % 3.
      const pBeats = (x + 1) % 3 === y;
      const [w, l] = pBeats ? [p, q] : [q, p];
      say(g, { t: 'moment', seat: p.seat, kicker: 'BLADE, SHIELD, SPELL', title: `${ARMS[x]!.toUpperCase()} AGAINST ${ARMS[y]!.toUpperCase()}`, text: `[[${w.seat}]] reads [[${l.seat}]], and takes their top creature.`, tone: w === p ? 'gold' : 'bad' }, 3);
      if (topOf(l)) yield* handOver(g, l, w, topOf(l)!, 'stolen');
      return;
    }
    case 'sinking': {
      // Only someone with at least as many hearts can be dragged down (never a free kill from a hero with nothing to lose).
      const fit = rivals.filter((x) => x.hearts >= p.hearts);
      if (!fit.length) {
        news(g, 'No rival has as many hearts as you. The ship sinks alone, and you swim free.', p.seat);
        return;
      }
      const q = yield* askTarget(g, p, 'sinking', seatsOf(fit));
      if (!q) return;
      loseHeart(g, q, 'chance', p.seat);
      loseHeart(g, p, 'chance', q.seat);
      return;
    }
    case 'feast': {
      const q = yield* askTarget(g, p, 'feast', seatsOf(rivals));
      if (!q) return;
      yield* gain(g, p, makeTeam(g, g.board[p.at]!.world ?? pickOne(g, g.petals), 1)[0]!, 'gift');
      yield* gain(g, q, makeTeam(g, g.board[q.at]!.world ?? pickOne(g, g.petals), 1)[0]!, 'gift');
      return;
    }
    case 'tribute': {
      const top = topOf(p);
      // v16: the stone names a rival by lot (never "the weakest" by design).
      const weakest = pickOne(g, rivals);
      if (top) yield* handOver(g, p, weakest, top, 'given');
      else news(g, 'Nothing to pay. The stone stays silent.', p.seat);
      return;
    }
    case 'legendFalls': {
      // v16: a legend falls, drawn by lot among the legends anyone holds (no aim at the strongest hero).
      const held = alive(g).flatMap((x) => x.deck.filter((o) => creature(o.cid).rarity === 'legendary').map((o) => ({ x, o })));
      if (!held.length) {
        news(g, 'No legend walks with anyone. The sky rumbles, and passes.', p.seat);
        return;
      }
      const { x: h, o: fallen } = pickOne(g, held);
      news(g, `A legend falls, drawn by fate: the one held by [[${h.seat}]].`, h.seat, 'bad');
      loseCreature(g, h, 'void', 'strongest', [fallen]);
      return;
    }
    case 'loadedDie': {
      const roll = 1 + Math.floor(rand(g) * 6);
      say(g, { t: 'die', seat: p.seat, roll }, sec('nest'));
      if (roll === 6) {
        const legends = CREATURES.filter((c) => c.rarity === 'legendary' && g.bag[c.world].includes(c.id));
        const cid = (legends.length ? pickOne(g, legends) : pickOne(g, CREATURES.filter((c) => c.rarity === 'legendary'))).id;
        takeFromBag(g, cid);
        yield* gain(g, p, cid, 'gamble');
      } else if (roll === 1) loseHeart(g, p, 'chance', null);
      return;
    }
    case 'underdog': {
      // v16: a straight swap of champions with a rival you choose (no reward for being behind, no tax for being ahead).
      const pool = rivals.filter((x) => x.deck.length);
      if (!pool.length || !p.deck.length) {
        news(g, 'Nobody has a champion to swap. The dogs lie down.', p.seat);
        return;
      }
      const q = (yield* askTarget(g, p, 'underdog', seatsOf(pool))) ?? pickOne(g, pool);
      const mine = topOf(p)!;
      const theirs = topOf(q)!;
      yield* handOver(g, q, p, theirs, 'stolen');
      if (p.deck.includes(mine)) yield* handOver(g, p, q, mine, 'given');
      return;
    }
    case 'shuffle': {
      const live = alive(g);
      const spots = live.map((x) => x.at);
      live.forEach((x, i) => {
        const to = spots[(i + 1) % live.length]!;
        if (to === x.at) return;
        say(g, { t: 'portal', seat: x.seat, from: x.at, to, why: 'shuffle' }, 1.2);
        x.at = to;
        x.from = null;
      });
      return;
    }
  }
}

function* turn(g: Game, p: Player): Gen {
  p.turns++;
  // v15: an Assassin's Contract that never paid is revealed when its holder's next turn comes (laughs, or a grudge).
  for (const c of g.contracts.filter((x) => x.by === p.seat && p.turns > x.until)) {
    g.contracts = g.contracts.filter((x) => x !== c);
    say(g, { t: 'moment', seat: p.seat, kicker: "THE ASSASSIN'S CONTRACT", title: 'THE CONTRACT EXPIRES', text: `[[${p.seat}]] had a secret contract on [[${c.on}]]. It never paid.`, tone: '' }, 2.5);
  }
  for (const s of g.owed.splice(0)) if (!g.players[s]!.out) yield* gain(g, g.players[s]!, drawRare(g), 'wager');
  g.vultures = g.vultures.filter((v) => v.by !== p.seat);
  say(g, { t: 'turn', seat: p.seat }, sec('turn'));
  if (p.skip) {
    p.skip = false;
    say(g, { t: 'skip', seat: p.seat, why: p.skipWhy }, 2);
    p.skipWhy = 'vines';
    return;
  }
  // The shrine wanders at the start of every turn.
  if (!g.shrineUsed) {
    const spots = open(g).filter((s) => s.id !== CENTRE && !alive(g).some((q) => q.at === s.id));
    g.shrine = spots.length ? pickOne(g, spots).id : null;
  }
  if (rand(g) < TUNE.rumour) {
    const lairs = Object.keys(g.lairs)
      .map(Number)
      .filter((id) => !g.board[id]!.void);
    const rel = g.relics.filter((id) => !g.board[id]!.void);
    const what = rel.length && rand(g) < 0.5 ? 'relic' : 'lair';
    const at = what === 'relic' ? pickOne(g, rel) : lairs.length ? pickOne(g, lairs) : null;
    if (at !== null && g.board[at]!.world) say(g, { t: 'rumour', world: g.board[at]!.world!, what }, 2.5);
  }
  // v10: before the hero moves, the land may strike.
  yield* landStrikes(g, p);
  if (p.out || g.winner !== null) return;
  g.ropes = g.ropes.filter((r) => g.players[r.a]!.turns <= r.until);
  // v11 (owner: "golden card, chance card sirf kahin land karke… baari chalne se phle bass attacks"): before you move, only the land
  // may act. Golden cards, chance cards, curses, boons, challenges and riddles are all found on the ground, at random.
  const ready = Math.max(0, p.powerAt - p.turns);
  g.clock += TUNE.think.roll ?? 2;
  const r = yield { k: 'roll', seat: p.seat, golden: false, power: p.hero.gift, ready };
  const use = r && r.k === 'roll' ? r.use : 'roll';
  {
    let mode: RollMode = 'roll';
    if (use === 'power' && ready === 0) {
      p.powerAt = p.turns + powerEvery(p);
      mode = yield* usePower(g, p);
    }
    if (!p.out && g.winner === null) yield* rollAndWalk(g, p, mode);
  }
  if (!p.out && g.winner === null) yield* land(g, p);
  // v12 THE EMPTY-HANDED WAGER: a hero still without a creature after landing bets on a rival, every turn, until a creature comes
  // (or a heart goes). Found on the ground like everything else: before the roll, only the land acts.
  if (!p.out && g.winner === null && !p.deck.length) yield* emptyWager(g, p);
  // A STORM: whoever ends a turn in that land must dodge the lightning (timed) or lose a creature.
  const sky = g.board[p.at]!.world;
  if (!p.out && g.winner === null && sky && g.weather[sky] === 'storm') {
    const [h] = yield* trial(g, p, 'lightning', 1);
    if (h === 0) strike(g, p, 'trial');
  }
  if (g.winner === null) yield* passBomb(g, p);
  for (const o of p.deck) o.tired = false;
  p.marked = false;
}

// ── The world acts ──────────────────────────────────────────────────────────────────────────────────────────────────────
const moodOf = (round: number): Mood => (['hunt', 'hunt', 'frenzy', 'sated'] as const)[round % 4]!;
const ringOrder = (s: Space) => ({ outer: 0, spoke: 1, inner: 2, centre: 3 })[s.ring];

/** Pick what the world will eat next (decided a round ahead so the omen can whisper it). */
function chooseDoom(g: Game): number[] {
  const p = progress(g);
  const live = (w: WorldId) => open(g).filter((s) => s.world === w && s.id !== CENTRE && !sheltered(g, s.id));
  if (g.lastLight) {
    const outer = open(g).filter((s) => s.ring === 'outer');
    const spoke = open(g).filter((s) => s.ring === 'spoke');
    return (outer.length ? outer : spoke).map((s) => s.id);
  }
  if (p < TUNE.eatStart) return [];
  let world: WorldId | undefined;
  if (g.skyWorld && live(g.skyWorld).length) world = g.skyWorld;
  g.skyWorld = null;
  // v15: the world eats wherever chance points (any land still standing, equally likely). No bag, no grudge, no aim.
  if (!world) {
    const standing = WORLDS.filter((w) => live(w).length);
    if (standing.length) world = pickOne(g, standing);
  }
  if (!world) return [];
  const spaces = shuffled(g, live(world)).sort((a, b) => ringOrder(a) - ringOrder(b));
  const size = p >= TUNE.eatWorldAt ? spaces.length : p >= TUNE.eatChunkAt ? 3 : rand(g) < 0.5 ? 1 : 2;
  return spaces.slice(0, size).map((s) => s.id);
}

function* eat(
  g: Game,
  spaces: number[],
  world: WorldId | null,
  size: Extract<Beat, { t: 'eat' }>['size'],
  warned: boolean,
  soft = false,
): Gen {
  const doomed = spaces.filter((id) => id !== CENTRE && !g.board[id]!.void && !sheltered(g, id));
  if (!doomed.length) return;
  for (const id of doomed) {
    const s = g.board[id]!;
    s.void = true;
    delete g.lairs[id];
    g.relics = g.relics.filter((x) => x !== id);
  }
  say(g, { t: 'eat', spaces: doomed, world, size, warned }, sec('eat'));
  for (const p of alive(g)) {
    if (!doomed.includes(p.at)) {
      if (g.board[p.at]!.adj.some((n) => doomed.includes(n)))
        say(g, { t: 'spared', seat: p.seat, at: p.at, why: 'near' }, 1.5);
      continue;
    }
    const from = p.at;
    const to = nearestOpen(g, from);
    const move = () => {
      p.at = to;
      p.from = null;
      say(g, { t: 'pushed', seat: p.seat, from, to, why: 'eaten' }, 1.5);
    };
    const flyer = p.deck.find((o) => giftsOf(o).includes('FLY') && !o.tired);
    if (g.round <= 1) {
      move();
      say(g, { t: 'spared', seat: p.seat, at: to, why: 'round1' }, 1.5);
    } else if (flyer) {
      flyer.tired = true;
      say(g, { t: 'tired', seat: p.seat, cid: flyer.cid, gift: 'FLY' }, 1.5);
      move();
      say(g, { t: 'spared', seat: p.seat, at: to, why: 'fly' }, 1.5);
    } else if (useBoon(g, p, 'brahmastra')) {
      move();
      say(g, { t: 'spared', seat: p.seat, at: to, why: 'brahmastra' }, 1.5);
    } else {
      move();
      // v15 (owner: "place gira toh heart nahi gaya… koi bhi block gire, poora land gire, life jaani chahiye"): one law, no hidden
      // exceptions. The ground falls under you: a heart. Only a flyer, the Brahmastra or the first round save you, out loud.
      void soft;
      p.eatHitRound = g.round;
      loseHeart(g, p, 'world', null);
    }
  }
  for (const p of alive(g)) if (g.board[p.at]!.void) p.at = nearestOpen(g, p.at);
}

function* flip(g: Game): Gen {
  const last = g.log.findLast((b) => b.t === 'flip');
  const kinds = FLIPS.filter((f) => f.kind !== 'mirror' && (!last || last.t !== 'flip' || f.kind !== last.flip));
  const kind = pickOne(g, kinds).kind;
  g.flipsDone++;
  g.sheltered = g.sheltered.filter((x) => !x.tree);
  const passes: { from: number; to: number; cid: string }[] = [];
  if (kind === 'rewire') {
    // Two worlds swap petals; the bridges move to the other half of the mandala.
    const a = Math.floor(rand(g) * 8);
    const b = (a + 2 + Math.floor(rand(g) * 5)) % 8;
    const wa = g.petals[a]!;
    const wb = g.petals[b]!;
    g.petals[a] = wb;
    g.petals[b] = wa;
    for (const s of g.board)
      if (s.world === wa) s.world = wb;
      else if (s.world === wb) s.world = wa;
    for (let k = 0; k < 8; k++) {
      const o = 3 * k + 2;
      const sp = SPOKE0 + ((k + 1) % 8);
      if (g.board[o]!.adj.includes(sp)) {
        g.board[o]!.adj = g.board[o]!.adj.filter((y) => y !== sp);
        g.board[sp]!.adj = g.board[sp]!.adj.filter((y) => y !== o);
      } else {
        g.board[o]!.adj.push(sp);
        g.board[sp]!.adj.push(o);
      }
    }
  } else if (kind === 'tide') {
    const live = alive(g);
    const gifts = live.map((p) => {
      const o = p.deck.length ? weakest(p.deck) : null;
      if (o) p.deck = p.deck.filter((x) => x !== o);
      return o;
    });
    live.forEach((p, i) => {
      const o = gifts[i];
      const to = live[(i + 1) % live.length]!;
      if (o) {
        to.deck.push(o);
        passes.push({ from: p.seat, to: to.seat, cid: o.cid });
      }
    });
  } else if (kind === 'starfall') {
    const spots = open(g).filter((s) => s.id !== CENTRE && s.content !== 'lair' && s.world);
    void shuffled(g, spots)
      .slice(0, 3)
      .map((s) => {
        setContent(g, s, 'cache');
        return s.id;
      });
    const lairs = open(g).filter((s) => s.content === 'lair');
    const leg = CREATURES.filter((c) => c.rarity === 'legendary' && g.bag[c.world].includes(c.id));
    if (lairs.length && leg.length) {
      const l = pickOne(g, lairs);
      const c = pickOne(g, leg);
      takeFromBag(g, c.id);
      g.lairs[l.id] = [c.id, ...(g.lairs[l.id] ?? makeTeam(g, l.world!)).slice(0, 2)];
    }
  } else g.mirrorRound = g.round + 1;
  say(
    g,
    {
      t: 'flip',
      flip: kind,
      petals: [...g.petals],
      board: g.board.map((s) => ({ ...s, adj: [...s.adj] })),
      passes,
    },
    sec('flip'),
  );
  for (const p of alive(g)) yield* settleHold(g, p);
}

function* worldActs(g: Game): Gen {
  const mood = moodOf(g.round);
  say(g, { t: 'mood', mood }, sec('world'));
  const spirits = g.players.filter((p) => p.out);
  // 1. Eat what was doomed last round. An unwhispered doom only takes empty ground (pre-mortem fix 1).
  if (g.doom.length && (mood !== 'sated' || g.lastLight)) {
    const p = progress(g);
    const warned = g.doomWarned || g.lastLight;
    const doom = warned ? g.doom : g.doom.filter((id) => !alive(g).some((q) => q.at === id));
    const size = g.lastLight
      ? 'world'
      : p >= TUNE.eatWorldAt
        ? 'world'
        : p >= TUNE.eatChunkAt
          ? 'chunk'
          : 'spaces';
    // SUNSHINE shelters its land: the world does not eat there this round.
    const fed = doom.filter((id) => !(g.board[id]!.world && g.weather[g.board[id]!.world!] === 'sun'));
    if (fed.length) yield* eat(g, fed, g.board[fed[0]!]!.world, size, warned);
    else say(g, { t: 'omenHeals', spaces: g.doom }, 1.5);
  } else if (g.omen.length) say(g, { t: 'omenHeals', spaces: g.omen }, 1.5);
  g.doom = [];
  g.omen = [];
  if (g.winner !== null || alive(g).length <= 1) return;
  // 2. Hunt: the jungle breeds (a cleared space in a world may become a lair again).
  if (mood === 'hunt' && progress(g) >= TUNE.eatStart)
    for (const w of g.petals) {
      const empty = open(g).filter(
        (s) => s.world === w && s.content === 'empty' && !alive(g).some((q) => q.at === s.id),
      );
      if (empty.length && rand(g) < 0.5) setContent(g, pickOne(g, empty), 'lair');
    }
  // 2b. The hunts: a lair may wake and send its beasts after the nearest hero; every hunt closes in.
  if (!g.lastLight && mood !== 'sated' && progress(g) >= TUNE.eatStart && rand(g) < TUNE.hunterWake) {
    const lairs = open(g).filter((x) => x.content === 'lair' && !alive(g).some((q) => q.at === x.id));
    if (lairs.length) {
      const l = pickOne(g, lairs);
      const live = alive(g);
      const prey = fair(g, live).reduce((a, b) => (distance(g.board, l.id, b.at) < distance(g.board, l.id, a.at) ? b : a));
      const team = g.lairs[l.id] ?? makeTeam(g, l.world!);
      delete g.lairs[l.id];
      setContent(g, l, 'empty');
      loose(g, team, l.id, prey, 'wake');
    }
  }
  if (g.lastLight && g.hunters.length) {
    for (const h of g.hunters) say(g, { t: 'hunterGone', id: h.id, why: 'light' }, 0.5);
    g.hunters = [];
  }
  yield* hunt(g);
  if (g.winner !== null || alive(g).length <= 1) return;
  // v15 THE FALLEN WHISPER (research: Blood on the Clocktower's ghosts, End of the Line's hecklers; owner: "jo out ho gaya vo
  // bata raha tha ye strategy use kar… maza aa raha tha"): every world turn one fallen hero, drawn by lot, whispers to a living one:
  // a blessing (+2) or a curse (−2) on their next roll. The dead stay in the game: they help a friend, or settle a score.
  {
    const ghosts = g.players.filter((x) => x.out);
    const living = alive(g);
    if (ghosts.length && living.length > 1 && !g.stand) {
      const gh = pickOne(g, ghosts);
      const q = (yield* askTarget(g, gh, 'haunt', seatsOf(living))) ?? pickOne(g, living);
      const a = yield* ask({ k: 'choice', seat: gh.seat, title: 'The Fallen Whisper', sub: `From beyond, whisper to [[${q.seat}]]: bless their next roll (+2), or curse it (−2). Then roll: it carries on a 4 or more.`, options: ['Bless (+2)', 'Curse (−2)'], def: Math.floor(rand(g) * 2) }, 'pick');
      const bless = a?.i !== 1;
      // The veil is thin only sometimes: the ghost rolls, and the whisper carries on a 4 or more.
      const veil = 1 + Math.floor(rand(g) * 6);
      if (veil >= 4) {
        q.haunt = bless ? 2 : -2;
        q.hauntBy = gh.seat;
      }
      say(g, { t: 'moment', seat: gh.seat, kicker: 'THE FALLEN WHISPER', title: veil < 4 ? 'THE VEIL HOLDS' : bless ? 'A BLESSING FROM BEYOND' : 'A CURSE FROM BEYOND', text: veil < 4 ? `[[${gh.seat}]], fallen, tries to ${bless ? 'bless' : 'curse'} [[${q.seat}]], and rolls ${veil}. The whisper does not carry.` : `[[${gh.seat}]], fallen, rolls ${veil} and whispers to [[${q.seat}]]: their next roll ${bless ? 'gains 2' : 'loses 2'}.`, tone: veil < 4 ? '' : bless ? 'gold' : 'bad', dice: [veil] }, 2.5);
    }
  }
  // v14 THE CROSSROADS DEMON: the bill comes due two rounds after the deal.
  for (const q of fair(g, alive(g))) {
    if (q.demon === null || g.round < q.demon || alive(g).length <= 1) continue;
    q.demon = null;
    const roll = 1 + Math.floor(rand(g) * 6);
    say(g, { t: 'moment', seat: q.seat, kicker: 'THE CROSSROADS DEMON', title: roll >= 4 ? 'THE DEBT IS FORGIVEN' : 'THE DEMON COLLECTS', text: `The demon comes back for [[${q.seat}]], who rolls ${roll}.`, tone: roll >= 4 ? 'gold' : 'bad', dice: [roll] }, 3);
    if (roll < 4) loseHeart(g, q, 'chance', null);
  }
  if (g.winner !== null || alive(g).length <= 1) return;
  // 2c. v9 chaos: the bomb goes off, the world boss wakes and walks, stampedes cross a land.
  boom(g);
  if (g.winner !== null || alive(g).length <= 1) return;
  yield* bossWakes(g);
  yield* bossWalks(g);
  if (g.winner !== null || alive(g).length <= 1) return;
  yield* stampedes(g);
  if (g.winner !== null || alive(g).length <= 1) return;
  // 3. The world strikes (never while sated): its disaster finds the leader (grudge) or anyone (chaos); two in a Frenzy.
  //    Rarely a Spirit chooses who. Every strike can be dodged by the right creature (the collection is the strategy).
  if (TUNE.roundStrikes && mood !== 'sated' && progress(g) >= TUNE.strikeStart) {
    // The hungrier world: one more strike for every fallen player (they become the world), so the endgame never drags.
    // Once the light dims, the world strikes every survivor.
    const strikes =
      1 + Math.min(TUNE.strikeFallenCap, spirits.length) + Math.floor(progress(g) * TUNE.strikeRamp) + (mood === 'frenzy' ? 1 : 0);
    const hit = new Set<number>();
    for (let k = 0; k < strikes && alive(g).length > 1; k++) {
      const live = alive(g).filter((q) => !hit.has(q.seat));
      if (!live.length) break;
      let target = rand(g) < TUNE.grudge ? (grudgeTarget(g) ?? pickOne(g, live)) : pickOne(g, live);
      if (hit.has(target.seat)) target = pickOne(g, live);
      if (spirits.length && rand(g) < TUNE.spiritChoose) {
        const q = yield* askTarget(
          g,
          pickOne(g, spirits),
          'spirit',
          live.map((x) => x.seat),
        );
        if (q) target = q;
      }
      hit.add(target.seat);
      say(g, { t: 'eye', seat: target.seat }, 1.5);
      const w = g.board[target.at]!.world;
      if (w && !treeAt(g, target.at)) yield* disaster(g, target, w);
      if (g.winner !== null || alive(g).length <= 1) return;
    }
  }
  if (g.winner !== null || alive(g).length <= 1) return;
  // 4. Flips and the Final Turns, by progress (the herald and its verse play one beat before).
  const p = progress(g);
  if (g.flipsDone < TUNE.flips.length && p >= TUNE.flips[g.flipsDone]!) {
    say(g, { t: 'flipOmen', n: g.flipsDone + 1 }, 3);
    yield* flip(g);
  }
  if (!g.finalTurns && p >= TUNE.finalTurns && alive(g).length > 1) {
    g.finalTurns = true;
    // v15 (owner: "game apna dimaag na rakhe… kisi player ki taraf biased nahi"): the blessing falls on a hero drawn by lot,
    // never on the weakest by design.
    const last = pickOne(g, alive(g));
    const options = sacred(g, 3);
    const a = yield* ask({ k: 'boon', seat: last.seat, options }, 'boon');
    const key = a && options.includes(a.key) ? a.key : options[0]!;
    say(g, { t: 'finalTurns', seat: last.seat, boon: key }, 4);
    yield* giveBoon(g, last, key, 'finalTurns');
  }
  // 5. The Last Light: two remain, or the world's time is nearly up (PRALAYA ends on schedule — no endgame drags).
  const two = alive(g).length === 2 && (g.players.length > 2 || p >= TUNE.eatWorldAt);
  if (!g.lastLight && alive(g).length > 1 && (two || p >= TUNE.lastLightAt)) {
    g.lastLight = true;
    say(g, { t: 'lastLight' }, 6);
    // v15: at the Last Light every oath is tested at the fire: keep it, or betray it.
    for (const [x, y] of [...g.allies]) {
      const a = g.players[x]!;
      const b = g.players[y]!;
      if (!a.out && !b.out && alive(g).length > 1 && g.winner === null) yield* allyMeet(g, a, b);
    }
    if (g.winner !== null || alive(g).length <= 1) return;
  }
  // The light is almost out: every survivor stands on one heart.
  if (g.lastLight && !g.dimmed && g.clock / g.target >= TUNE.dimAt && alive(g).length > 1) {
    // The finale: the survivors are drawn to the fire and duel, the weakest pair first, whole collections, sudden death.
    // A standoff goes to more hearts, then more creatures. The last one standing walks out.
    g.dimmed = true;
    say(g, { t: 'dim' }, 5);
    while (alive(g).length > 1) {
      // v16 (QA: the leader got a bye and won ties): the pairs at the dimmed fire are drawn by lot.
      const order = fair(g, alive(g));
      const [a, b] = [order[0]!, order[1]!];
      const out = yield* clashPlayers(g, a, b, CENTRE, 'final');
      const loser =
        out === 'win'
          ? b
          : out === 'lose'
            ? a
            : pickOne(g, [a, b]);
      for (let k = 0; k < 8 && !loser.out && alive(g).length > 1; k++) loseHeart(g, loser, 'suddenDeath', null);
    }
    return;
  }
  if (g.lastLight && !open(g).some((s) => s.ring === 'outer' || s.ring === 'spoke')) {
    // The fire draws them together: the leader faces a rival with their whole collection.
    const live = alive(g);
    // v12: who faces whom at the fire is a fair draw (a ranking with ties always picked the first seat).
    const a = live.length ? pickOne(g, live) : null;
    const rivals = live.filter((q) => q !== a);
    const b = rivals.length ? pickOne(g, rivals) : null;
    if (a && b) {
      g.lastLightClashes++;
      // After the third Last Light clash between the final two: sudden death.
      const sudden = live.length === 2 && g.lastLightClashes > 3;
      if (sudden) say(g, { t: 'suddenDeath' }, 3);
      const out = yield* clashPlayers(g, a, b, CENTRE, 'final');
      if (sudden && alive(g).length === 2) {
        const loser = out === 'win' ? b : out === 'lose' ? a : a.deck.length >= b.deck.length ? b : a;
        for (let k = 0; k < 8 && !loser.out; k++) loseHeart(g, loser, 'suddenDeath', null);
      }
      const inner = open(g).filter((s) => s.ring === 'inner' && !alive(g).some((q) => q.at === s.id));
      if (inner.length && alive(g).length > 1) yield* eat(g, [pickOne(g, inner).id], null, 'spaces', true);
    }
    if (alive(g).length <= 1) return;
  }
  // 6. Very rare revival.
  if (!g.revived && spirits.length && p >= TUNE.revive.from && rand(g) < TUNE.revive.chance && !g.lastLight) {
    g.revived = true;
    const sp = pickOne(g, spirits);
    sp.out = false;
    sp.hearts = 1;
    const spots = open(g).filter((s) => s.id !== CENTRE);
    sp.at = spots.length ? pickOne(g, spots).id : CENTRE;
    sp.deck = [0, 1].map(() => ({ uid: g.uid++, cid: drawRare(g), ascended: false, wins: 0, tired: false }));
    say(g, { t: 'revive', seat: sp.seat, at: sp.at }, 5);
  }
  // 7. Decide the next doom and whisper the omen (honest ~70%; always honest after the Old Map burned).
  if (moodOf(g.round + 1) !== 'sated' || g.lastLight) {
    let doom = chooseDoom(g);
    if (doom.length && spirits.length && rand(g) < TUNE.spiritChoose && !g.lastLight) {
      const alt = chooseDoom(g);
      if (alt.length && alt.join() !== doom.join()) {
        const a = yield* ask({ k: 'doom', seat: pickOne(g, spirits).seat, options: [doom, alt] }, 'doom');
        if (a?.index === 1) doom = alt;
      }
    }
    const honest = g.honestRound >= g.round - 1 || g.lastLight || rand(g) < TUNE.omenHonest;
    g.omen = honest ? doom : rand(g) < 0.5 ? [] : chooseDoom(g);
    g.doomWarned = honest;
    g.doom = doom;
    if (g.omen.length) say(g, { t: 'omen', spaces: g.omen }, 1.5);
  }
}

// ── The match ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function* play(g: Game): Gen {
  CUR = g;
  if (g.cards !== currentSalt()) seedCards(g.cards);
  say(g, { t: 'start', seats: g.players.length }, 6);
  for (g.round = 0; g.round < 80; g.round++) {
    g.sheltered = g.sheltered.filter((x) => x.until >= g.round);
    say(g, { t: 'round', round: g.round, mood: moodOf(g.round) }, 0);
    // The weather turns over every land, every round: one storm, one sunshine, never the same land.
    const lands = shuffled(g, g.petals.filter((w) => open(g).some((s) => s.world === w)));
    g.weather = {};
    if (lands[0]) g.weather[lands[0]] = 'storm';
    if (lands[1]) g.weather[lands[1]] = 'sun';
    say(g, { t: 'weather', storm: lands[0] ?? null, sun: lands[1] ?? null }, sec('weather'));
    const blood = g.round > 0 && progress(g) >= TUNE.bloodAt && rand(g) < TUNE.bloodChance;
    if (blood !== g.blood) say(g, { t: 'bloodMoon', on: blood }, blood ? sec('weather') + 1 : 0.5);
    g.blood = blood;
    for (const p of [...g.players.slice(g.firstSeat), ...g.players.slice(0, g.firstSeat)]) {
      if (p.out) continue;
      yield* turn(g, p);
      if (g.winner !== null || alive(g).length <= 1) break;
    }
    if (g.winner === null && alive(g).length > 1) yield* worldActs(g);
    if (g.winner !== null || alive(g).length <= 1) break;
  }
  const live = alive(g);
  const w = live.length
    ? fair(g, live).reduce((a, b) => (b.hearts * 100 + b.deck.length > a.hearts * 100 + a.deck.length ? b : a))
    : fair(g, g.players).reduce((a, b) => (b.deck.length > a.deck.length ? b : a));
  for (const p of live)
    if (p !== w) {
      p.out = true;
      say(g, { t: 'out', seat: p.seat }, 4);
    }
  if (w.out) {
    w.out = false;
    w.hearts = 1;
  }
  yield* lastStand(g, w);
}

/**
 * THE LAST STAND (owner, 2026-10-31): the last one standing walks out into the real world only with TUNE.walkOut creatures.
 * Short of that, the clock starts: TUNE.standTurns turns to find them, while every fallen player lays a trap on the map before
 * each of those turns. Fail, or fall, and the world keeps them: the fallen win together. Hope stays alive for everyone.
 */
function* lastStand(g: Game, p: Player): Gen {
  // v14 (owner: "0 cards mein injustice na ho"): the survivor must hold four, or find two more than they brought, whichever is
  // fewer. A bare survivor needs two, not four.
  const need = Math.min(TUNE.walkOut, p.deck.length + 2);
  if (p.deck.length >= need) {
    g.winner = p.seat;
    say(g, { t: 'win', seat: p.seat, why: 'walkout' }, 8);
    return;
  }
  g.stand = { seat: p.seat, left: TUNE.standTurns };
  g.lastLight = false;
  // The world goes quiet for the last one: the hunts, the boss, the bomb and every bet are gone (and the screen is told).
  for (const h of g.hunters) say(g, { t: 'hunterGone', id: h.id, why: 'stand' }, 0.3);
  g.hunters = [];
  g.boss = null;
  if (g.bomb) say(g, { t: 'bomb', seat: null, from: null, round: g.round }, 0.3);
  g.bomb = null;
  for (const w of g.wagers) say(g, { t: 'wagerEnd', id: w.id, card: w.card, by: w.by, on: w.on, result: 'void' }, 0.5);
  g.wagers = [];
  g.ropes = [];
  // The world gives the survivor something to fight for: emptied places fill again.
  for (const s of open(g))
    if (s.world && s.content === 'empty' && rand(g) < 0.7) setContent(g, s, pickOne(g, TUNE.contentsPool as Content[]));
  say(g, { t: 'stand', seat: p.seat, need, left: g.stand.left, have: p.deck.length, start: true }, sec('stand'));
  while (g.stand.left > 0 && !p.out) {
    for (const sp of g.players.filter((x) => x.out)) {
      const taken = new Set(g.traps.map((t) => t.at));
      const options = open(g).filter((s) => s.id !== CENTRE && s.id !== p.at && !taken.has(s.id) && s.world).map((s) => s.id);
      if (!options.length) break;
      const a = yield* ask({ k: 'space', seat: sp.seat, why: 'trap', options }, 'space');
      const at = a && options.includes(a.at) ? a.at : pickOne(g, options);
      g.traps.push({ at, by: sp.seat });
      say(g, { t: 'trap', by: sp.seat, at }, sec('trap'));
    }
    g.round++;
    yield* turn(g, p);
    g.stand.left--;
    if (p.out) break;
    if (p.deck.length >= need) {
      g.winner = p.seat;
      say(g, { t: 'win', seat: p.seat, why: 'walkout' }, 8);
      return;
    }
    if (g.stand.left > 0) say(g, { t: 'stand', seat: p.seat, need, left: g.stand.left, have: p.deck.length, start: false }, sec('stand'));
  }
  g.spiritsWin = true;
  say(g, { t: 'worldWins', seat: p.seat, seats: seatsOf(g.players.filter((x) => x !== p)) }, 8);
}
