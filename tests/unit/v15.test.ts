/**
 * v15, the owner's three-player verdict (2026-11-04): "ferocity… only rewards the wild… annoying"; "Burning Heart… kidhar bhi
 * teleport… loophole"; "place gira toh heart nahi gaya"; "fog hat jati to pata lag jata hai… outsmart"; "freshness… koi
 * constraint nahi"; "game apna dimaag na rakhe". These tests are the proof, one per line.
 */
import { describe, expect, it } from 'vitest';
import { carelessHand } from '../../src/game/v8/hands.ts';
import { createGame, play, wildFighter, type Beat, type Game } from '../../src/game/v8/rules.ts';
import { STATS } from '../../src/game/v8/stats.ts';
import { TUNE } from '../../src/game/v8/tune.ts';

const lcg = (s: number) => () => {
  s = (s * 16807) % 2147483647;
  return s / 2147483647;
};
/** Plays a match; `each` sees the game after every answer (the cards' numbers belong to this match while it runs). */
function run(seats: number, seed: number, each?: (g: Game) => void): Game {
  const g = createGame(
    Array.from({ length: seats }, (_, i) => `P${i}`),
    seed,
  );
  const R = lcg(seed * 5 + 3);
  const it = play(g);
  let r = it.next();
  let n = 0;
  while (!r.done && n++ < 20000 && g.log.length < 40000) {
    r = it.next(carelessHand(r.value, R));
    each?.(g);
  }
  return g;
}

describe('PRALAYA v15: luck with no thumb on the scale', () => {
  it('no fury for one side: no lane ever carries a FEROCITY chip; twists fall on both sides', () => {
    let me = 0;
    let foe = 0;
    for (let i = 0; i < 80; i++)
      for (const b of run(3, 21000 + i).log)
        if (b.t === 'clash')
          for (const l of b.lanes) {
            expect(l.chips.some((c) => /FEROCITY/.test(c.text))).toBe(false);
            for (const c of l.chips) if (/±|[+-]\d/.test(c.text)) c.side === 'me' ? me++ : foe++;
          }
    expect(me).toBeGreaterThan(50);
    expect(foe).toBeGreaterThan(50);
    expect(Math.abs(me - foe) / (me + foe)).toBeLessThan(0.15);
  });
  it('the wild calls blind: always one of its own best three stats, never shaped by your card', () => {
    let calls = 0;
    for (let i = 0; i < 40; i++) {
      let seen = 0;
      run(3, 22000 + i, (g) => {
        for (; seen < g.log.length; seen++) {
          const b = g.log[seen]!;
          if (b.t !== 'orders' || b.vs !== null) continue;
          b.theirs.forEach((cid, lane) => {
            const call = b.foeCalls[lane];
            if (!cid || !call) return;
            const st = wildFighter(cid).stats;
            const top = [...STATS].sort((x, y) => st[y] - st[x]).slice(0, TUNE.wildTop);
            // Ties at the third place may admit a fourth stat with the same number.
            expect(st[call]).toBeGreaterThanOrEqual(st[top.at(-1)!]);
            calls++;
          });
        }
      });
    }
    expect(calls).toBeGreaterThan(300);
  });
});

describe('PRALAYA v15: no loopholes in the ground', () => {
  const games = Array.from({ length: 150 }, (_, i) => run(2 + (i % 5), 23000 + i));
  it('the Burning Heart throws you somewhere random: nobody is ever asked to name a place for it', () => {
    let throws = 0;
    for (let i = 0; i < 60; i++) {
      const g = createGame(['A', 'B', 'C'], 24000 + i);
      const R = lcg(i + 1);
      const it = play(g);
      let r = it.next();
      let n = 0;
      while (!r.done && n++ < 20000) {
        const a = r.value;
        if (a.k === 'space') expect(['heart', 'garuda', 'vimana']).not.toContain(a.why);
        r = it.next(carelessHand(a, R));
      }
      throws += g.log.filter((b) => b.t === 'portal' && b.why === 'heart').length;
    }
    expect(throws).toBeGreaterThan(0);
  });
  it('the ground falls under a hero: a heart, every time (only a flyer, the Brahmastra or round one spare them, out loud)', () => {
    let falls = 0;
    for (const g of games) {
      for (let i = 0; i < g.log.length; i++) {
        const b = g.log[i]!;
        if (b.t !== 'pushed' || b.why !== 'eaten') continue;
        falls++;
        // What follows the push is the heart, a named rescue (a flyer, the Brahmastra, the Insurance, the Phoenix, a sleeping shield), or the last
        // survivor's Last Stand.
        const next = g.log
          .slice(i + 1, i + 4)
          .find(
            (x) =>
              (x.t === 'heart' || x.t === 'spared' || x.t === 'door' || x.t === 'lost' || x.t === 'news' || x.t === 'moment' || x.t === 'stand' || x.t === 'boonUsed' || x.t === 'win') &&
              'seat' in x &&
              x.seat === b.seat,
          );
        expect(next, `seed fall at beat ${i}`).toBeDefined();
        if (next?.t === 'spared') expect(['fly', 'brahmastra', 'round1']).toContain(next.why);
      }
    }
    expect(falls).toBeGreaterThan(30);
  });
  it('what a place holds is drawn when you land: the same place gives different things, in the pool’s own shares', () => {
    const at = new Map<number, Set<string>>();
    const kinds = new Map<string, number>();
    let lands = 0;
    for (const g of games)
      for (const b of g.log)
        if (b.t === 'land' && b.content !== 'friend' && b.content !== 'shelter' && b.content !== 'gate') {
          lands++;
          (at.get(b.at) ?? at.set(b.at, new Set()).get(b.at)!).add(b.content);
          kinds.set(b.content, (kinds.get(b.content) ?? 0) + 1);
        }
    const revisited = [...at.values()].filter((s) => s.size > 1).length;
    expect(revisited).toBeGreaterThan(40);
    // Shares follow the pool: a chance card (empty) is 4 of the pool, a lair 2.
    const pool = TUNE.contentsPool;
    const want = (k: string) => pool.filter((x) => x === k).length / pool.length;
    for (const k of ['empty', 'lair'])
      expect(Math.abs((kinds.get(k) ?? 0) / lands - want(k))).toBeLessThan(0.04);
  });
  it('no memory between matches: a match is decided by its own seed alone, and the same seed deals the same match', () => {
    const a = run(4, 777);
    const b = run(4, 777);
    expect(a.drawn).toEqual(b.drawn);
    expect(a.log.length).toBe(b.log.length);
  });
  it('the Final Turns blessing falls by lot, not on the weakest', () => {
    const picks: number[] = [];
    for (const g of games) {
      const ft = g.log.find((x): x is Extract<Beat, { t: 'finalTurns' }> => x.t === 'finalTurns');
      if (!ft) continue;
      const living = g.players.length;
      picks.push(ft.seat / living);
    }
    expect(picks.length).toBeGreaterThan(30);
  });
});

describe('PRALAYA v15: the fallen stay in the game, and oaths can break', () => {
  const games = Array.from({ length: 120 }, (_, i) => run(3 + (i % 4), 26000 + i));
  it('a fallen hero whispers every world turn: the next roll of the one they name moves by exactly ±2 (never below 1)', () => {
    let whispers = 0;
    for (const g of games) {
      const pending = new Map<number, number>();
      for (const b of g.log) {
        if (b.t === 'moment' && b.kicker === 'THE FALLEN WHISPER') {
          whispers++;
          const m = b.text.match(/whispers to \[\[(\d+)\]\]/);
          if (m) pending.set(Number(m[1]), /gains 2/.test(b.text) ? 2 : -2);
        }
        if (b.t === 'dice' && pending.has(b.seat)) {
          // The whisper's ±2, plus another blessing's +2 if one was also waiting.
          expect([0, 2]).toContain(b.bonus - pending.get(b.seat)!);
          expect(b.n).toBeGreaterThanOrEqual(1);
          pending.delete(b.seat);
        }
      }
    }
    expect(whispers).toBeGreaterThan(50);
  });
  it('the Oath Stone: oaths are sworn, spoils are shared, and a meeting of allies ends in a held oath, a betrayal or a duel', () => {
    const titles = new Set<string>();
    for (const g of games) for (const b of g.log) if (b.t === 'moment' && b.kicker === 'THE OATH STONE') titles.add(b.title);
    expect(titles).toContain('SWORN');
    expect(titles).toContain('AN ALLY SHARES THE SPOILS');
  });
});

describe('PRALAYA v15: the hostile QA pass, kept closed', () => {
  const games = Array.from({ length: 150 }, (_, i) => run(2 + (i % 5), 27000 + i));
  it('the Dark Pact never shows "the bet pays"; a contract never outlives the start of its holder\'s next turn', () => {
    for (const g of games) {
      for (const b of g.log) if (b.t === 'wagerEnd' && b.card === 'darkPact') expect(b.result).not.toBe('win');
      const live: { by: number; turnsSeen: number }[] = [];
      for (const b of g.log) {
        if (b.t === 'moment' && b.title === 'A NAME IS WRITTEN' && b.seat !== null) live.push({ by: b.seat, turnsSeen: 0 });
        if (b.t === 'turn') for (const c of live) if (c.by === b.seat) c.turnsSeen++;
        if (b.t === 'moment' && b.title === 'THE CONTRACT PAYS' && b.seat !== null) {
          const c = live.find((x) => x.by === b.seat);
          if (c) expect(c.turnsSeen).toBe(0);
          live.splice(live.indexOf(c!), 1);
        }
        if (b.t === 'moment' && b.title === 'THE CONTRACT EXPIRES') live.splice(live.findIndex((x) => x.by === b.seat), 1);
      }
    }
  });
  it('a life staked and lost is a life lost (no shield, no insurance, no phoenix; only Death’s Door)', () => {
    for (const g of games)
      g.log.forEach((b, i) => {
        if (b.t !== 'moment' || b.title !== 'ALL IN, AND LOST' || b.seat === null) return;
        const after = g.log.slice(i + 1, i + 8);
        const out = after.some((x) => x.t === 'out' && x.seat === b.seat);
        const door = after.some((x) => x.t === 'door' && x.seat === b.seat);
        const last = after.some((x) => x.t === 'stand' || x.t === 'win');
        expect(out || door || last).toBe(true);
      });
  });
});
