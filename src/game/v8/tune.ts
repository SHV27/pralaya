/** Every number PRALAYA plays by (GDD-v8). The sim gate (scripts/sim8.ts) tunes these; `T_<key>=json` overrides in the sim. */
export const TUNE = {
  hearts: 3,
  startDeck: 4,
  hold: 6,
  draw: 4,
  homeBonus: 2,
  /** v9: no ascension (it fired free specials; battles are pure Top Trumps now). */
  /** v16: lanes won for you before a creature ASCENDS, then is EXALTED; each tier lifts every number by ascendLift. */
  ascendWins: 2,
  exaltWins: 4,
  ascendLift: 8,
  /** Losing this many lanes to a wild team costs a heart as well as a creature (owner G2). */
  heartAtLanes: 1,
  ascendPower: 3,
  fuseBonus: 2,
  /** Seconds each kind of moment takes on screen (the timing model; p = clock / target). */
  secs: {
    turn: 1,
    strike: 1.5,
    hunter: 3,
    encounter: 6,
    fates: 2,
    fateKept: 1.2,
    land: 1.2,
    emerge: 3,
    tell: 0,
    orders: 2.5,
    fired: 2.5,
    clash: 8,
    eat: 5,
    flip: 10,
    disaster: 6,
    riddle: 8,
    cache: 3,
    world: 2,
    chance: 4,
    dice: 1.6,
    news: 2,
    wager: 2.5,
    bomb: 2.5,
    trial: 2,
    boss: 5,
    bossHit: 3,
    power: 2.5,
    stampede: 3,
    weather: 2,
    nest: 3,
    attack: 5,
    hilo: 2.5,
    mod: 2.5,
    stand: 5,
    door: 4,
    wheel: 5,
    trap: 1.5,
    roads: 1.5,
    cave: 2.5,
    trust: 5,
  } as Record<string, number>,
  /** Typical thinking time per decision (seconds), from research/v8/timing-v8.md: counted into the clock. */
  think: { choice: 3, deeper: 3, hilo: 3, roll: 2, predict: 3, pick: 3, trial: 2.5, encounter: 4, strike: 3, fate: 3.5, steps: 2, fork: 2, target: 3, world: 3, space: 3, golden: 4, team: 6, move: 4, riddle: 5, release: 3, fuse: 4, boon: 4, wish: 3, doom: 3, stop: 2, pull: 2 } as Record<string, number>,
  /** Target match length in seconds: base + perSeat × seats (6p 690 s, 4p 570 s, 2p 450 s; D104). */
  target: { base: 600, perSeat: 150 },
  /** Eat schedule by progress p: nothing before `eatStart`; single spaces, then a chunk, then a whole world. */
  eatStart: 0.15,
  eatChunkAt: 0.3,
  eatWorldAt: 0.6,
  omenHonest: 0.7,
  /** The world strikes someone with its disaster after every round from this progress on (two in a Frenzy). */
  strikeStart: 0.2,
  /** Strikes per round grow with progress: 1 + floor(p × ramp) (+1 in a Frenzy). */
  strikeRamp: 0,
  /** At most this many extra strikes from fallen players. */
  strikeFallenCap: 3,
  /** Before this progress, a blow that would knock someone out takes a creature instead. */
  noKnockoutBefore: 0.35,
  /** v12 (owner: "koi biasness nahi"): the world never aims at the leader; every target is a fair draw. */
  grudge: 0,
  /** v12 home ground: added to every stat of a wild card (the wild calls blind; this keeps it dangerous, fairly). */
  wildHome: 0,
  /** v13 twists: the chance of a random twist in each lane, and its size. */
  twistChance: 0.35,
  /** v15: the wild calls blind, one of its own best N stats (6 = any stat at all). */
  wildTop: 3,
  twistLo: 8,
  twistHi: 26,
  flips: [0.35, 0.65],
  finalTurns: 0.65,
  /** The Last Light begins for everyone at this progress (or when two remain). */
  lastLightAt: 0.85,
  /** The light is almost out: every survivor is cut to one heart. */
  dimAt: 1.1,
  /** Wild teams: 2 creatures before this round, 3 after. Power cap rises with p. */
  smallTeamsUntil: 0,
  powerCap: { base: 7, slope: 4 },
  legendaryChance: 0.04,
  rareChance: 0.2,
  rumour: 1 / 6,
  spiritChoose: 0.3,
  spiritNasty: 1 / 8,
  revive: { from: 0.6, chance: 0.04 },
  goldenTurns: [2, 4],
  /** Probability that a fate pair contains each kind. */
  fateWeights: { move: 55, portal: 15, nasty: 15, gamble: 10, quiet: 5 } as Record<string, number>,
  /** v10: what each land's nine places hold: this core, plus a random draw from the pool (shuffled per match, per land). */
  /** v13: no fixed core; every land deals 9 of the pool without replacement (every kind once, battles twice, chance cards four times: the deck is where the variety lives). */
  contentsCore: [] as string[],
  contentsPool: ['lair', 'lair', 'empty', 'empty', 'empty', 'empty', 'riddle', 'cache', 'nest', 'hilo', 'tame', 'altar', 'trader', 'golden', 'wheel', 'cave', 'trust', 'gauntlet', 'disaster', 'ring', 'pier', 'shrine', 'oathStone'] as string[],
  /** v13 a Miracle or the Pharaoh's Curse holds one time in three when it turns up (else the next card). */
  jackpotHolds: 0.34,
  /** v12 the Cave of Echoes: the chance the roof comes down at each step deeper (press your luck). */
  caveRisk: [0.12, 0.3, 0.5] as number[],
  /** The jungle's strike per lane: [miss, good] probabilities (perfect is the rest). */
  wildStrike: [0.35, 0.45] as [number, number],
  /** The hunts: at most this many beasts loose at once; steps a hunt runs per round; chance a lair wakes each hunting round. */
  /** A riddle place hosts an ENCOUNTER (pick one of three) instead, this often. */
  encounterShare: 0.5,
  huntersMax: 1,
  hunterSteps: 2,
  hunterWake: 0.35,
  /** v9: the hero's power is first ready on turn 2, then every 3 turns (owner follow-up). */
  powerFirst: 2,
  powerEvery: 3,
  /** The world boss wakes at this progress; its health is shared (base + perSeat × seats); it walks this many steps a round. */
  bossAt: 0.15,
  bossHp: { base: 1, perSeat: 1 },
  bossSteps: 6,
  /** Stampedes cross a land at the end of a round, from this progress, this often. */
  stampedeAt: 0.25,
  stampedeChance: 0.35,
  /** When a bet that rides a rival's win pays, it is a heart this often (else a creature): hearts are rare. */
  rideHeart: 0.2,
  relicsStart: 0,
  relicsMax: 0,
  escapeRelics: 99,
  /** v10 the land strikes before a turn: chance = base + ramp × progress; its number is lo..hi (+ grow × progress). */
  attackBase: 0.1,
  attackRamp: 0.12,
  attackLo: 38,
  attackHi: 70,
  attackGrow: 8,
  /** v9's round-end disasters are replaced by the land strikes (kept switchable for the sim). */
  roundStrikes: false,
  /** A hex lowers every stat of one creature by this much. */
  hex: 12,
  /** The Last Stand: creatures needed to walk out, and the survivor's turns to find them. */
  walkOut: 4,
  standTurns: 5,
  /** v11 Death's Door: the roll that keeps a falling hero (5 or 6: one in three), once a match each. */
  doorAt: 5,
  /** v11 Blood Moon: from this progress, this chance each round. */
  bloodAt: 0.2,
  bloodChance: 0.2,
};
export type Tune = typeof TUNE;
