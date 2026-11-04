/**
 * The clash stage (GDD-v8 §5 + Chief v8 + premortem fixes 2–4): the wild team bursts out (faces, the world's law, one honest
 * tell), you build your order lane by lane (click/tap or number keys), their order flips, specials fire with an arrow and a
 * caption, then each lane resolves on its own: a chip-by-chip count-up (type ×2, the law, the move) and one decisive cause.
 * Setup → event → consequence, one lane at a time.
 */
import { resolve, type Fighter, type Fired } from '../game/v8/clash.ts';
import type { Answer, Ask, Fire, LaneView, Owned } from '../game/v8/rules.ts';
import { creature, fighter } from '../game/v8/rules.ts';
import { STATS, type Stat } from '../game/v8/stats.ts';
import type { Law, Move } from '../game/v8/types.ts';
import { EASE, clock, countUp, el, esc, pop, readGate, reader, tween, wait } from '../play/anim.ts';
import type { Audio, Grunt } from '../play/audio.ts';
import { auto, cardEl } from './ui.ts';
import { LAW_GLYPH, MOVE } from './text.ts';
import { Arena } from './world/arena.ts';
import type { WorldId } from '../game/v8/types.ts';

/** The voice of each land's creatures. */
const GRUNT: Record<WorldId, Grunt> = {
  india: 'roar',
  olympus: 'dragon',
  cosmos: 'suck',
  pirate: 'wave',
  night: 'bones',
  lost: 'stomp',
  toon: 'coo',
  wild: 'hiss',
};

type TeamAsk = Extract<Ask, { k: 'team' }>;
type MoveAsk = Extract<Ask, { k: 'move' }>;

export class Stage {
  private root: HTMLElement;
  private foeRow: HTMLElement;
  private meRow: HTMLElement;
  private mid: HTMLElement;
  private dock: HTMLElement;
  private lawEl: HTMLElement;
  private title: HTMLElement;
  private foeIds: (string | null)[] = [];
  private meIds: (string | null)[] = [];
  private dark = false;
  /** The fight's own title (a secret order borrows the title line, then gives it back). */
  private heading = '';
  private arenaView: Arena | null = null;
  /** The painted fight (made on first use: the renderer starts after the stage). */
  get arena(): Arena {
    this.arenaView ??= new Arena();
    return this.arenaView;
  }

  private audio: Audio;
  constructor(parent: HTMLElement, audio: Audio) {
    this.audio = audio;
    this.root = el('section', 'stage');
    this.title = el('h2', 'st-title');
    this.lawEl = el('div', 'st-law');
    this.foeRow = el('div', 'lanes foe');
    this.mid = el('div', 'lanes mid');
    this.meRow = el('div', 'lanes me');
    this.dock = el('div', 'dock');
    this.root.append(this.title, this.lawEl, this.foeRow, this.mid, this.meRow, this.dock);
    parent.append(this.root);
  }

  private slots(row: HTMLElement): HTMLElement[] {
    row.replaceChildren(...[0, 1, 2].map((i) => el('div', 'slot', `<span class="lane-no">${i + 1}</span>`)));
    return [...row.children] as HTMLElement[];
  }

  /** The creatures burst out: faces in a loose row (their order is hidden), the law of this world, then the tell. */
  async emerge(
    team: string[],
    law: Law | null,
    title: string,
    dark: boolean,
    world: WorldId | null = null,
  ): Promise<void> {
    this.dark = dark;
    this.root.classList.add('on');
    this.root.classList.toggle('dark', dark);
    this.title.innerHTML = title;
    this.heading = title;
    this.lawEl.innerHTML = law ? `<b>${LAW_GLYPH[law]}</b>` : '';
    this.foeIds = [];
    this.meIds = [];
    this.meRow.replaceChildren();
    this.foeRow.replaceChildren();
    this.mid.replaceChildren();
    this.dock.replaceChildren();
    this.audio.sfx('whoosh');
    await this.arena.enter(world, dark);
    void tween(
      this.title,
      [
        { opacity: 0, transform: 'translateY(-12px)' },
        { opacity: 1, transform: 'none' },
      ],
      300,
      EASE.out,
    );
    if (team.length)
      await this.arena.emerge(team, dark, (i) => {
        this.audio.sfx('slam', i);
        this.audio.grunt(GRUNT[creature(team[i]!).world]);
      });
    if (law) void pop(this.lawEl, 0.4);
  }

  /** The honest tell: "the Kraken always strikes first" — one of them steps into its known lane. */
  async tell(tells: { lane: number; cid: string }[], dark: boolean): Promise<void> {
    void dark;
    for (const t of tells) await this.arena.tell(t.lane, t.cid);
  }

  /** Build your team: pick three from your hand, in the order they will fight. Returns the team Answer. */
  askTeam(a: TeamAsk, name: string): Promise<Extract<Answer, { k: 'team' }>> {
    return new Promise((done) => {
      if (!a.faces) this.title.innerHTML = `${esc(name)}: set your order, secretly`;
      const order: number[] = [];
      const hand = el('div', 'hand');
      const n = Math.max(1, Math.min(a.size, a.drawn.length));
      const lanesTxt = n === 1 ? 'one on one' : n === 2 ? 'two lanes' : 'three lanes';
      const info = el(
        'p',
        'dock-info',
        a.leadBest
          ? 'Your strongest must fight first.'
          : `${n < 3 ? `<b>${n} v ${n}</b>: ${lanesTxt}. ` : ''}Click your fighters in order: ${[1, 2, 3].slice(0, n).join(', ')}.`,
      );
      let bet = false;
      const fire: Fire | null = null;
      const betBtn = a.canBet
        ? (el('button', 'betbtn', '<kbd>B</kbd> Bet a heart') as HTMLButtonElement)
        : null;
      const go = el('button', 'go', '<kbd>ENTER</kbd> Fight') as HTMLButtonElement;
      const cards = a.drawn.map((o, i) => {
        const c = cardEl(o.cid, { owned: o });
        c.tabIndex = 0;
        c.append(el('kbd', 'cc-key', String(i + 1)));
        c.addEventListener('click', () => toggle(o.uid));
        hand.append(c);
        return c;
      });
      const render = () => {
        // Your fighters step into the arena as you choose (never in a secret order: the rival is watching).
        if (!a.secret)
          void this.arena.setMine([0, 1, 2].map((i) => a.drawn.find((x) => x.uid === order[i])?.cid ?? null));
        cards.forEach((c, i) => {
          const lane = order.indexOf(a.drawn[i]!.uid);
          c.classList.toggle('chosen', lane >= 0);
          c.dataset.lane = lane >= 0 ? `LANE ${lane + 1}` : '';
        });
        go.disabled = order.length < n;
        if (betBtn) betBtn.classList.toggle('on', bet);
      };
      const toggle = (uid: number) => {
        const i = order.indexOf(uid);
        if (i >= 0) order.splice(i, 1);
        else if (order.length < n) order.push(uid);
        this.audio.sfx('choose', order.length);
        render();
      };
      betBtn?.addEventListener('click', () => {
        bet = !bet;
        render();
      });
      const finish = async () => {
        if (order.length < n) return;
        removeEventListener('keydown', key);
        // Top Trumps: for each lane you call, choose the stat both cards will compare.
        const chosen = order.map((u) => a.drawn.find((o) => o.uid === u)!);
        const calls: (Stat | null)[] = [null, null, null];
        for (const lane of a.calls) if (chosen[lane]) calls[lane] = await this.callStat(chosen[lane]!, lane, a);
        // In a rival clash, the special is chosen now, in secret, with the order.
        void this.pickSecretMove;
        this.dock.replaceChildren();
        done({ k: 'team', order: [...order], bet, fire, calls });
      };
      go.addEventListener('click', () => void finish());
      const key = (e: KeyboardEvent) => {
        const n = Number(e.key);
        if (n >= 1 && n <= a.drawn.length) toggle(a.drawn[n - 1]!.uid);
        else if (e.key.toLowerCase() === 'b' && betBtn) {
          bet = !bet;
          render();
        } else if (e.code === 'Enter') void finish();
      };
      addEventListener('keydown', key);
      this.dock.replaceChildren(info, hand, el('div', 'dock-actions'));
      this.dock.lastElementChild!.append(...(betBtn ? [betBtn] : []), go);
      render();
      if (auto.on)
        setTimeout(() => {
          for (const o of [...a.drawn].sort(() => Math.random() - 0.5).slice(0, n)) toggle(o.uid);
          void finish();
        }, 900 / clock.speed);
    });
  }

  /** Call a stat for one lane: the card, its six numbers as six big buttons (keys 1–6). */
  private callStat(o: Owned, lane: number, a: TeamAsk): Promise<Stat> {
    return new Promise((done) => {
      const st = fighter(o).stats;
      const forced = a.law === 'onlyTypes' ? 'MAGIC' : a.law === 'onlySize' ? 'SIZE' : null;
      const box = el('div', 'callpick');
      const card = cardEl(o.cid, { owned: o });
      const right = el('div', 'callside');
      right.append(
        el('h3', '', `LANE ${lane + 1}: CALL A STAT`),
        el(
          'p',
          'dock-info',
          forced
            ? `${forced} ONLY here: the land decides.`
            : `Call your card's stat. ${a.faces ? 'The beast in this lane calls one too' : 'Your rival calls one too'}, hidden until the reveal. Both cards add BOTH numbers: the bigger total wins.`,
        ),
      );
      const grid = el('div', 'calls');
      STATS.forEach((s, i) => {
        const b = el('button', 'opt', `<span><kbd>${i + 1}</kbd>${s}</span><b>${st[s]}</b>`) as HTMLButtonElement;
        if (forced && s !== forced) b.disabled = true;
        b.addEventListener('click', () => end(s));
        grid.append(b);
      });
      right.append(grid);
      box.append(card, right);
      this.dock.replaceChildren(box);
      void this.arena.spotlight(lane);
      const key = (e: KeyboardEvent) => {
        const n = Number(e.key);
        if (n >= 1 && n <= 6 && (!forced || STATS[n - 1] === forced)) end(STATS[n - 1]!);
      };
      addEventListener('keydown', key);
      let ended = false;
      const end = (s: Stat) => {
        if (ended) return;
        ended = true;
        removeEventListener('keydown', key);
        this.arena.spotlight(null);
        done(forced ?? s);
      };
      if (forced) setTimeout(() => end(forced), 900 / clock.speed);
      else if (auto.on) setTimeout(() => end(STATS.reduce((x, y) => (st[y] > st[x] ? y : x))), 600 / clock.speed);
    });
  }

  /** PvP: choose one special (or hold) for the secret order. */
  private pickSecretMove(team: Owned[]): Promise<Fire | null> {
    return new Promise((done) => {
      const box = el('div', 'movepick');
      box.append(el('p', 'dock-info', 'Choose one special to fire, or hold.'));
      const opts: { label: string; fire: Fire | null }[] = [{ label: 'Hold', fire: null }];
      team.forEach((o, lane) => {
        for (const m of fighter(o).moves) {
          if (MOVE[m].aims)
            for (const t of [0, 1, 2])
              opts.push({
                label: `${MOVE[m].name} (lane ${lane + 1} → their ${t + 1})`,
                fire: { lane, target: t, move: m },
              });
          else
            opts.push({ label: `${MOVE[m].name} (lane ${lane + 1})`, fire: { lane, target: lane, move: m } });
        }
      });
      const row = el('div', 'opts small');
      opts.slice(0, 9).forEach((op, i) => {
        const b = el('button', 'opt', `<kbd>${i + 1}</kbd>${esc(op.label)}`);
        b.addEventListener('click', () => end(i));
        row.append(b);
      });
      box.append(row);
      this.dock.replaceChildren(box);
      const key = (e: KeyboardEvent) => {
        const n = Number(e.key);
        if (n >= 1 && n <= Math.min(9, opts.length)) end(n - 1);
        else if (e.code === 'Enter') end(0);
      };
      addEventListener('keydown', key);
      const end = (i: number) => {
        removeEventListener('keydown', key);
        done(opts[i]!.fire);
      };
      if (auto.on)
        setTimeout(() => end(Math.floor(Math.random() * Math.min(4, opts.length))), 700 / clock.speed);
    });
  }

  /** THE STRIKE: one timed blow per lane. Returns the hits (0 miss · 1 good · 2 perfect). */
  async askStrike(side: 'me' | 'foe', lanes: number[], name: string): Promise<number[]> {
    this.dock.replaceChildren(
      el('p', 'strike-info', `<b>${esc(name)}: STRIKE!</b> Press <kbd>SPACE</kbd> or tap as the white ring meets the gold.`),
    );
    const hits = [0, 0, 0];
    for (const lane of lanes)
      hits[lane] = await this.arena.charge(side, lane, auto.on, (h) =>
        this.audio.sfx(h >= 2 ? 'tame' : h === 1 ? 'tick' : 'standoff', h),
      );
    this.dock.replaceChildren();
    return hits;
  }

  /** Both orders are revealed: everyone takes their lane. */
  async orders(
    mine: (string | null)[],
    theirs: (string | null)[],
    owned: Owned[],
    calls: Stat[] = [],
    foeCalls: (Stat | null)[] = [],
  ): Promise<void> {
    this.foeIds = theirs;
    this.meIds = mine;
    this.dock.replaceChildren();
    this.title.innerHTML = this.heading;
    this.audio.sfx('flip');
    await this.arena.orders(mine, theirs, this.dark);
    // Each lane's two calls, and what each card makes of them (a relic or a hex already counted).
    const statsFor = (cid: string | null) => {
      if (!cid) return null;
      const o = owned.find((x) => x.cid === cid);
      return o ? fighter(o).stats : fighter({ uid: -1, cid, ascended: false, wins: 0, tired: false }).stats;
    };
    const tags = [0, 1, 2].map((i) => {
      const a = calls[i] && mine[i] ? calls[i]! : null;
      const b = foeCalls[i] ?? null;
      const stats = [a, b].filter((x): x is Stat => !!x);
      const sum = (cid: string | null) => {
        const st = statsFor(cid);
        return st && stats.length ? stats.reduce((t, x) => t + st[x], 0) : null;
      };
      return { tag: stats.length === 2 && stats[0] === stats[1] ? `${stats[0]} ×2` : stats.join(' + '), me: sum(mine[i] ?? null), foe: sum(theirs[i] ?? null) };
    });
    await this.arena.reveal(tags);
    await wait(250);
  }

  /** A special fires: a bolt from the caster to its target, the move's name over the lane. */
  async fired(
    side: 'me' | 'foe',
    move: Move,
    lane: number,
    target: number,
    who: string,
    free: boolean,
  ): Promise<void> {
    void who;
    void free;
    this.audio.sfx('whoosh');
    await this.arena.fired(side, move, lane, target);
  }

  /** Ask for your special move with full information; each option previews what it would do. */
  askMove(a: MoveAsk, owned: Owned[]): Promise<Extract<Answer, { k: 'move' }>> {
    const law = a.law;
    const preview = (extra: Fired[]) =>
      resolve(a.mine, a.theirs, [...a.fired, ...extra], { law, ties: law === 'homeSoil' ? 'foe' : null, calls: a.calls });
    const base = preview([]);
    const word = (r: ReturnType<typeof preview>) =>
      r.outcome === 'win' ? 'you lead' : r.outcome === 'lose' ? 'you trail' : 'level';
    const opts: { html: string; fire: Fire | null; bench?: { lane: number; uid: number } }[] = [
      { html: `<b>Hold</b><small>${word(base)} (${base.won}–${base.lost})</small>`, fire: null },
    ];
    a.mine.forEach((f, lane) => {
      if (!f || a.free.includes(lane)) return;
      for (const m of f.moves) {
        const targets = MOVE[m].aims ? [0, 1, 2] : [lane];
        for (const target of targets) {
          const r = preview([{ side: 'me', lane, move: m, target }]);
          opts.push({
            html: `<b>${MOVE[m].name}</b> <em>${esc(creature(f.id).name.split(',')[0]!)}</em>${MOVE[m].aims ? ` → their ${target + 1}` : ''}<small>${word(r)} (${r.won}–${r.lost})</small>`,
            fire: { lane, target, move: m },
          });
        }
      }
    });
    for (const b of a.bench)
      a.mine.forEach((f, lane) => {
        if (f)
          opts.push({
            html: `<b>Bait and switch</b> lane ${lane + 1} ← ${esc(creature(b.cid).name.split(',')[0]!)}`,
            fire: null,
            bench: { lane, uid: b.uid },
          });
      });
    const free: Fire[] = a.free.map((lane) => {
      const f = a.mine[lane]!;
      const m = f.moves[0]!;
      let best = { target: lane, s: -9 };
      for (const target of MOVE[m].aims ? [0, 1, 2] : [lane]) {
        const r = preview([{ side: 'me', lane, move: m, target }]);
        if (r.won - r.lost > best.s) best = { target, s: r.won - r.lost };
      }
      return { lane, target: best.target, move: m };
    });
    void owned;
    return new Promise((done) => {
      const box = el('div', 'movepick');
      box.append(
        el(
          'p',
          'dock-info',
          `Fire one special${free.length ? ' (your golden fighters fire free)' : ''}, or hold.`,
        ),
      );
      const row = el('div', 'opts small');
      const shown = opts.slice(0, 12);
      let best = 0;
      shown.forEach((op, i) => {
        const b = el('button', 'opt', `<kbd>${i < 9 ? i + 1 : ''}</kbd>${op.html}`);
        b.addEventListener('click', () => end(i));
        row.append(b);
      });
      box.append(row);
      const ember = el('div', 'ember', '<i></i>');
      box.append(ember);
      (ember.firstElementChild as HTMLElement).animate(
        [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }],
        { duration: 10000 / clock.speed, fill: 'forwards' },
      );
      const timer = setTimeout(() => end(best), 10000 / clock.speed);
      this.dock.replaceChildren(box);
      const key = (e: KeyboardEvent) => {
        const n = Number(e.key);
        if (n >= 1 && n <= Math.min(9, shown.length)) end(n - 1);
        else if (e.code === 'Enter') end(0);
      };
      addEventListener('keydown', key);
      let ended = false;
      const end = (i: number) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        removeEventListener('keydown', key);
        this.dock.replaceChildren();
        const op = shown[i]!;
        done({ k: 'move', fire: op.fire, free, bench: op.bench ?? null });
      };
      best = 0;
      if (auto.on)
        setTimeout(() => end(Math.floor(Math.random() * Math.min(3, shown.length))), 800 / clock.speed);
    });
  }

  /** Resolve lane by lane: count-up with chips, the winner glows, the cause is named. Returns after the verdict. */
  async resolve(
    lanes: LaneView[],
    outcome: 'win' | 'lose' | 'standoff',
    verdict: string,
    crowd: boolean,
  ): Promise<void> {
    this.mid.replaceChildren();
    // The deciding blow: the last lane the overall winner takes (only it gets the heavy hit and the shake).
    const side = outcome === 'win' ? 'me' : outcome === 'lose' ? 'foe' : null;
    const deciding = side ? lanes.map((l, i) => (l.res === side && !l.idle ? i : -1)).filter((i) => i >= 0).at(-1) : -1;
    this.audio.setMood('silent');
    const live = lanes.filter((l) => l.me || l.foe);
    let mineSoFar = 0;
    let theirsSoFar = 0;
    for (const [i, l] of lanes.entries()) {
      if (!l.me && !l.foe) continue;
      // The last lane with everything riding on it: everyone holds their breath.
      const last = i === live.length - 1 && live.length > 1;
      if (last && mineSoFar === theirsSoFar) {
        const hush = el('div', 'hush', '<b>IT ALL COMES DOWN TO THIS</b>');
        this.mid.append(hush);
        this.audio.sfx('omen');
        void pop(hush, 0.5);
        await wait(1200);
        hush.remove();
      }
      const close = Math.abs(l.mine - l.theirs) <= 6 && l.res !== 'tie';
      const cell = el('div', `lane-res${l.idle ? ' idle' : ''}`);
      const at = this.arena.laneMid(i);
      cell.style.left = `${at.x}px`;
      cell.style.top = `${at.y}px`;
      this.mid.append(cell);
      if (l.idle) {
        cell.innerHTML = '<small>does not count</small>';
        continue;
      }
      this.arena.spotlight(i);
      cell.innerHTML = `<span class="stat">${l.stat2 ? (l.stat2 === l.stat ? `${l.stat} ×2` : `${l.stat} + ${l.stat2}`) : l.stat}</span><span class="n me">0</span><span class="vs">vs</span><span class="n foe">0</span><div class="chips"></div><b class="cause"></b>`;
      const [nf, nm] = [
        cell.querySelector('.n.foe') as HTMLElement,
        cell.querySelector('.n.me') as HTMLElement,
      ];
      const chips = cell.querySelector('.chips') as HTMLElement;
      // v13 (owner: "reveals bhi hum khud click karke dekh lenge"): the table turns each lane over itself, like a card.
      if (reader.manual) {
        cell.classList.add('waiting');
        (cell.querySelector('.cause') as HTMLElement).textContent = 'TAP TO REVEAL';
        await readGate(250);
        cell.classList.remove('waiting');
        (cell.querySelector('.cause') as HTMLElement).textContent = '';
      } else await wait(200);
      // A close lane counts up slowly, neck and neck (the numbers race; nobody knows until they stop).
      const ms = close ? 1500 : 600;
      await Promise.all([
        countUp(nm, 0, l.mine, ms, (k) => this.audio.sfx('count', k)),
        countUp(nf, 0, l.theirs, ms),
      ]);
      if (close) {
        cell.classList.add('close');
        this.audio.sfx('standoff');
        await wait(500);
      }
      for (const c of l.chips) {
        const chip = el('span', `chip ${c.side}`, esc(c.text));
        chips.append(chip);
        void pop(chip, 0.35);
        this.audio.sfx('tick', 3);
        await wait(260);
      }
      const win = l.res === 'me' ? 'me' : l.res === 'foe' ? 'foe' : 'tie';
      this.audio.sfx(win === 'tie' ? 'standoff' : 'slam', i);
      await this.arena.fight(i, win, i === deciding || close);
      cell.classList.add(win);
      (cell.querySelector('.cause') as HTMLElement).textContent = close ? 'BY A HAIR!' : l.cause;
      this.audio.sfx(win === 'me' ? 'win' : win === 'foe' ? 'heart' : 'standoff');
      if (l.res === 'me') mineSoFar++;
      if (l.res === 'foe') theirsSoFar++;
      // v12 (owner: "bich bich mein bahut gap"): the suspense lives in the close lanes; a clear lane moves on.
      await wait(close ? 900 : 420);
    }
    const v = el(
      'div',
      `verdict ${outcome}`,
      `<b>${verdict}</b>${crowd ? '<small>The crowd decides: yours.</small>' : ''}`,
    );
    this.mid.append(v);
    void this.arena.verdict(outcome);
    void tween(
      v,
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1.6)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
      ],
      380,
      EASE.pop,
    );
    this.audio.sfx(outcome === 'win' ? 'tame' : outcome === 'lose' ? 'shatter' : 'standoff');
    // The verdict stays until the table has taken it in.
    if (reader.manual) await readGate(700);
    else await wait(1100);
  }

  async close(): Promise<void> {
    if (!this.root.classList.contains('on')) return;
    await Promise.all([tween(this.root, [{ opacity: 1 }, { opacity: 0 }], 260, EASE.in), this.arena.close()]);
    this.root.classList.remove('on', 'dark');
    this.root.style.opacity = '';
    void this.foeIds;
    void this.meIds;
  }
  get open(): boolean {
    return this.root.classList.contains('on');
  }
}
export type { Fighter };
