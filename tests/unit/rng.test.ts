import { describe, expect, it } from 'vitest';
import { next, seedRng } from '../../src/shared/rng.ts';

describe('rng', () => {
  it('is deterministic for a seed', () => {
    expect(next(seedRng(42))[0]).toBe(next(seedRng(42))[0]);
  });
  it('differs across seeds and stays in [0,1)', () => {
    let s = seedRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const [x, n] = next(s);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      seen.add(x);
      s = n;
    }
    expect(seen.size).toBe(1000);
    expect(next(seedRng(7))[0]).not.toBe(next(seedRng(8))[0]);
  });
});
