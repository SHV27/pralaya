/**
 * A careless hand: a legal, random answer to any question the rules ask (the sim's "fool", the property tests' fuzzer, and the
 * review hand's brain). Never on the default path for a real player.
 */
import type { Answer, Ask } from './rules.ts';
import { STATS } from './stats.ts';

/** Careless: random at every decision. */
export function carelessHand(a: Ask, R: () => number): Answer {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(R() * xs.length)]!;
  switch (a.k) {
    case 'fate':
      return a.golden && R() < 0.3
        ? { k: 'playGolden' }
        : { k: 'fate', index: Math.floor(R() * a.cards.length) };
    case 'steps':
      return { k: 'steps', n: pick(a.options) };
    case 'fork':
      return { k: 'fork', to: pick(a.options) };
    case 'target':
      return { k: 'target', seat: pick(a.options) };
    case 'world':
      return { k: 'world', world: pick(a.options) };
    case 'space':
      return { k: 'space', at: pick(a.options) };
    case 'golden':
      return { k: 'golden', effect: pick(a.effects) };
    case 'team': {
      const order = [...a.drawn].sort(() => R() - 0.5).map((o) => o.uid);
      const fire = R() < 0.5 ? { lane: Math.floor(R() * 3), target: Math.floor(R() * 3) } : null;
      const calls = [0, 1, 2].map(() => pick(STATS));
      return { k: 'team', order, bet: a.canBet && R() < 0.3, fire, calls };
    }
    case 'move':
      return {
        k: 'move',
        fire: R() < 0.5 ? { lane: Math.floor(R() * 3), target: Math.floor(R() * 3) } : null,
        free: [],
        bench: null,
      };
    case 'encounter':
      return { k: 'encounter', pick: Math.floor(R() * 3) };
    case 'strike':
      return { k: 'strike', hits: [0, 1, 2].map(() => Math.floor(R() * 3)) };
    case 'riddle':
      return { k: 'riddle', pick: pick(['a', 'b'] as const) };
    case 'release':
      return { k: 'release', uid: pick(a.deck).uid };
    case 'fuse':
      return { k: 'fuse', a: a.deck[0]!.uid, b: a.deck[1]!.uid };
    case 'boon':
      return { k: 'boon', key: pick(a.options) };
    case 'wish':
      return { k: 'wish', pick: pick(['heart', 'creature', 'rest'] as const) };
    case 'doom':
      return { k: 'doom', index: Math.floor(R() * a.options.length) };
    case 'stop':
    case 'pull':
      return { k: 'yes', yes: R() < 0.5 };
    case 'roll':
      return { k: 'roll', use: a.golden && R() < 0.3 ? 'golden' : a.ready === 0 && R() < 0.6 ? 'power' : 'roll' };
    case 'predict':
      return { k: 'yes', yes: R() < 0.5 };
    case 'pick':
      return { k: 'pick', i: Math.floor(R() * a.options.length) };
    case 'trial':
      return { k: 'trial', hits: Array.from({ length: a.n }, () => Math.floor(R() * 3)) };
    case 'choice':
      return { k: 'pick', i: Math.floor(R() * a.options.length) };
    case 'hilo':
    case 'deeper':
      return { k: 'yes', yes: R() < 0.5 };
  }
}

