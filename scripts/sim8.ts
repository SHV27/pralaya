/**
 * PRALAYA's sim gate (GDD-v8 §10): plays whole matches with sharp hands and one careless hand and prints the numbers the gate
 * checks. `node scripts/sim8.ts [n=400] [seats=6]`. `T_<key>=json` overrides a TUNE key (e.g. T_grudge=0.5).
 */
import { resolve, type Fired } from '../src/game/v8/clash.ts';
import { CENTRE, distance } from '../src/game/v8/map.ts';
import {
  createGame,
  creature,
  fighter,
  lawAt,
  play,
  progress,
  reach,
  wildFighter,
  type Answer,
  type Ask,
  type Fire,
  type Game,
} from '../src/game/v8/rules.ts';
import { TUNE } from '../src/game/v8/tune.ts';
import { STATS } from '../src/game/v8/stats.ts';
import { carelessHand } from '../src/game/v8/hands.ts';

for (const [k, v] of Object.entries(process.env))
  if (k.startsWith('T_') && v) (TUNE as Record<string, unknown>)[k.slice(2)] = JSON.parse(v);

const n = Number(process.argv[2] ?? 400);
const seats = Number(process.argv[3] ?? 6);
let seed = 1;
const R = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const pick = <T>(xs: readonly T[]) => xs[Math.floor(R() * xs.length)]!;
const perms = <T>(xs: T[]): T[][] =>
  xs.length <= 1
    ? [xs]
    : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
function choose3<T>(xs: T[]): T[][] {
  if (xs.length <= 3) return [xs];
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++)
      for (let k = j + 1; k < xs.length; k++) out.push([xs[i]!, xs[j]!, xs[k]!]);
  return out;
}
const value = (o: string) =>
  ({
    rare: 3,
    rubLamp: 1,
    wakeGiant: 3,
    littleCup: 2,
    oath: 0,
    burnMap: 0,
    keepMap: 1,
    polishLamp: 1,
    walkOn: 0,
    tiptoe: 0,
  })[o] ?? 0;

/** Sharp: reads the board (omens, relics), the faces and the tells; tries every special with full information. */
function sharp(g: Game, a: Ask): Answer {
  const p = g.players[a.seat]!;
  switch (a.k) {
    case 'fate': {
      if (a.golden && progress(g) > 0.35) return { k: 'playGolden' };
      const score = (i: number) => {
        const f = a.cards[i]!;
        const ends = reach(g, p, f);
        let s = 0;
        if (g.omen.includes(p.at) && (f.fx.k === 'tea' || ends.every((e) => e === p.at)))
          s -= f.fx.k === 'tea' ? -2 : 5;
        if (ends.some((e) => g.relics.includes(e))) s += 3;
        if (ends.some((e) => g.omen.includes(e))) s -= 2;
        if (p.relics >= 3 && ends.includes(CENTRE)) s += 10;
        if (f.fx.k === 'unleash' || f.fx.k === 'swap') s += 1;
        return s + R() * 0.5;
      };
      let best = 0;
      for (let i = 1; i < a.cards.length; i++) if (score(i) > score(best)) best = i;
      return { k: 'fate', index: best };
    }
    case 'steps':
      return { k: 'steps', n: a.options.at(-1)! };
    case 'fork': {
      const safe = a.options.filter((o) => !g.omen.includes(o) && !g.board[o]!.void);
      const pool = safe.length ? safe : a.options;
      const good = pool.find((o) => g.relics.includes(o) || (p.relics >= 3 && o === CENTRE));
      return { k: 'fork', to: good ?? pick(pool) };
    }
    case 'target': {
      const lead = a.options.reduce((x, y) => (g.players[y]!.hearts > g.players[x]!.hearts ? y : x));
      return { k: 'target', seat: lead };
    }
    case 'world':
      return { k: 'world', world: pick(a.options) };
    case 'space': {
      if (a.why === 'trap' && g.stand) {
        // A spirit lays its trap where the survivor is likely to step: near them.
        const near = a.options.filter((o) => distance(g.board, o, g.players[g.stand!.seat]!.at) <= 4);
        return { k: 'space', at: pick(near.length ? near : a.options) };
      }

      return { k: 'space', at: pick(a.options) };
    }
    case 'hilo':
      return { k: 'yes', yes: a.val < 52 };
    case 'golden':
      return { k: 'golden', effect: a.effects.includes('fuse') && p.deck.length >= 4 ? 'fuse' : 'stampede' };
    case 'team': {
      // Sharp: for each lane, call the stat where this card beats the faces it may meet by the most (Top Trumps sense).
      // v10: both calls count; the wild calls its card's best stat (mostly).
      const bestOf = (st: Record<string, number>) => STATS.reduce((x, y) => (st[y]! > st[x]! ? y : x));
      const callFor = (f: ReturnType<typeof fighter>, faces: (string | null)[]) =>
        STATS.reduce((best, st) => {
          const fs = faces.filter((x): x is string => !!x).map((x) => wildFighter(x).stats);
          let sc = 0;
          for (const fo of fs) sc += f.stats[st] + f.stats[bestOf(fo)] - fo[st] - fo[bestOf(fo)];
          if (!fs.length) sc = f.stats[st];
          return sc > best.sc ? { st, sc } : best;
        }, { st: 'POWER' as (typeof STATS)[number], sc: -1e9 }).st;
      const size = a.size;
      if (!a.faces || a.dark) {
        const best = [...a.drawn].sort((x, y) => fighter(y).power - fighter(x).power).slice(0, size);
        const calls = [0, 1, 2].map((i) => (a.calls.includes(i) && best[i] ? callFor(fighter(best[i]!), []) : null));
        return { k: 'team', order: best.map((o) => o.uid), bet: false, fire: null, calls };
      }
      const faces = a.faces;
      const law = lawAt(g, p.at);
      let best = { score: -9, order: [] as number[], calls: [] as ((typeof STATS)[number] | null)[] };
      const subsets = (xs: typeof a.drawn, k: number): (typeof a.drawn)[] =>
        k === 0 ? [[]] : xs.flatMap((x, i) => subsets(xs.slice(i + 1), k - 1).map((r) => [x, ...r]));
      const foeIdx = faces.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
      for (const three of subsets(a.drawn, size))
        for (const ord of perms(three)) {
          const calls = ord.map((o, i) => (a.calls.includes(i) ? callFor(fighter(o), faces) : null));
          let s = 0;
          let k = 0;
          for (const fo of perms(foeIdx)) {
            const theirs = fo.map((i) => (faces[i] ? wildFighter(faces[i]!) : null));
            const foeCalls = theirs.map((t) => (t ? bestOf(t.stats) : null));
            const r = resolve(ord.map(fighter), theirs, [], { law, ties: law === 'homeSoil' ? 'foe' : null, calls, foeCalls });
            s += r.won - r.lost;
            k++;
          }
          if (k && s / k > best.score) best = { score: s / k, order: ord.map((o) => o.uid), calls };
        }
      return { k: 'team', order: best.order, bet: a.canBet && best.score >= 1.5, fire: null, calls: best.calls };
    }
    case 'move': {
      const law = lawAt(g, p.at);
      const opts = { law, ties: law === 'homeSoil' ? ('foe' as const) : null, calls: a.calls };
      const score = (extra: Fired[]) => {
        const r = resolve(a.mine, a.theirs, [...a.fired, ...extra], opts);
        return r.won - r.lost;
      };
      let best: Fire | null = null;
      let bestS = score([]);
      for (let lane = 0; lane < 3; lane++)
        for (let target = 0; target < 3; target++) {
          const f = a.mine[lane];
          if (!f) continue;
          for (const move of f.moves) {
            const s = score([{ side: 'me', lane, move, target }]);
            if (s > bestS) {
              bestS = s;
              best = { lane, target, move };
            }
          }
        }
      const free = a.free.filter((l) => l !== best?.lane).map((lane) => ({ lane, target: lane }));
      return { k: 'move', fire: best, free, bench: null };
    }
    case 'encounter':
      // Pure luck: nobody can read the potions.
      return { k: 'encounter', pick: Math.floor(R() * 3) };
    case 'strike':
      // A sharp player times well: perfect 55% · good 35% · miss 10% (action-command hit rates, research/v8/feel-v8).
      return { k: 'strike', hits: [0, 1, 2].map(() => { const r = R(); return r < 0.55 ? 2 : r < 0.9 ? 1 : 0; }) };
    case 'riddle':
      return { k: 'riddle', pick: value(a.riddle.fa) >= value(a.riddle.fb) ? 'a' : 'b' };
    case 'release':
    case 'fuse': {
      const s = [...a.deck].sort((x, y) => fighter(x).power - fighter(y).power);
      return a.k === 'release'
        ? { k: 'release', uid: (a.why === 'equip' ? s.at(-1) : s[0])!.uid }
        : { k: 'fuse', a: s.at(-1)!.uid, b: s.at(-2)!.uid };
    }
    case 'boon':
      return { k: 'boon', key: a.options[0]! };
    case 'wish':
      return { k: 'wish', pick: p.hearts < 3 ? 'heart' : 'creature' };
    case 'doom':
      return { k: 'doom', index: 0 };
    case 'stop':
    case 'pull':
      return { k: 'yes', yes: R() < 0.5 };
    case 'roll':
      return { k: 'roll', use: a.golden && progress(g) > 0.35 ? 'golden' : a.ready === 0 ? 'power' : 'roll' };
    case 'predict': {
      const q = g.players[a.on]!;
      const avgDeck = g.players.filter((x) => !x.out).reduce((s, x) => s + x.deck.length, 0) / Math.max(1, g.players.filter((x) => !x.out).length);
      return { k: 'yes', yes: q.deck.length >= avgDeck };
    }
    case 'choice':
      // A sharp hand: pay to pass a tooth only when 2 are left; bid while the auction is cheap; climb the stairs to step 2.
      if (/Teeth/.test(a.title)) return { k: 'pick', i: /: 2 left/.test(a.title) && p.deck.length > 2 ? 1 : 0 };
      if (/Black Market/.test(a.title)) return { k: 'pick', i: p.deck.length >= 4 && !/[3-9] bid/.test(a.title) ? 0 : 1 };
      if (/Stairs/.test(a.title)) return { k: 'pick', i: /step 1/.test(a.title) ? 0 : 1 };
      if (/Gauntlet/.test(a.title)) return { k: 'pick', i: p.hearts >= 2 && p.deck.length >= 3 ? 0 : 1 };
      if (/Oracle/.test(a.title)) return { k: 'pick', i: Math.floor(R() * 6) };
      return { k: 'pick', i: a.def };
    case 'pick':
      if (a.why === 'altar') return { k: 'pick', i: p.hearts === 1 && p.deck.length >= 3 ? 0 : p.hearts >= 3 && a.options.length > 1 ? 0 : a.options.length - 1 };
      if (a.why === 'trader') return { k: 'pick', i: R() < 0.6 ? 0 : 1 };
      if (a.why === 'ransom') return { k: 'pick', i: p.hearts >= 2 ? 0 : 1 };
      if (a.why === 'devil') return { k: 'pick', i: p.hearts <= 1 ? 0 : R() < 0.5 ? 0 : 1 };
      return { k: 'pick', i: p.hearts >= 3 ? 0 : 1 };
    case 'trial':
      // Timed trials: a sharp hand lands perfect 55% · good 35% · miss 10% (action-command hit rates, research/v8/feel-v8).
      return { k: 'trial', hits: Array.from({ length: a.n }, () => { const r = R(); return r < 0.55 ? 2 : r < 0.9 ? 1 : 0; }) };
  }
}
/** Careless: random at every decision (the same hand the property tests use). */
const careless = (g: Game, a: Ask): Answer => {
  const ans = carelessHand(a, R);
  // NAIVE=1: a first-timer, not a fuzzer: random everywhere, but calls the biggest number they can see on each card.
  if (process.env.NAIVE && a.k === 'team' && ans.k === 'team')
    ans.calls = ans.order.slice(0, 3).map((u) => {
      const o = a.drawn.find((x) => x.uid === u)!;
      const st = fighter(o).stats;
      return STATS.reduce((x, y) => (st[y] > st[x] ? y : x));
    });
  return ans;
};

// ── Run ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const stats = {
  mins: [] as number[],
  firstOut: [] as number[],
  afterFirst: [] as number[],
  foolWins: 0,
  escape: 0,
  close: 0,
  hearts: {} as Record<string, number>,
  clashes: 0,
  lane3: 0,
  upset: 0,
  wildClashes: 0,
  landings: 0,
  landClash: 0,
  legend: 0,
  eats: 0,
  spared: 0,
  flips: 0,
  rounds: [] as number[],
  stuck: 0,
  unwarnedHits: 0,
  heroWins: {} as Record<string, [number, number]>,
  gapMax: [] as number[],
  secs: {} as Record<string, number>,
  chance: {} as Record<string, number>,
  wagers: { win: 0, lose: 0, void: 0 },
  booms: 0,
  bosses: 0,
  bossDown: 0,
  powers: 0,
  trials: 0,
  stampedes: 0,
  world: 0,
  walk: 0,
  attacks: 0,
  attackOk: 0,
  lanes: 0,
  hair: 0,
  places: 0,
};
for (let m = 0; m < n; m++) {
  const names = Array.from({ length: seats }, (_, i) => `P${i}`);
  const g = createGame(names, 1000 + m);
  const fool = m % seats;
  const it = play(g);
  let r = it.next();
  let guard = 0;
  while (!r.done && guard++ < 20000) {
    const a = r.value;
    r = it.next(a.seat === fool ? careless(g, a) : sharp(g, a));
  }
  if (!r.done) console.log('STUCK GAME', m);
  stats.mins.push(g.clock / 60);
  stats.rounds.push(g.round + 1);
  const outs: number[] = [];
  const lastTurn: Record<number, number> = {};
  let gap = 0;
  let warned = true;
  g.log.forEach((b, i) => {
    const c = g.clocks[i]!;
    stats.secs[b.t] = (stats.secs[b.t] ?? 0) + ((g.clocks[i + 1] ?? g.clock) - c);
    if (b.t === 'turn') {
      if (lastTurn[b.seat] !== undefined) gap = Math.max(gap, c - lastTurn[b.seat]!);
      lastTurn[b.seat] = c;
    }
    if (b.t === 'out') outs.push(c);
    if (b.t === 'eat') warned = b.warned;
    if (b.t === 'heart') {
      stats.hearts[b.why] = (stats.hearts[b.why] ?? 0) + 1;
      if (b.why === 'world' && !warned) stats.unwarnedHits++;
    }
    if (b.t === 'land') {
      stats.landings++;
      if (b.content === 'lair' || b.content === 'friend') stats.landClash++;
    }
    if (b.t === 'clash') {
      stats.clashes++;
      const l = b.lanes.filter((x) => !x.idle);
      if (l.length === 3) {
        const two = l.slice(0, 2);
        const decided = two.every((x) => x.res === 'me') || two.every((x) => x.res === 'foe');
        if (!decided) stats.lane3++;
      }
      if (b.vs === null) {
        stats.wildClashes++;
        const mine = b.lanes.reduce((s, x) => s + (x.me ? creature(x.me).power : 0), 0);
        const theirs = b.lanes.reduce((s, x) => s + (x.foe ? creature(x.foe).power : 0), 0);
        if (b.outcome === 'win' && mine < theirs) stats.upset++;
      }
    }
    if (b.t === 'emerge' && b.team.some((c) => creature(c).rarity === 'legendary')) stats.legend++;
    if (b.t === 'eat') stats.eats++;
    if (b.t === 'spared' && b.why === 'near') stats.spared++;
    if (b.t === 'flip') stats.flips++;
    if (b.t === 'stuck') stats.stuck++;
    if (b.t === 'chance') stats.chance[b.card] = (stats.chance[b.card] ?? 0) + 1;
    if (b.t === 'wagerEnd') stats.wagers[b.result]++;
    if (b.t === 'boom') stats.booms++;
    if (b.t === 'boss') stats.bosses++;
    if (b.t === 'bossDown') stats.bossDown++;
    if (b.t === 'power') stats.powers++;
    if (b.t === 'trial') stats.trials++;
    if (b.t === 'stampede') stats.stampedes++;
  });
  stats.gapMax.push(gap);
  if (outs.length) {
    stats.firstOut.push(outs[0]! / 60);
    stats.afterFirst.push((g.clock - outs[0]!) / 60);
  }
  if (g.winner === fool || (g.spiritsWin && g.stand?.seat !== fool)) stats.foolWins++;
  if (g.log.some((b) => b.t === 'stand')) stats.escape++;
  if (g.spiritsWin) stats.world++;
  if (g.winner !== null && g.log.some((b) => b.t === 'stand')) stats.walk++;
  if (g.winner !== null && g.players[g.winner]!.hearts === 1) stats.close++;
  stats.attacks += g.log.filter((b) => b.t === 'attack').length;
  stats.attackOk += g.log.filter((b) => b.t === 'attack' && b.ok).length;
  for (const b of g.log) if (b.t === 'clash') for (const l of b.lanes) if (l.me && l.foe) { stats.lanes++; if (Math.abs(l.mine - l.theirs) <= 6) stats.hair++; }
  stats.places += g.log.filter((b) => b.t === 'land' && ['hilo', 'tame', 'altar', 'trader', 'gate'].includes(b.content)).length;
  for (const p of g.players) {
    const h = (stats.heroWins[p.hero.id] ??= [0, 0]);
    h[1]++;
    if (p.seat === g.winner) h[0]++;
  }
}
const avg = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);
const pct = (x: number, of = n) => `${((100 * x) / Math.max(1, of)).toFixed(0)}%`;
const q = (x: number[], f: number) => [...x].sort((a, b) => a - b)[Math.floor(x.length * f)] ?? 0;
console.log(`PRALAYA sim · ${n} matches · ${seats} seats`);
console.log(
  `length: avg ${avg(stats.mins).toFixed(1)} min (p10 ${q(stats.mins, 0.1).toFixed(1)}, p90 ${q(stats.mins, 0.9).toFixed(1)}) · rounds ${avg(stats.rounds).toFixed(1)} · max wait between own turns p90 ${q(stats.gapMax, 0.9).toFixed(0)} s`,
);
console.log(
  `first knock-out: avg ${avg(stats.firstOut).toFixed(1)} min · before 6 min ${pct(stats.firstOut.filter((x) => x < 6).length, stats.firstOut.length)} · match ends ${avg(stats.afterFirst).toFixed(1)} min after it (p90 ${q(stats.afterFirst, 0.9).toFixed(1)})`,
);
console.log(
  `careless hand wins ${pct(stats.foolWins)} (fair ${(100 / seats).toFixed(0)}%) · last stands ${pct(stats.escape)} (walked out ${pct(stats.walk, stats.escape)}, world kept ${pct(stats.world, stats.escape)}) · close finishes ${pct(stats.close)}`,
);
const hl = Object.values(stats.hearts).reduce((a, b) => a + b, 0);
console.log(
  `hearts lost by: ${Object.entries(stats.hearts)
    .map(([k, v]) => `${k} ${pct(v, hl)}`)
    .join(' · ')} (${(hl / n).toFixed(1)}/match) · unwarned eat hits ${stats.unwarnedHits}`,
);
console.log(
  `clashes/match ${(stats.clashes / n).toFixed(1)} · landings that clash ${pct(stats.landClash, stats.landings)} · third lane matters ${pct(stats.lane3, stats.clashes)} · wild wins by the smaller team ${pct(stats.upset, stats.wildClashes)} · legends/match ${(stats.legend / n).toFixed(2)}`,
);
console.log(
  `eats/match ${(stats.eats / n).toFixed(1)} · spared/match ${(stats.spared / n).toFixed(1)} · flips/match ${(stats.flips / n).toFixed(1)} · stuck ${stats.stuck}`,
);
console.log(
  `hero win rates: ${Object.entries(stats.heroWins)
    .map(([k, [w, t]]) => `${k.replace('hero-', '')} ${((100 * w) / t).toFixed(0)}%`)
    .join(' · ')}`,
);
console.log(
  `seconds/match by beat: ${Object.entries(stats.secs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([k, v]) => `${k} ${(v / n).toFixed(0)}`)
    .join(' · ')}`,
);

console.log(
  `v10 per match: land strikes ${(stats.attacks / n).toFixed(1)} (stopped ${pct(stats.attackOk, stats.attacks)}) · lanes by a hair (≤6) ${pct(stats.hair, stats.lanes)} · new places ${(stats.places / n).toFixed(1)}`,
);
console.log(
  `v9 per match: chance cards ${(Object.values(stats.chance).reduce((a, b) => a + b, 0) / n).toFixed(1)} · battles ${(stats.clashes / n).toFixed(1)} · bets won/lost/void ${stats.wagers.win}/${stats.wagers.lose}/${stats.wagers.void} · bombs ${(stats.booms / n).toFixed(2)} · boss woke ${pct(stats.bosses)} slain ${pct(stats.bossDown)} · powers ${(stats.powers / n).toFixed(1)} · trials ${(stats.trials / n).toFixed(1)} · stampedes ${(stats.stampedes / n).toFixed(1)}`,
);
