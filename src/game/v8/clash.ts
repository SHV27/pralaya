/**
 * The clash, as one pure function (owner's design 2026-10-30: real trump cards, no hierarchy). Two ordered teams of three; for
 * each lane a STAT is called and both cards compare it; the world's LAW may force the stat or flip the comparison; specials and
 * the STRIKE (timed blows) change the numbers. Every number on screen comes from `Lane` (its chips): the count-up shows exactly
 * why a lane was won. At most three chips per lane.
 */
import type { Law, Move, Type } from './types.ts';
import type { Stat, Stats } from './stats.ts';

export interface Fighter {
  id: string;
  /** Its family (one, or two for a fusion): a tilt in its stats and what disasters it dodges. Never a win over a family. */
  types: Type[];
  power: number;
  /** A fusion carries both moves. */
  moves: Move[];
  stats: Stats;
}
export type Side = 'me' | 'foe';
export interface Fired {
  side: Side;
  /** The lane of the creature that fires it. */
  lane: number;
  move: Move;
  /** SWAP / ECLIPSE / ROAR: the lane it aims at. */
  target: number;
}
export interface Chip {
  side: Side;
  /** What changed the number: 'ROAR −20', 'DOUBLE ×2', 'PERFECT +15', or a law. */
  text: string;
}
export interface Lane {
  me: Fighter | null;
  foe: Fighter | null;
  /** The stat this lane compared (my call). */
  stat: Stat;
  /** v10: the other side's call; both cards add both stats (null in the old single-call form). */
  stat2: Stat | null;
  mine: number;
  theirs: number;
  chips: Chip[];
  /** The single decisive cause, for the caption ("SPEED DECIDES"). */
  cause: string;
  res: 'me' | 'foe' | 'tie';
  /** Champions Only: this lane does not count. */
  idle: boolean;
}
export interface ClashOpts {
  law?: Law | null;
  /** Ties go to this side (Home Soil: whoever was here first). */
  ties?: Side | null;
  /** The Mirror Age: the lower number wins everywhere this round. */
  mirror?: boolean;
  /** v9: force each side adds per lane (a hero's Flex: +15). No timing in battles. */
  boost?: { me: readonly number[]; foe: readonly number[]; label?: { me: string; foe: string } };
  /** The Crooked Curse: that side's first lane is lost before it starts. */
  forfeit?: { me: boolean; foe: boolean };
  /** The stat called in each lane (Top Trumps): the caller chooses, both cards compare it. */
  calls?: readonly (Stat | null)[];
  /**
   * v10 (owner: "close calls"): the other side's call for each lane. Then BOTH calls count for both cards: a lane is
   * (my stat + their stat) against (my stat + their stat). The card lab (scripts/statlab2.ts) measured it: 31% of lanes within
   * 5 points, 63% of battles decided by the last lane, a team with a legendary wins 77% (one call alone: 9%, 11%, 99%).
   */
  foeCalls?: readonly (Stat | null)[];
  /** v13 TWISTS (owner: "kabhi kisi ke saath bhi kuch bhi add ho jaye"): a blind, random event in a lane, for either side. */
  twists?: readonly ({ side: Side; v: number; text: string } | null)[];
}
export interface ClashResult {
  lanes: Lane[];
  won: number;
  lost: number;
  outcome: 'win' | 'lose' | 'standoff';
  /** SNATCH: the foe lanes I capture besides the normal prize. */
  snatched: number[];
  /** The two orders after SWAP. */
  mine: (Fighter | null)[];
  theirs: (Fighter | null)[];
}

/** The stat a lane compares: a law can force it (the Cosmos: MAGIC; Lost Animals: SIZE). */
export function laneStat(law: Law | null | undefined, called: Stat | null | undefined): Stat {
  if (law === 'onlyTypes') return 'MAGIC';
  if (law === 'onlySize') return 'SIZE';
  return called ?? 'POWER';
}

export function resolve(
  mineIn: readonly (Fighter | null)[],
  theirsIn: readonly (Fighter | null)[],
  fired: readonly Fired[],
  opts: ClashOpts = {},
): ClashResult {
  const mine = [...mineIn];
  const theirs = [...theirsIn];
  const law = opts.law ?? null;
  for (const f of fired)
    if (f.move === 'SWAP' && f.target !== f.lane) {
      const other = f.side === 'me' ? theirs : mine;
      [other[f.lane], other[f.target]] = [other[f.target] ?? null, other[f.lane] ?? null];
    }
  const lanes: Lane[] = [];
  for (let i = 0; i < 3; i++) {
    const a = mine[i] ?? null;
    const b = theirs[i] ?? null;
    const idle = law === 'champions' && i !== 1;
    const stat = laneStat(law, opts.calls?.[i]);
    const s2 = opts.foeCalls?.[i] ?? null;
    const stat2 = s2 && s2 !== stat ? s2 : s2 ? stat : null;
    const sum = (f: Fighter) => f.stats[stat] + (stat2 ? f.stats[stat2] : 0);
    if (!a || !b) {
      const res = a ? 'me' : b ? 'foe' : 'tie';
      lanes.push({ me: a, foe: b, stat, stat2, mine: a ? sum(a) : 0, theirs: b ? sum(b) : 0, chips: [], cause: 'AN EMPTY LANE', res, idle });
      continue;
    }
    const chips: Chip[] = [];
    let va = sum(a);
    let vb = sum(b);
    let cause = '';
    if (law === 'onlyTypes') chips.push({ side: 'me', text: 'MAGIC ONLY' });
    if (law === 'onlySize') chips.push({ side: 'me', text: 'SIZE ONLY' });
    for (const f of fired) {
      if (f.move === 'ROAR' && f.target === i) {
        if (f.side === 'me') vb = Math.max(0, vb - 20);
        else va = Math.max(0, va - 20);
        chips.push({ side: f.side, text: 'ROAR −20' });
      }
      if (f.move === 'DOUBLE' && f.lane === i) {
        if (f.side === 'me') va *= 2;
        else vb *= 2;
        chips.push({ side: f.side, text: 'DOUBLE ×2' });
      }
    }
    const low = law === 'smallBeatsBig' || !!opts.mirror;
    const cmp = (x: number, y: number): Lane['res'] => (x === y ? 'tie' : x > y !== low ? 'me' : 'foe');
    const before = cmp(va, vb);
    if (opts.boost) {
      const sa = opts.boost.me[i] ?? 0;
      const sb = opts.boost.foe[i] ?? 0;
      // Under SMALL BEATS BIG a flex makes you smaller (it still helps).
      va += low ? -sa : sa;
      vb += low ? -sb : sb;
      if (sa) chips.unshift({ side: 'me', text: `${opts.boost.label?.me || 'FLEX'} +${sa}` });
      if (sb) chips.unshift({ side: 'foe', text: `${opts.boost.label?.foe || 'FLEX'} +${sb}` });
    }
    const tw = opts.twists?.[i];
    if (tw) {
      if (tw.side === 'me') va = Math.max(0, va + tw.v);
      else vb = Math.max(0, vb + tw.v);
      chips.unshift({ side: tw.side, text: `${tw.text} ${tw.v > 0 ? '+' : '−'}${Math.abs(tw.v)}` });
    }
    let res = cmp(va, vb);
    if (res !== before) cause = tw ? 'A TWIST DECIDES' : 'THE EDGE DECIDES';
    if (low && res !== 'tie' && !cause) cause = opts.mirror ? 'THE MIRROR: LOWER WINS' : 'SMALL BEATS BIG';
    for (const f of fired)
      if (f.move === 'REVERSE' && f.lane === i && res !== 'tie') {
        res = res === 'me' ? 'foe' : 'me';
        chips.push({ side: f.side, text: 'REVERSE' });
        cause = 'REVERSED';
      }
    for (const f of fired)
      if (f.move === 'ECLIPSE' && f.target === i) {
        res = 'tie';
        chips.push({ side: f.side, text: 'ECLIPSE' });
        cause = 'ECLIPSED';
      }
    if (i === 0 && opts.forfeit && opts.forfeit.me !== opts.forfeit.foe) {
      res = opts.forfeit.me ? 'foe' : 'me';
      chips.unshift({ side: opts.forfeit.me ? 'me' : 'foe', text: 'CURSED' });
      cause = 'THE CURSE DECIDES';
    }
    if (res === 'tie' && opts.ties) {
      res = opts.ties;
      chips.push({ side: opts.ties, text: 'HOME SOIL' });
      cause = 'HOME SOIL';
    }
    if (!cause) cause = res === 'tie' ? 'DEAD EVEN' : Math.abs(va - vb) <= 5 ? 'BY A HAIR' : `${res === 'me' ? 'YOURS' : 'THEIRS'}`;
    lanes.push({ me: a, foe: b, stat, stat2, mine: Math.max(0, va), theirs: Math.max(0, vb), chips: chips.slice(0, 3), cause, res, idle });
  }
  const counted = lanes.filter((l) => !l.idle);
  const won = counted.filter((l) => l.res === 'me').length;
  const lost = counted.filter((l) => l.res === 'foe').length;
  const snatched = fired
    .filter((f) => f.side === 'me' && f.move === 'SNATCH' && lanes[f.lane]?.res === 'me' && lanes[f.lane]!.foe)
    .map((f) => f.lane);
  return { lanes, won, lost, outcome: won > lost ? 'win' : won < lost ? 'lose' : 'standoff', snatched, mine, theirs };
}
