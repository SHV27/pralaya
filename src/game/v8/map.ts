/**
 * The cosmic mandala (GDD-v8 §3): 8 worlds as petals around the burning centre. Each world owns 3 outer-ring spaces, a spoke
 * and an inner-ring space. The outer ring and the inner ring are loops; spokes and four bridges cross between them, and four
 * inner spaces open onto the centre. Board units: a 1000 × 1000 square, y grows downward, the centre at (500, 500).
 */
import { WORLDS, type WorldId } from './types.ts';

export type Content = 'lair' | 'disaster' | 'riddle' | 'cache' | 'empty' | 'gate' | 'nest' | 'hilo' | 'tame' | 'altar' | 'trader' | 'golden' | 'wheel' | 'cave' | 'trust' | 'gauntlet' | 'ring' | 'pier' | 'shrine' | 'oathStone';
export type Ring = 'outer' | 'spoke' | 'inner' | 'centre';

export interface Space {
  id: number;
  world: WorldId | null;
  ring: Ring;
  x: number;
  y: number;
  adj: number[];
  content: Content;
  /** Eaten by the world: gone for good (the centre is never eaten). */
  void: boolean;
  /** Someone has stood here or seen into it (fog lifts; the Long Eclipse darkens everything again). */
  seen: boolean;
  /** v16: something a world event placed here on purpose (a star-fall cache, a rumoured lair): the next landing finds it. */
  fixed?: boolean;
}

export const OUTER = 24;
export const SPOKE0 = 24;
export const INNER0 = 32;
export const CENTRE = 40;
/** v9 (owner: "complicated sa bada sa map"): four more places per island, after the fire: 41 + 4k … 44 + 4k. */
export const EXTRA0 = 41;
export const BOARD = 1000;

const R_OUTER = 430;
const R_SPOKE = 290;
const R_INNER = 165;

/** The world a petal shows at position k (worlds swap in a Great Rewire, so this is per match state, not a constant). */
export function makeBoard(order: readonly WorldId[] = WORLDS): Space[] {
  const s: Space[] = [];
  const at = (deg: number, r: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return { x: Math.round(500 + r * Math.cos(a)), y: Math.round(500 + r * Math.sin(a)) };
  };
  const add = (world: WorldId | null, ring: Ring, deg: number, r: number) =>
    s.push({ id: s.length, world, ring, ...at(deg, r), adj: [], content: 'empty', void: false, seen: false });
  for (let k = 0; k < 8; k++) for (const d of [-15, 0, 15]) add(order[k]!, 'outer', k * 45 + d, R_OUTER);
  for (let k = 0; k < 8; k++) add(order[k]!, 'spoke', k * 45, R_SPOKE);
  for (let k = 0; k < 8; k++) add(order[k]!, 'inner', k * 45, R_INNER);
  add(null, 'centre', 0, 0);
  s[CENTRE]!.content = 'gate';
  // The back country: two trails behind the rim (5, 6) and two clearings beside the crossroads (7, 8) on every island.
  for (let k = 0; k < 8; k++) for (const d of [-22, 22, -9, 9]) add(order[k]!, 'spoke', k * 45 + d, R_SPOKE + 40);

  const link = (a: number, b: number) => {
    if (!s[a]!.adj.includes(b)) s[a]!.adj.push(b);
    if (!s[b]!.adj.includes(a)) s[b]!.adj.push(a);
  };
  for (let i = 0; i < OUTER; i++) link(i, (i + 1) % OUTER);
  for (let k = 0; k < 8; k++) {
    link(3 * k + 1, SPOKE0 + k);
    link(SPOKE0 + k, INNER0 + k);
    link(INNER0 + k, INNER0 + ((k + 1) % 8));
    // v10 (owner: "lands aapas mein connected hon har land dusre se"): the Burning Heart opens onto every land.
    link(INNER0 + k, CENTRE);
    // v9 (owner: "map bahut juda ho aapas mein"): every island's spoke is a crossroads of its three outer places, and every
    // island throws rope bridges both ways to its neighbours' crossroads, so a roll always offers real choices.
    link(3 * k, SPOKE0 + k);
    link(3 * k + 2, SPOKE0 + k);
    link(3 * k + 2, SPOKE0 + ((k + 1) % 8));
    link(3 * k, SPOKE0 + ((k + 7) % 8));
    // The back country: a tangle of trails, and a second ring of rope bridges between islands.
    const [t5, t6, c7, c8] = [0, 1, 2, 3].map((i) => EXTRA0 + 4 * k + i) as [number, number, number, number];
    link(3 * k, c7);
    link(c7, SPOKE0 + k);
    link(c7, t5);
    link(3 * k + 2, c8);
    link(c8, SPOKE0 + k);
    link(c8, t6);
    link(t5, INNER0 + k);
    link(t6, INNER0 + k);
    link(3 * k + 1, c7);
    link(3 * k + 1, c8);
    link(t6, EXTRA0 + 4 * ((k + 1) % 8));
  }
  return s;
}

/** The spaces of one world (5), in petal order. */
export const worldSpaces = (s: readonly Space[], w: WorldId): Space[] => s.filter((x) => x.world === w);

/** Where you can step from `at`, never back where you just came from (unless that is the only way), never into the void. */
export function exits(s: readonly Space[], at: number, from: number | null): number[] {
  const open = s[at]!.adj.filter((n) => !s[n]!.void);
  const forward = open.filter((n) => n !== from);
  return forward.length ? forward : open;
}

/** Shortest open path length between two spaces (BFS); Infinity if cut off. */
export function distance(s: readonly Space[], a: number, b: number): number {
  const seen = new Map<number, number>([[a, 0]]);
  const q = [a];
  while (q.length) {
    const n = q.shift()!;
    if (n === b) return seen.get(n)!;
    for (const m of s[n]!.adj)
      if (!s[m]!.void && !seen.has(m)) {
        seen.set(m, seen.get(n)! + 1);
        q.push(m);
      }
  }
  return Infinity;
}

/** Steps from `at` toward `goal` along open paths (the first step of a shortest path), or null. */
export function towards(s: readonly Space[], at: number, goal: (x: Space) => boolean, avoid = -1): number | null {
  const prev = new Map<number, number>([[at, -1]]);
  if (avoid >= 0 && avoid !== at) prev.set(avoid, -2);
  const q = [at];
  while (q.length) {
    const n = q.shift()!;
    if (n !== at && goal(s[n]!)) {
      let c = n;
      while (prev.get(c) !== at) c = prev.get(c)!;
      return c;
    }
    for (const m of s[n]!.adj)
      if (!s[m]!.void && !prev.has(m)) {
        prev.set(m, n);
        q.push(m);
      }
  }
  return null;
}
/** A bridge joins an outer space to a spoke that is not its own world's spoke. */
export const isBridge = (s: readonly Space[], a: number, b: number): boolean => {
  const [x, y] = [s[a]!, s[b]!];
  const pair = (o: Space, k: Space) => o.ring === 'outer' && k.ring === 'spoke' && Math.floor(o.id / 3) !== k.id - SPOKE0;
  return pair(x, y) || pair(y, x);
};
