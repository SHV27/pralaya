/**
 * Where everything sits in the broken world (D105): eight floating islands on an ellipse (the ring is seen at a slant, so it is
 * wider than tall) around the volcano of the Burning Heart. Each island carries its land's five places in the rules' own order
 * (three on the outer rim, the pass, the inner shrine facing the fire). Pure maths, no Pixi: unit-tested.
 * The rules graph (map.ts) is the authority on WHICH places connect; this file only says WHERE they are drawn.
 */
import { CENTRE, EXTRA0, INNER0, SPOKE0, type Space } from '../../game/v8/map.ts';

export const W = 4900;
export const H = 4000;
export const CX = W / 2;
export const CY = H / 2 + 60;
/** The ring of islands (an ellipse: the slant of the view). */
export const RING = { rx: 1720, ry: 1260 };
/** The drawn width of one island (its painting is scaled to this). */
export const ISLAND_W = 900;
export const VOLCANO_W = 980;
/** How flat the top of an island looks (perspective squash of the island's own surface). */
const FLAT = 0.6;

export interface Pt {
  x: number;
  y: number;
}

/** The angle of petal k (0 = north, clockwise; y grows downward). */
export const petalAngle = (k: number): number => ((k * 45 - 90) * Math.PI) / 180;

/** The centre of the island at petal k. */
export function islandAt(k: number): Pt {
  const a = petalAngle(k);
  return { x: CX + RING.rx * Math.cos(a), y: CY + RING.ry * Math.sin(a) };
}

/** Slot of a space within its petal: 0–2 outer rim, 3 the pass (spoke), 4 the inner shrine. -1 for the centre. */
export function slotOf(id: number): { k: number; slot: number } {
  if (id === CENTRE) return { k: -1, slot: -1 };
  if (id >= EXTRA0) return { k: Math.floor((id - EXTRA0) / 4), slot: 5 + ((id - EXTRA0) % 4) };
  if (id < SPOKE0) return { k: Math.floor(id / 3), slot: id % 3 };
  if (id < INNER0) return { k: id - SPOKE0, slot: 3 };
  return { k: id - INNER0, slot: 4 };
}

/** Each slot's offset on its island: [outward, clockwise] in island units (squashed by FLAT on screen). */
const SLOT: readonly (readonly [number, number])[] = [
  [215, -265],
  [300, 0],
  [215, 265],
  [20, 0],
  [-250, 0],
  // v9 back country: two trails behind the rim, two clearings beside the crossroads.
  [-170, -260],
  [-170, 260],
  [110, -150],
  [110, 150],
];

/** Where a place is drawn (world units). The fire sits on the volcano's crown. */
export function placeAt(id: number): Pt {
  if (id === CENTRE) return { x: CX, y: CY - 150 };
  const { k, slot } = slotOf(id);
  const c = islandAt(k);
  const a = petalAngle(k);
  const [r, s] = SLOT[slot]!;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  return { x: c.x + r * ux - s * uy, y: c.y + (r * uy + s * ux) * FLAT - 40 };
}

/** Two places on different islands (or an island and the volcano) are joined by a rope bridge, not a footpath. */
export function isRope(a: number, b: number): boolean {
  const ka = slotOf(a).k;
  const kb = slotOf(b).k;
  return ka !== kb;
}

/** A road between two places: a gentle curve (control point), and for ropes the sag of the rope under its own weight. */
export function roadCurve(a: Pt, b: Pt, rope: boolean): { c: Pt; len: number } {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (rope) return { c: { x: mx, y: my + Math.min(160, len * 0.18) }, len };
  // A footpath bends a little, always to the same side of the travel direction (hand-drawn, never a ruler line).
  return { c: { x: mx - dy * 0.12, y: my + dx * 0.12 }, len };
}

/** A point on a quadratic curve. */
export function onCurve(a: Pt, c: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/** The camera's three tiers (feel-v8 verdict 1), as multiples of the zoom that fits the whole world on screen. */
export const TIER = { overview: 1, region: 2.1, close: 3.2 } as const;
export type Tier = keyof typeof TIER;

/** The zoom that fits a rectangle of world units into the screen (with a margin). */
export function fitZoom(sw: number, sh: number, w: number, h: number, margin = 0.9): number {
  return Math.min((sw * margin) / w, (sh * margin) / h);
}

/** Clamp a camera centre so the view never leaves the world (camera-systems: clamp the view, not the centre). */
export function clampCentre(x: number, y: number, z: number, sw: number, sh: number): Pt {
  const hw = sw / 2 / z;
  const hh = sh / 2 / z;
  const cx = hw * 2 >= W ? W / 2 : Math.min(Math.max(x, hw), W - hw);
  const cy = hh * 2 >= H ? H / 2 : Math.min(Math.max(y, hh), H - hh);
  return { x: cx, y: cy };
}

/** The bounds of a set of places (to frame choices: every option on screen at once). */
export function boundsOf(ids: readonly number[]): { x: number; y: number; w: number; h: number } {
  const ps = ids.map(placeAt);
  const x0 = Math.min(...ps.map((p) => p.x));
  const x1 = Math.max(...ps.map((p) => p.x));
  const y0 = Math.min(...ps.map((p) => p.y));
  const y1 = Math.max(...ps.map((p) => p.y));
  return {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    w: Math.max(500, x1 - x0 + 360),
    h: Math.max(380, y1 - y0 + 300),
  };
}

/** Every road of a board, once each, with whether it is a rope bridge. */
export function roadsOf(spaces: readonly Space[]): { a: number; b: number; rope: boolean }[] {
  const out: { a: number; b: number; rope: boolean }[] = [];
  for (const s of spaces)
    for (const n of s.adj) if (n > s.id) out.push({ a: s.id, b: n, rope: isRope(s.id, n) });
  return out;
}
