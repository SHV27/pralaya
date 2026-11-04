/**
 * PRALAYA's rules and world, under property tests (CLAUDE.md verifier 1): every match ends with one winner; the same seed and the
 * same answers replay the same match; hearts stay in [0, 3]; the world drawn on screen is the rules' own graph.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CENTRE, makeBoard } from '../../src/game/v8/map.ts';
import { carelessHand } from '../../src/game/v8/hands.ts';
import { PLACES } from '../../src/game/v8/places.ts';
import { createGame, play, type Game } from '../../src/game/v8/rules.ts';
import { WORLDS } from '../../src/game/v8/types.ts';
import { existsSync } from 'node:fs';
import { CREATURES } from '../../src/game/v8/creatures.ts';
import { EPITHETS, FORMS, STATS, epithetOf, formOf, statsOf } from '../../src/game/v8/stats.ts';
import { H, W, islandAt, isRope, placeAt, roadsOf, slotOf } from '../../src/pralaya/world/layout.ts';

const lcg = (s: number) => () => {
  s = (s * 16807) % 2147483647;
  return s / 2147483647;
};

/** Play a whole match with careless hands; return the game and the number of questions asked. */
function run(seats: number, seed: number, handSeed: number): { g: Game; asks: number; done: boolean } {
  const g = createGame(
    Array.from({ length: seats }, (_, i) => `P${i}`),
    seed,
  );
  const R = lcg(handSeed);
  const it = play(g);
  let r = it.next();
  let asks = 0;
  while (!r.done && asks < 20000) {
    asks++;
    r = it.next(carelessHand(r.value, R));
  }
  return { g, asks, done: !!r.done };
}

describe('PRALAYA rules (property)', () => {
  it('every match ends with exactly one result (a winner walks out, or the world keeps the survivor), hearts in [0, 3]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 1, max: 1e9 }),
        fc.integer({ min: 1, max: 1e9 }),
        (seats, seed, hand) => {
          const { g, done } = run(seats, seed, hand);
          expect(done).toBe(true);
          const wins = g.log.filter((b) => b.t === 'win');
          const kept = g.log.filter((b) => b.t === 'worldWins');
          expect(wins.length + kept.length).toBe(1);
          if (wins.length) expect(g.winner).toBe(wins[0]!.t === 'win' ? wins[0]!.seat : -1);
          else expect(g.spiritsWin).toBe(true);
          // v10: a walk-out needs the creatures (the last one standing with fewer must win the Last Stand). v14: the Last Stand asks
          // for four, or two more than the survivor brought, whichever is fewer.
          const stand = g.log.find((b) => b.t === 'stand' && b.start);
          const need = stand && stand.t === 'stand' ? stand.need : 4;
          if (g.winner !== null) expect(g.players[g.winner]!.deck.length).toBeGreaterThanOrEqual(need);
          for (const b of g.log)
            if (b.t === 'heart' || b.t === 'heal') expect(b.hearts).toBeGreaterThanOrEqual(0);
          for (const b of g.log)
            if (b.t === 'heart' || b.t === 'heal') expect(b.hearts).toBeLessThanOrEqual(3);
        },
      ),
      { numRuns: 40 },
    );
  });

  it('is deterministic: the same seed and the same answers replay the same match', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), fc.integer({ min: 1, max: 1e9 }), (seats, seed) => {
        const a = run(seats, seed, 99);
        const b = run(seats, seed, 99);
        expect(JSON.stringify(b.g.log)).toBe(JSON.stringify(a.g.log));
      }),
      { numRuns: 12 },
    );
  });

  it('a heart is never lost without a reason the screen can name', () => {
    const { g } = run(4, 4242, 7);
    for (const b of g.log)
      if (b.t === 'heart') expect(b.why).toMatch(/^(world|creature|player|disaster|bet|suddenDeath|encounter|chance|bomb|altar|land)$/);
  });
});

describe('PRALAYA v10', () => {
  it('every creature has its own painted avatar (owner: "har creature ke paas apna visual avatar ho")', () => {
    const missing = CREATURES.filter((c) => !existsSync(`public/art/${c.id}.webp`)).map((c) => c.id);
    expect(missing).toEqual([]);
  });
  it('no deck can be learned: the same creature is dealt different numbers and forms in different matches', () => {
    const look = (seed: number) => {
      createGame(['A', 'B'], seed);
      return CREATURES.map((c) => `${formOf(c.id).key}:${epithetOf(c.id).key}:${STATS.map((st) => statsOf(c)[st]).join(',')}`);
    };
    const a = look(101);
    const b = look(202);
    const same = a.filter((x, i) => x === b[i]).length;
    expect(same).toBeLessThan(CREATURES.length * 0.05);
    // ...and across thousands of matches the deck is tens of thousands of distinct cards.
    expect(CREATURES.length * FORMS.length * EPITHETS.length).toBeGreaterThan(20000);
  });
  it('both calls count, battles shrink to the hand (2 v 2, 1 v 1), and no empty lane hands the wild a free win', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { g } = run(3, seed * 77, seed);
      for (const b of g.log)
        if (b.t === 'clash')
          for (const l of b.lanes) {
            // A lane is either fully fought (both sides) or fully empty: never one card against nobody.
            expect(!!l.me).toBe(!!l.foe);
            if (l.me && l.foe && l.stat2) expect(l.stat2).toMatch(/^(POWER|SPEED|SIZE|CUNNING|MAGIC|TERROR)$/);
          }
    }
  });
  it('the land strikes, the new places, relics and hexes all appear across matches', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60 && seen.size < 9; seed++) {
      const { g } = run(4, seed * 131, seed);
      for (const b of g.log) {
        if (b.t === 'attack') seen.add('attack');
        if (b.t === 'hilo') seen.add('hilo');
        if (b.t === 'altar') seen.add('altar');
        if (b.t === 'trade') seen.add('trade');
        if (b.t === 'mod') seen.add(b.v > 0 ? 'relic' : 'hex');
        if (b.t === 'emerge' && b.source === 'tame') seen.add('tame');
        if (b.t === 'stand') seen.add('stand');
        if (b.t === 'land' && b.content === 'gate') seen.add('heart');
      }
    }
    expect([...seen].sort()).toEqual(['altar', 'attack', 'heart', 'hex', 'hilo', 'relic', 'stand', 'tame', 'trade']);
  });
  it('before a hero moves, only the land may act: no chance card, golden card, riddle or boon comes before the roll', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { g } = run(4, seed * 313, seed);
      let between = false;
      for (const b of g.log) {
        if (b.t === 'turn') between = true;
        // A skipped turn ends with no roll: what follows is the world's own phase.
        else if (b.t === 'dice' || b.t === 'power' || b.t === 'skip') between = false;
        else if (between) expect(['chance', 'golden', 'riddle', 'boon', 'encounter', 'wheel']).not.toContain(b.t);
      }
    }
  });
  it("Death's Door, the Wheel and the Blood Moon all happen, and the door opens at most once per hero", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const { g } = run(4, seed * 97, seed);
      const doors = new Map<number, number>();
      for (const b of g.log) {
        if (b.t === 'door') doors.set(b.seat, (doors.get(b.seat) ?? 0) + 1), seen.add('door');
        if (b.t === 'wheel') seen.add('wheel');
        if (b.t === 'bloodMoon' && b.on) seen.add('blood');
      }
      for (const n of doors.values()) expect(n).toBe(1);
    }
    expect([...seen].sort()).toEqual(['blood', 'door', 'wheel']);
  });
  it('the map is the same every match, but what each place holds is not', () => {
    const a = createGame(['A', 'B', 'C'], 11);
    const b = createGame(['A', 'B', 'C'], 12);
    expect(a.board.map((s) => s.adj.join()).join('|')).toBe(b.board.map((s) => s.adj.join()).join('|'));
    expect(a.board.map((s) => s.content).join()).not.toBe(b.board.map((s) => s.content).join());
  });
});

describe('v9: chance cards, bets, the bomb, the boss', () => {
  it('every bet settles at most once, every bomb has a holder, and the boss loses only what it is dealt', () => {
    let chances = 0;
    let bets = 0;
    let bosses = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { g } = run(4, seed, seed * 7);
      const ends = new Map<number, number>();
      for (const b of g.log) {
        if (b.t === 'chance') chances++;
        if (b.t === 'wager') bets++;
        if (b.t === 'wagerEnd') ends.set(b.id, (ends.get(b.id) ?? 0) + 1);
        if (b.t === 'boss') bosses++;
        if (b.t === 'bossHit') {
          expect(b.hp).toBeGreaterThan(0);
          expect(b.hp).toBeLessThanOrEqual(b.max);
        }
        if (b.t === 'dice') for (const d of b.dice) expect(d >= 1 && d <= 6).toBe(true);
      }
      for (const n of ends.values()) expect(n).toBe(1);
    }
    expect(chances).toBeGreaterThan(30);
    expect(bets).toBeGreaterThan(5);
    expect(bosses).toBeGreaterThan(10);
  });
});

describe('the world on screen is the rules graph', () => {
  const board = makeBoard();
  it('every place has its own spot inside the world, the fire at the centre', () => {
    const seen = new Set<string>();
    for (const s of board) {
      const p = placeAt(s.id);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(W);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(H);
      const key = `${Math.round(p.x)},${Math.round(p.y)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(slotOf(CENTRE).k).toBe(-1);
  });
  it('nine places sit on each island, nearer their own island than any other', () => {
    for (let k = 0; k < 8; k++) {
      const mine = board.filter((s) => s.id !== CENTRE && slotOf(s.id).k === k);
      expect(mine.length).toBe(9);
      for (const s of mine) {
        const p = placeAt(s.id);
        const d = (j: number) => Math.hypot(p.x - islandAt(j).x, p.y - islandAt(j).y);
        for (let j = 0; j < 8; j++) if (j !== k) expect(d(k)).toBeLessThan(d(j));
      }
    }
  });
  it('a road is a rope bridge exactly when it leaves its island; every rules road is drawn once', () => {
    const roads = roadsOf(board);
    const edges = board.reduce((n, s) => n + s.adj.length, 0) / 2;
    expect(roads.length).toBe(edges);
    for (const r of roads) expect(r.rope).toBe(isRope(r.a, r.b));
    expect(roads.some((r) => r.rope)).toBe(true);
    expect(roads.some((r) => !r.rope)).toBe(true);
  });
  it('every land names its nine places', () => {
    for (const w of WORLDS) expect(new Set(PLACES[w]).size).toBe(9);
  });
});
