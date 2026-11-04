/** sfc32 PRNG with serializable state. Deterministic: same state in → same numbers out. */
export type RngState = readonly [number, number, number, number];

export function seedRng(seed: number): RngState {
  let s: [number, number, number, number] = [0x9e3779b9, 0x243f6a88, 0xb7e15162, seed >>> 0];
  for (let i = 0; i < 15; i++) s = next(s)[1];
  return s;
}

/** Fisher–Yates shuffle driven by the PRNG. Pure: returns [shuffled copy, next state]. */
export function shuffle<T>(items: readonly T[], state: RngState): [T[], RngState] {
  const out = items.slice();
  let s: RngState = state;
  for (let i = out.length - 1; i > 0; i--) {
    const [r, n] = next(s);
    s = n;
    const j = Math.floor(r * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return [out, s];
}

/** Returns [uniform float in [0,1), next state]. Pure. */
export function next(state: RngState): [number, [number, number, number, number]] {
  let [a, b, c, d] = state;
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  return [(t >>> 0) / 4294967296, [a, b, c, d]];
}
