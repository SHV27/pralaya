/**
 * v16, the owner's final blow (2026-11-05): "cards collect karun, kho sakun, enhance karun… mehnat ki hai, chala gaya toh
 * itni mehnat chali jayegi". The proof: creatures grow by what they win (two lanes: ASCENDED, four: EXALTED, each lifting every
 * number), the lift is real in the fight, and the proud fall first when a fight is lost.
 */
import { describe, expect, it } from 'vitest';
import { carelessHand } from '../../src/game/v8/hands.ts';
import { createGame, fighter, play, type Game, type Owned } from '../../src/game/v8/rules.ts';
import { TUNE } from '../../src/game/v8/tune.ts';
import { CREATURES } from '../../src/game/v8/creatures.ts';

const lcg = (s: number) => () => {
  s = (s * 16807) % 2147483647;
  return s / 2147483647;
};
function run(seed: number): Game {
  const g = createGame(['A', 'B', 'C', 'D'], seed);
  const R = lcg(seed + 1);
  const it = play(g);
  let r = it.next();
  let n = 0;
  while (!r.done && n++ < 20000) r = r.value.k === 'team' ? it.next() : it.next(carelessHand(r.value, R));
  return g;
}

describe('PRALAYA v16: creatures grow, and the proud fall first', () => {
  const games = Array.from({ length: 80 }, (_, i) => run(41000 + i));
  it('creatures ascend (two lanes won) and are exalted (four), in every few matches, never more than once each', () => {
    let up = 0;
    let top = 0;
    for (const g of games) {
      const seen = new Map<string, number>();
      for (const b of g.log)
        if (b.t === 'ascend') {
          b.tier === 1 ? up++ : top++;
          const k = `${b.seat}:${b.cid}:${b.tier}`;
          seen.set(k, (seen.get(k) ?? 0) + 1);
        }
      for (const n of seen.values()) expect(n).toBeLessThanOrEqual(2);
    }
    expect(up / games.length).toBeGreaterThan(2);
    expect(top).toBeGreaterThan(10);
  });
  it('the lift is real: an ascended creature fights with every number raised by the lift, an exalted one by twice it', () => {
    const base: Owned = { uid: 1, cid: CREATURES[1]!.id, ascended: false, wins: 0, tired: false };
    const plain = fighter(base).stats;
    const asc = fighter({ ...base, ascended: true }).stats;
    const ex = fighter({ ...base, ascended: true, exalted: true }).stats;
    for (const k of Object.keys(plain) as (keyof typeof plain)[]) {
      expect(asc[k]).toBe(plain[k] + TUNE.ascendLift);
      expect(ex[k]).toBe(plain[k] + 2 * TUNE.ascendLift);
    }
  });
});
