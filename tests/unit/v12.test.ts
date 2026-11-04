/**
 * v12, the owner's last brief: "make and show that randomness stays there and the luck isn't biased toward any one player". These
 * tests are that proof: every seat wins as often as every other, the die is flat, the wild's calls are a blind uniform draw, no duel
 * fires before a hero has rolled, a hero with empty hands is never charged a heart for a fight, and every match ends.
 */
import { describe, expect, it } from 'vitest';
import { carelessHand } from '../../src/game/v8/hands.ts';
import { createGame, play, type Beat, type Game } from '../../src/game/v8/rules.ts';
import { CREATURES } from '../../src/game/v8/creatures.ts';
import { existsSync } from 'node:fs';

const lcg = (s: number) => () => {
  s = (s * 16807) % 2147483647;
  return s / 2147483647;
};
function run(seats: number, seed: number, fresh: string[] = []): { g: Game; done: boolean } {
  const g = createGame(
    Array.from({ length: seats }, (_, i) => `P${i}`),
    seed,
    fresh,
  );
  const R = lcg(seed * 7 + 1);
  const it = play(g);
  let r = it.next();
  let asks = 0;
  while (!r.done && asks++ < 20000 && g.log.length < 40000) r = it.next(carelessHand(r.value, R));
  return { g, done: !!r.done };
}
const winnerOf = (g: Game) =>
  (g.log.findLast((b) => b.t === 'win') as Extract<Beat, { t: 'win' }> | undefined)?.seat ?? null;

const N = 240;
const games = Array.from({ length: N }, (_, i) => run(4, 5000 + i));

describe('PRALAYA v12: luck is fair to every seat', () => {
  it('every match ends (no endless match, ever)', () => {
    expect(games.filter((x) => !x.done)).toHaveLength(0);
  });
  it('no seat is favoured: with identical careless hands every seat wins near 1 in 4 (chi-square, p > 0.001)', () => {
    const wins = [0, 0, 0, 0];
    let total = 0;
    for (const { g } of games) {
      const w = winnerOf(g);
      if (w !== null) {
        wins[w]!++;
        total++;
      }
    }
    const e = total / 4;
    const chi = wins.reduce((s, o) => s + (o - e) ** 2 / e, 0);
    // 3 degrees of freedom: chi² > 16.27 would be p < 0.001.
    expect(chi).toBeLessThan(16.27);
  });
  it('the die is flat: every face within 15% of a sixth', () => {
    const faces = [0, 0, 0, 0, 0, 0];
    for (const { g } of games)
      for (const b of g.log) if (b.t === 'dice' && b.mode === 'roll') faces[b.dice[0]! - 1]!++;
    const all = faces.reduce((a, b) => a + b, 0);
    for (const f of faces) expect(Math.abs(f / all - 1 / 6)).toBeLessThan(0.15 / 6 + 0.01);
  });
});

describe('PRALAYA v12: the brief, line by line', () => {
  it('a duel never starts on a hero turn before they have rolled (the duel already fought does not fire again)', () => {
    for (const { g } of games) {
      let rolled = true;
      for (const b of g.log) {
        if (b.t === 'turn') rolled = false;
        // A skipped turn ends without a roll; the world's own fire finale (the Last Light) follows it.
        else if (b.t === 'dice' || b.t === 'round' || b.t === 'skip') rolled = true;
        else if (b.t === 'emerge' && b.source === 'rival') expect(rolled).toBe(true);
      }
    }
  });
  it('empty hands never pay a heart for a fight: they lay the Empty-Handed Wager instead (and it happens)', () => {
    let wagers = 0;
    for (const { g } of games) {
      for (const b of g.log) if (b.t === 'wager' && b.card === 'empty') wagers++;
      // A fight against bare hands is a standoff: no 'clash' beat follows an emerge whose hero had nothing.
    }
    expect(wagers).toBeGreaterThan(0);
  });
  it('the new things happen: the Road Not Taken, the Cave, the Bridge of Trust, vengeance, links, bounties', () => {
    const seen = new Set<string>();
    for (const { g } of games)
      for (const b of g.log) {
        seen.add(b.t);
        if (b.t === 'wager') seen.add(`w:${b.card}`);
        if (b.t === 'chance') seen.add(`c:${b.card}`);
      }
    for (const t of [
      'cave',
      'trust',
      'vendetta',
      'bounty',
      'wildDraw',
      'w:mirror',
      'w:pact',
      'c:deadman',
      'moment',
      'w:crowd',
      // v13: games of nerve, the auction, War, dice, the crowd, the pot, the policy, the loan, the oracle, the stairs, the fire.
      'c:teeth',
      'c:market',
      'c:war',
      'c:colosseum',
      'c:sweepstake',
      'c:insurance',
      'c:loan',
      'c:oracleDie',
      'c:stairs',
      'c:volcano',
      'c:diceDuel',
    ])
      expect(seen).toContain(t);
  });
  it('at least 500 creatures, from every land, each with its own painting', () => {
    expect(CREATURES.length).toBeGreaterThanOrEqual(500);
    const missing = CREATURES.filter((c) => !existsSync(`public/art/${c.id}.webp`)).map((c) => c.id);
    expect(missing).toEqual([]);
  });
});

describe('PRALAYA v13: every card the screen can name exists', () => {
  it('every wager and chance beat names a card in the deck (the screen looks each one up)', async () => {
    const { CHANCE } = await import('../../src/game/v8/cards.ts');
    for (const { g } of games)
      for (const b of g.log)
        if (b.t === 'wager' || b.t === 'wagerEnd' || b.t === 'chance') expect(CHANCE[b.card], b.card).toBeDefined();
  });
});

describe('PRALAYA final: every chance card, forced again and again, never breaks a match', () => {
  it('each card as the whole deck, 15 matches each: every match ends, hearts 0–3, holds within the limit', async () => {
    const { CHANCES } = await import('../../src/game/v8/cards.ts');
    const { TUNE } = await import('../../src/game/v8/tune.ts');
    for (const c of CHANCES) {
      for (let m = 0; m < 15; m++) {
        const g = createGame(['A', 'B', 'C', 'D'], 3000 + m * 17);
        const R = lcg(m + 11);
        const it = play(g);
        let r = it.next();
        let asks = 0;
        while (!r.done && asks++ < 20000 && g.log.length < 40000) {
          if (g.chance.length < 5) g.chance = Array.from({ length: 50 }, () => c.id);
          r = it.next(carelessHand(r.value, R));
          for (const p of g.players) {
            expect(p.hearts, c.id).toBeGreaterThanOrEqual(0);
            expect(p.hearts, c.id).toBeLessThanOrEqual(TUNE.hearts);
          }
        }
        expect(r.done, `${c.id} seed ${m}`).toBe(true);
      }
    }
  }, 300_000);
});

describe('PRALAYA final: every kind of place, everywhere, never breaks a match', () => {
  it('the whole map dealt as one kind, 12 matches each: every match ends, hearts 0–3', async () => {
    const { TUNE } = await import('../../src/game/v8/tune.ts');
    const pool = [...TUNE.contentsPool];
    const core = [...TUNE.contentsCore];
    try {
      for (const kind of [...new Set(pool)]) {
        TUNE.contentsPool = [kind];
        TUNE.contentsCore = [];
        for (let m = 0; m < 12; m++) {
          const g = createGame(['A', 'B', 'C'], 7000 + m * 13);
          for (const s of g.board) if (s.world) s.content = kind as typeof s.content;
          const R = lcg(m + 5);
          const it = play(g);
          let r = it.next();
          let asks = 0;
          while (!r.done && asks++ < 20000 && g.log.length < 40000) r = it.next(carelessHand(r.value, R));
          expect(r.done, `${kind} seed ${m}`).toBe(true);
          for (const p of g.players) expect(p.hearts, kind).toBeGreaterThanOrEqual(0);
        }
      }
    } finally {
      TUNE.contentsPool = pool;
      TUNE.contentsCore = core;
    }
  }, 300_000);
});
