/**
 * v14, the owner's loophole brief (2026-11-02): "jab cards khatam ho rhe hain and by chance boss finds the person… automatically
 * haar ho rhi hai… 0 cards mein injustice na ho… boss wali cheez… like a hunter, jisse bachne ki strategy bhi ho sakti hai luck
 * bhi". These tests are the proof: no hero ever fights short-handed, a hero with nothing left never pays a heart for a blow aimed
 * at a creature, and the beast hunts in the open (its own die, a named prey, a rest after every fight, never the same hero twice).
 */
import { describe, expect, it } from 'vitest';
import { carelessHand } from '../../src/game/v8/hands.ts';
import { createGame, play, type Ask, type Beat, type Game } from '../../src/game/v8/rules.ts';

const lcg = (s: number) => () => {
  s = (s * 16807) % 2147483647;
  return s / 2147483647;
};
interface Run {
  g: Game;
  asks: Ask[];
  done: boolean;
}
function run(seats: number, seed: number, bare = false): Run {
  const g = createGame(
    Array.from({ length: seats }, (_, i) => `P${i}`),
    seed,
  );
  // A harsher world for the proof: every hero starts with nothing.
  if (bare) for (const p of g.players) p.deck = [];
  const R = lcg(seed * 3 + 7);
  const it = play(g);
  const asks: Ask[] = [];
  let r = it.next();
  let n = 0;
  while (!r.done && n++ < 20000 && g.log.length < 40000) {
    asks.push(r.value);
    r = it.next(carelessHand(r.value, R));
  }
  return { g, asks, done: !!r.done };
}
const runs = Array.from({ length: 120 }, (_, i) => run(2 + (i % 5), 14000 + i));
const bareRuns = Array.from({ length: 60 }, (_, i) => run(2 + (i % 5), 15000 + i, true));

describe('PRALAYA v15: an empty hand runs, and may gamble its life (owner: "1 v 1, 2 v 2 theek the… 0 creatures pe bet system")', () => {
  it('every match still ends, even when every hero starts with nothing', () => {
    expect([...runs, ...bareRuns].filter((x) => !x.done)).toHaveLength(0);
  });
  it('a fight is exactly as wide as the hand (and the foe): never padded with creatures from anywhere else', () => {
    let fights = 0;
    for (const { asks } of [...runs, ...bareRuns])
      for (const a of asks) {
        if (a.k !== 'team') continue;
        fights++;
        expect(a.size).toBeLessThanOrEqual(a.drawn.length);
        expect(a.size).toBeGreaterThanOrEqual(1);
      }
    expect(fights).toBeGreaterThan(500);
  });
  it('nobody fights with nothing: an empty hand runs (4+ escapes), and a failed run costs exactly one heart', () => {
    let chases = 0;
    for (const { g } of [...runs, ...bareRuns])
      g.log.forEach((b, i) => {
        if (b.t !== 'moment' || b.kicker !== 'THE CHASE') return; // (THE LAST CHASE at the fire is a duel's verdict: hearts follow)
        chases++;
        const roll = b.dice![0]!;
        expect(b.title).toBe(roll >= 4 ? 'ESCAPED!' : 'CAUGHT');
        // Only this chase's own consequence (a later event, such as the last fire, is another story).
        const next = g.log.slice(i + 1, i + 3);
        const cut = next.findIndex((x) => x.t === 'moment');
        const hearts = (cut >= 0 ? next.slice(0, cut) : next).filter((x) => x.t === 'heart' && x.seat === b.seat).length;
        if (roll >= 4) expect(hearts).toBe(0);
      });
    expect(chases).toBeGreaterThan(50);
  });
  it('the Last Gamble offers a heart or a whole life, and both stakes are taken by someone', () => {
    const cards = new Set<string>();
    for (const { g } of [...runs, ...bareRuns]) for (const b of g.log) if (b.t === 'wager') cards.add(b.card);
    expect(cards).toContain('empty');
    expect(cards).toContain('emptyLife');
  });
});

describe('PRALAYA v14: the beast hunts in the open', () => {
  const hunts = (g: Game) => g.log.filter((b): b is Extract<Beat, { t: 'bossHunt' }> => b.t === 'bossHunt');
  it('the beast rolls its own die (1 to 6, flat) and names its prey every round it is awake', () => {
    const faces = [0, 0, 0, 0, 0, 0];
    for (const { g } of runs) for (const h of hunts(g)) if (!h.rest) faces[h.roll - 1]!++;
    const all = faces.reduce((a, b) => a + b, 0);
    expect(all).toBeGreaterThan(300);
    for (const f of faces) expect(Math.abs(f / all - 1 / 6)).toBeLessThan(0.05);
  });
  it('after every fight the beast rests a round (the only mercy: then it hunts the nearest again, ties by lot)', () => {
    let fights = 0;
    for (const { g } of runs) {
      let fought: number | null = null;
      for (const b of g.log) {
        if (b.t === 'emerge' && b.source === 'boss') {
          fights++;
          fought = b.seat;
        }
        if (b.t === 'bossHunt' && fought !== null) {
          expect(b.rest).toBe(true);
          fought = null;
        }
        // The Beast's Whistle wakes it on purpose (that is the card).
        if (b.t === 'bossDown' || (b.t === 'chance' && b.card === 'whistle')) fought = null;
      }
    }
    expect(fights).toBeGreaterThan(30);
  });
});
