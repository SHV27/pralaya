/**
 * The Director plays PRALAYA's beats on screen, one subject at a time (setup → event → consequence), and turns each Ask into a
 * screen. It keeps its OWN view of the board and the plates, updated only by beats, so the screen never shows the future (the
 * rules run ahead to the next question; the presenter catches up beat by beat). Every hold has a reading time; SPACE or a tap
 * skips only the tail (timing-v8).
 */
import { ATTACKS, BOON, CHANCE, DISASTERS, ENCOUNTERS, PLACES_V10, VERSES, type Fate } from '../game/v8/cards.ts';
import { CENTRE, distance, type Space } from '../game/v8/map.ts';
import {
  alive,
  creature,
  progress,
  reach,
  type Answer,
  type Ask,
  type Beat,
  type Game,
  powerEvery,
} from '../game/v8/rules.ts';
import { TUNE } from '../game/v8/tune.ts';
import type { WorldId } from '../game/v8/types.ts';
import { clock, esc, readMs, reader, wait } from '../play/anim.ts';
import type { Audio } from '../play/audio.ts';
import type { Fx } from '../play/fx.ts';
import { WorldMap, placeName } from './world/map.ts';
import { initGfx } from './world/gfx.ts';
import { Hud, type PlateView } from './hud.ts';
import { SEAT, art } from './look.ts';
import { Stage } from './stage.ts';
import { BIG, GIFT, HEART_WHY, MOVE, TYPE, WORLD } from './text.ts';
import { auto, bigCard, cardEl, choose, cover, type Option } from './ui.ts';
import { chanceCard, rollDie, trialRing, wheelReels } from './v9ui.ts';

/** A creature named in a sentence: "The Kraken", never "The The Kraken". */
const theName = (full: string): string => {
  const n = full.split(',')[0]!;
  return /^the /i.test(n) ? `<b>${esc(n)}</b>` : `The <b>${esc(n)}</b>`;
};

export interface StoryLine {
  text: string;
  seat: number | null;
  img?: string;
  weight: number;
  t: number;
}
export interface Result {
  winner: number;
  why: 'last' | 'escape' | 'walkout' | 'world';
  story: StoryLine[];
}

const TRAIL = ['#e9c46a', '#4fd1a5', '#f28fd0', '#8ab4ff'];
/** Bets that only pay if the rival WINS (the plate says "roots FOR": the table sees who is cheering whom). */
const ROOTS = new Set(['unholy', 'hitch', 'shared']);

/** Beats that belong to a clash on screen (the stage stays open for them). */
const CLASH_BEATS = new Set<Beat['t']>(['wildDraw', 'emerge', 'tell', 'team', 'orders', 'fired', 'bench', 'clash', 'capture', 'lost', 'heart', 'ascend', 'bet', 'boon', 'boonUsed', 'guarded', 'relic', 'out', 'wagerEnd', 'news', 'mod']);

export class Director {
  readonly board!: WorldMap;
  readonly hud: Hud;
  readonly stage: Stage;
  private pv: PlateView[];
  private spaces: Space[];
  private at: number[];
  private shown = 0;
  private story: StoryLine[] = [];
  private emerging: { team: string[]; at: number; seat: number; vs: number | null } | null = null;
  private teamOwned = new Map<number, import('../game/v8/rules.ts').Owned[]>();
  // v9, as SHOWN (never the live state): turns played, when each power is ready, bets, the bomb, curses, flexes, the boss.
  private turnsOf: number[] = [];
  private powerAt: number[] = [];
  private bets = new Map<number, { by: number; on: number; card: string; to?: number; call?: 'win' | 'lose' | null }>();
  /** v12 WANTED (on → by) and VENGEANCE (by remembers on): shown as badges so every turn matters to everyone. */
  private bounties = new Map<number, number>();
  private feuds: { by: number; on: number }[] = [];
  private turnSeat = -1;
  private bombOn: number | null = null;
  /** v14 THE HUNT: who the beast is chasing (a HUNTED badge), as shown. */
  private hunted: number | null = null;
  /** v15 sworn allies, as shown. */
  private sworn: [number, number][] = [];
  private cursed = new Set<number>();
  private flexed = new Set<number>();
  private bossName = '';
  /** The ally walking beside each hero (their newest creature, as shown). */
  private held: string[][] = [];
  /** v10: the Oracle's Ladder as shown, and the fallen's traps on the map. */
  private ladder: { cid: string; val: number }[] = [];
  private bloodOn = false;
  private traps = new Set<number>();
  private ladderHtml(stat: string): string {
    return `<div class="ladder">${this.ladder.map((r) => `<div class="rung"><img src="${art(r.cid)}" alt=""><small>${esc(creature(r.cid).name.split(',')[0]!)}</small><b>${stat} ${r.val}</b></div>`).join('<i>›</i>')}</div>`;
  }

  private root: HTMLElement;
  private g: Game;
  private audio: Audio;
  private fx: Fx;
  constructor(root: HTMLElement, g: Game, audio: Audio, fx: Fx) {
    this.root = root;
    this.g = g;
    this.audio = audio;
    this.fx = fx;
    this.hud = new Hud(root);
    this.stage = new Stage(root, audio);
    this.pv = g.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      heroId: p.hero.id,
      heroName: p.hero.name,
      hearts: p.hearts,
      creatures: p.deck.length,
      relics: 0,
      out: false,
      betUsed: false,
      golden: 'none',
      badges: '',
    }));
    this.turnsOf = g.players.map(() => 0);
    this.powerAt = g.players.map(() => TUNE.powerFirst);
    this.spaces = g.board.map((s) => ({ ...s, adj: [...s.adj] }));
    this.at = g.players.map((p) => p.at);
    this.hud.update(this.pv, null);
    this.hud.world('hunt', 0, TUNE.lastLightAt);
  }

  /** Build the world (the renderer, the paintings, the islands) before the first beat. */
  async init(): Promise<void> {
    await initGfx(this.root);
    (this as { board: WorldMap }).board = new WorldMap(this.root, this.audio);
    await this.board.load(this.g.players.map((p) => art(p.hero.id)));
    this.board.setPetals(this.g.petals);
    this.board.setBoard(this.spaces);
    this.board.tokensSet(this.tokens());
    for (const p of this.g.players) {
      this.held[p.seat] = p.deck.map((o) => o.cid);
      void this.board.setAlly(p.seat, this.held[p.seat]!.at(-1) ?? null);
    }
    (window as unknown as { __world?: WorldMap }).__world = this.board;
    this.refresh(null);
  }

  private tokens() {
    return this.pv.map((p) => ({
      seat: p.seat,
      at: this.at[p.seat]!,
      out: p.out,
      colour: SEAT[p.seat]!,
      art: art(p.heroId),
    }));
  }
  private name(seat: number): string {
    return `<b class="who" style="color:${SEAT[seat]}">${esc(this.g.players[seat]!.name)}</b>`;
  }
  private plain(seat: number): string {
    return this.g.players[seat]!.name;
  }
  private note(text: string, seat: number | null, weight: number, img?: string): void {
    this.story.push({ text, seat, img, weight, t: this.story.length });
  }
  private refresh(active: number | null = null): void {
    for (const v of this.pv) {
      const s = v.seat;
      const left = this.powerAt[s]! - (this.turnsOf[s]! + (s === active ? 0 : 1));
      const hero = this.g.players[s]!.hero;
      const b: string[] = [];
      if (!v.out)
        b.push(
          left <= 0
            ? `<span class="bdg power on" title="${esc(hero.giftName)}: ${esc(hero.giftText)}">POWER READY</span>`
            : `<span class="bdg power" title="${esc(hero.giftName)}: ${esc(hero.giftText)}">POWER IN ${left}</span>`,
        );
      if (this.bombOn === s) b.push('<span class="bdg bomb">BOMB</span>');
      // v15: allies and a ghost's whisper, shown on the plate.
      for (const [x, y] of this.sworn)
        if ((x === s || y === s) && !v.out) b.push(`<span class="bdg sworn" title="Sworn allies share every battle won. If you meet: keep the oath, or betray.">SWORN · ${esc(this.plain(x === s ? y : x))}</span>`);
      if (this.hunted === s && !v.out)
        b.push(`<span class="bdg hunted" title="${esc(this.bossName)} hunts you. It rolls its own die each round and runs at you. Stay out of reach, shelter under a tree, or fight it for its legend.">HUNTED</span>`);
      if (this.cursed.has(s)) b.push('<span class="bdg curse">CURSED</span>');
      if (this.bounties.has(s)) b.push(`<span class="bdg wanted" title="${esc(CHANCE.bounty!.text)}">WANTED</span>`);
      for (const f of this.feuds)
        if (f.on === s) b.push(`<span class="bdg feud" style="--by:${SEAT[f.by]}" title="Their next duel: the winner takes two.">${esc(this.plain(f.by))} wants VENGEANCE</span>`);
      for (const w of this.bets.values())
        if (w.to === s)
          b.push(`<span class="bdg bet" style="--by:${SEAT[w.by]}" title="${esc(CHANCE[w.card]?.text ?? '')}">tied to ${esc(this.plain(w.by))}</span>`);
      for (const w of this.bets.values())
        if (w.on === s)
          b.push(
            `<span class="bdg bet" style="--by:${SEAT[w.by]}" title="${esc(CHANCE[w.card]?.text ?? '')}">${esc(this.plain(w.by))} ${w.by === s ? 'bets on self' : w.call ? `calls ${w.call.toUpperCase()}` : ROOTS.has(w.card) ? 'roots FOR' : 'bets AGAINST'}</span>`,
          );
      v.badges = b.join('');
    }
    this.hud.update(this.pv, active);
  }
  /** [[n]] in a rules sentence becomes seat n's coloured name. */
  private names(text: string, plain = false): string {
    return text.replace(/\[\[(\d+)\]\]/g, (_, n: string) => (plain ? this.plain(Number(n)) : this.name(Number(n))));
  }

  /** Drive the whole match: play beats, answer asks, return the result. */
  async run(it: Generator<Ask, void, Answer>): Promise<Result> {
    let r = it.next();
    for (;;) {
      await this.catchUp();
      if (r.done) break;
      const answer = await this.answer(r.value);
      r = it.next(answer);
    }
    await this.catchUp();
    const win = [...this.g.log].reverse().find((b) => b.t === 'win') as
      Extract<Beat, { t: 'win' }> | undefined;
    const kept = this.g.log.find((b) => b.t === 'worldWins') as Extract<Beat, { t: 'worldWins' }> | undefined;
    if (!win && kept) return { winner: kept.seat, why: 'world', story: this.story };
    return { winner: win?.seat ?? this.g.winner ?? 0, why: win?.why ?? 'last', story: this.story };
  }

  private async catchUp(): Promise<void> {
    while (this.shown < this.g.log.length) {
      const b = this.g.log[this.shown]!;
      const clockNow = this.g.clocks[this.shown]!;
      this.shown++;
      this.hud.world(this.moodNow(), Math.min(1, clockNow / this.g.target), TUNE.lastLightAt);
      this.board.setHeat(clockNow / this.g.target / TUNE.lastLightAt);
      // A safety net: no beat may hold the table hostage. A stall is recorded (QA reads it), never shown.
      let timer = 0;
      const t0 = performance.now();
      let readFor = 0;
      const rt = window.setInterval(() => reader.waiting && (readFor += 100), 100);
      const stalled = await Promise.race([
        this.beat(b).then(() => false),
        // 40 s of NOT reading: a person reading a card is never a stall.
        new Promise<boolean>((ok) => {
          let idle = 0;
          timer = window.setInterval(() => {
            if (!reader.waiting) idle += 500;
            if (idle >= 40000) ok(true);
          }, 500);
        }),
      ]);
      clearInterval(timer);
      clearInterval(rt);
      // QA: how long each beat held the screen, minus time a person spent reading (window.__beatMs; never shown).
      ((window as unknown as { __beatMs?: [string, number][] }).__beatMs ??= []).push([b.t, Math.round(performance.now() - t0 - readFor)]);
      if (stalled) ((window as unknown as { __stalls?: string[] }).__stalls ??= []).push(b.t);
    }
  }
  private mood: 'hunt' | 'frenzy' | 'sated' = 'hunt';
  private moodNow() {
    return this.mood;
  }

  // ── Beats ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private async beat(b: Beat): Promise<void> {
    const P = (s: number) => this.pv[s]!;
    // One subject at a time: the last caption leaves before the next beat speaks.
    if (b.t !== 'step' && b.t !== 'round') this.hud.clear();
    if (!['step', 'round', 'land', 'reveal', 'start', 'turn'].includes(b.t)) this.board.hideBanner();
    // The clash stage stays up through its consequences, then gives the board back (one subject at a time).
    if (this.stage.open && !CLASH_BEATS.has(b.t)) {
      await this.stage.close();
      await this.board.focus(null);
    }
    switch (b.t) {
      case 'start': {
        this.audio.setMood('calm');
        const t0 = performance.now();
        await this.board.fall(
          this.g.players.map((p) => p.name),
          this.g.players.map((p) => ({ seat: p.seat, at: this.at[p.seat]! })),
          () => clock.skipAt > t0,
        );
        await this.hud.say(
          `<i>${VERSES.opening.replaceAll(' / ', '<br>')}</i>`,
          VERSES.opening,
          { min: 2600, tail: 400, tone: 'rumour' },
        );
        return;
      }
      case 'round':
        this.mood = b.mood;
        return;
      case 'turn': {
        this.turnSeat = b.seat;
        this.turnsOf[b.seat]!++;
        this.refresh(b.seat);
        this.board.setActive(b.seat);
        this.board.hideBanner();
        await this.board.followSeat(b.seat, 'region');
        await this.hud.say(`${this.name(b.seat)}'s turn`, `${this.plain(b.seat)}'s turn`, {
          min: 700,
          tail: 200,
        });
        return;
      }
      case 'skip':
        await this.hud.say(
          b.why === 'slipper' ? `${this.name(b.seat)} is still seeing stars from the slipper. Skips.` : `${this.name(b.seat)} is tangled in vines. Skips.`,
          'skips',
          { tone: 'bad' },
        );
        return;
      case 'golden':
        P(b.seat).golden = 'held';
        this.refresh(b.seat);
        this.hud.hint('golden');
        this.audio.sfx('item');
        await this.hud.say(
          `${this.name(b.seat)} receives a <b class="gold">GOLDEN CARD</b>.`,
          'receives a golden card',
          { tone: 'gold' },
        );
        return;
      case 'fates':
        this.hud.hint('fates');
        return;
      case 'fateKept':
        this.board.clearTrails();
        this.audio.sfx('card');
        await this.hud.say(`<i>“${esc(b.fate.text)}”</i>`, b.fate.text, { min: 1200, tail: 300 });
        return;
      case 'step': {
        this.audio.sfx('step', 1);
        const path = [b.to];
        // Batch consecutive steps of the same seat into one walk.
        while (
          this.g.log[this.shown]?.t === 'step' &&
          (this.g.log[this.shown] as Extract<Beat, { t: 'step' }>).seat === b.seat
        ) {
          path.push((this.g.log[this.shown] as Extract<Beat, { t: 'step' }>).to);
          this.shown++;
        }
        this.at[b.seat] = path.at(-1)!;
        await this.board.walk(b.seat, path);
        if (b.chalk)
          await this.hud.say(
            `${this.name(b.seat)} chalks a bridge over the void.`,
            'chalks a bridge over the void',
            { tone: 'gold' },
          );
        return;
      }
      case 'stop':
        await this.hud.say(
          b.why === 'pig'
            ? `The pig decides. ${this.name(b.seat)} stops.`
            : `${this.name(b.by)}: “Sit down and eat.” ${this.name(b.seat)} stops.`,
          'stops',
        );
        return;
      case 'stuck':
        await this.hud.say(`${this.name(b.seat)} has nowhere to go.`, 'nowhere to go');
        return;
      case 'portal':
      case 'pushed': {
        this.at[b.seat] = b.to;
        this.audio.sfx(b.t === 'portal' ? 'portal' : 'whoosh');
        await this.board.jump(b.seat, b.to);
        const why: Record<string, string> = {
          carried: 'The jungle carries you to solid ground.',
          ferry: 'The Ferryman rows you inward.',
          bridge: 'Across the troll’s bridge.',
          garuda: 'Wings carry you anywhere.',
          boots: 'Seven leagues in one step.',
          vimana: 'The flying palace sets you down.',
          unknown: 'Into the unknown…',
          eaten: 'The ground is gone. You scramble.',
          washed: 'The monsoon washes you inward.',
          pulled: 'The black hole pulls you in.',
          dragged: 'The Kraken drags you back.',
          shuffle: 'The Great Shuffle moves you.',
          fate: 'A portal swallows you.',
          heart: 'The Burning Heart throws you across the world.',
        };
        const w = why[(b as { why?: string }).why ?? ''];
        if (w) await this.hud.say(`${this.name(b.seat)}: ${w}`, w, { min: 900 });
        return;
      }
      case 'swap': {
        const [a, c] = [this.at[b.seat]!, this.at[b.with]!];
        this.at[b.seat] = c;
        this.at[b.with] = a;
        this.audio.sfx('swap');
        await Promise.all([this.board.jump(b.seat, c), this.board.jump(b.with, a)]);
        await this.hud.say(`${this.name(b.seat)} and ${this.name(b.with)} swap places.`, 'swap places');
        return;
      }
      case 'reveal':
        for (const id of b.spaces) this.spaces[id]!.seen = true;
        this.board.updateSpaces(
          b.spaces.map((id) => ({ ...this.spaces[id]!, content: this.g.board[id]!.content })),
        );
        return;
      case 'land': {
        const s = this.spaces[b.at]!;
        s.seen = true;
        if (b.content !== 'friend' && b.content !== 'shelter') s.content = b.content;
        this.board.updateSpaces([s]);
        void this.board.arrive(b.at, this.plain(b.seat));
        if (b.content === 'gate')
          await this.hud.say(`${this.name(b.seat)} steps into <b class="gold">the Burning Heart</b>. It throws you to a random place. Pray.`, 'the burning heart throws you somewhere random', { min: 1600 });
        else if (b.content in PLACES_V10) {
          const pl = PLACES_V10[b.content as keyof typeof PLACES_V10];
          this.hud.hint(b.content);
          await this.hud.say(`${this.name(b.seat)} finds <b class="gold">${esc(pl.name)}</b>. <small>${esc(pl.text)}</small>`, `${pl.name} ${pl.text}`, { min: 1800 });
        }
        if (b.content === 'shelter')
          await this.hud.say(`The wishing tree shelters ${this.name(b.seat)}.`, 'the tree shelters');
        return;
      }
      case 'rumour':
        this.audio.sfx('omen');
        await this.hud.say(
          b.what === 'relic'
            ? `A relic hums in <b style="color:${WORLD[b.world].colour}">${WORLD[b.world].name}</b>.`
            : b.what === 'legend'
              ? `A legend wakes in <b style="color:${WORLD[b.world].colour}">${WORLD[b.world].name}</b>.`
              : `Something breathes in <b style="color:${WORLD[b.world].colour}">${WORLD[b.world].name}</b>.`,
          'a rumour',
          { tone: 'rumour' },
        );
        return;
      case 'emerge':
        return this.emerge(b);
      case 'tell':
        await this.stage.tell(b.tells, this.g.board[this.emerging?.at ?? 0]?.world === 'night');
        await this.hud.say(
          `${theName(creature(b.tells[0]!.cid).name)} always strikes in lane ${b.tells[0]!.lane + 1}.`,
          'always strikes in lane',
          { min: 1600, tail: 300 },
        );
        return;
      case 'team':
        if (b.bet) {
          P(b.seat).betUsed = true;
          this.refresh(b.seat);
          this.audio.sfx('heart');
          await this.hud.say(
            `${this.name(b.seat)} <b class="bad">bets a heart</b> on this clash.`,
            'bets a heart',
            { tone: 'bad' },
          );
        }
        return;
      case 'orders': {
        const owned = [
          ...(this.teamOwned.get(b.seat) ?? []),
          ...(b.vs !== null ? (this.teamOwned.get(b.vs) ?? []) : []),
        ];
        await this.stage.orders(b.mine, b.theirs, owned, b.calls, b.foeCalls);
        this.hud.hint('calls');
        const n = b.mine.filter((x) => x).length;
        const them = b.vs === null ? 'the wild' : this.plain(b.vs);
        await this.hud.say(
          `Their order is revealed. ${[...Array(n).keys()].map((i) => `Lane ${i + 1}: you <b>${b.calls[i]}</b>, ${esc(them)} <b>${b.foeCalls[i] ?? '?'}</b>`).join(' · ')}.`,
          'their order is revealed both calls count',
          { min: 2400, tail: 300 },
        );
        return;
      }
      case 'fired': {
        await this.stage.fired(b.side, b.move, b.lane, b.target, b.by, b.free);
        const who =
          b.seat === null ? theName(creature(b.by).name) : this.name(b.seat);
        await this.hud.say(
          `${who} fires <b>${MOVE[b.move].name.toUpperCase()}</b>: ${MOVE[b.move].rule}`,
          MOVE[b.move].rule,
          { min: 1500, tail: 300 },
        );
        return;
      }
      case 'strike':
        // A player's blows were shown live while they struck; the jungle's are shown now.
        if (b.seat === null) {
          await this.hud.say('The jungle strikes back.', 'the jungle strikes back', { min: 700, tail: 100 });
          await this.stage.arena.stamps('foe', b.hits);
        }
        return;
      case 'bench':
        await this.hud.say(
          `${this.name(b.seat)}: bait and switch! ${esc(creature(b.in).name.split(',')[0]!)} steps in.`,
          'bait and switch',
        );
        return;
      case 'clash': {
        if (b.vs !== null && b.outcome !== 'standoff') {
          const pair = (f: { by: number; on: number }) => (f.by === b.seat && f.on === b.vs) || (f.by === b.vs && f.on === b.seat);
          if (this.feuds.some(pair)) {
            this.feuds = this.feuds.filter((f) => !pair(f));
            this.refresh(null);
          }
        }
        const verdict =
          b.vs === null
            ? b.outcome === 'win'
              ? 'YOU WIN'
              : b.outcome === 'lose'
                ? 'THE WILD WINS'
                : 'STANDOFF'
            : b.outcome === 'standoff'
              ? 'STANDOFF'
              : `${esc(this.plain(b.outcome === 'win' ? b.seat : b.vs))} WINS`;
        this.hud.hint('clash');
        await this.stage.resolve(b.lanes, b.outcome, verdict, b.crowd);
        this.refresh(null);
        this.audio.setMood('hunt');
        if (
          b.vs === null &&
          b.outcome === 'win' &&
          this.spaces[b.at]?.content === 'lair' &&
          this.g.board[b.at]!.content === 'empty'
        ) {
          this.spaces[b.at]!.content = 'empty';
          this.board.updateSpaces([this.spaces[b.at]!]);
        }
        if (b.vs !== null)
          this.note(
            `${this.plain(b.seat)} met ${this.plain(b.vs)}: ${b.outcome === 'standoff' ? 'a standoff' : `${this.plain(b.outcome === 'win' ? b.seat : b.vs)} won`}.`,
            b.seat,
            1.5,
          );
        return;
      }
      case 'capture': {
        P(b.seat).creatures++;
        if (b.cid !== 'relic') {
          (this.held[b.seat] ??= []).push(b.cid);
          void this.board.setAlly(b.seat, b.cid);
        }
        this.refresh(b.seat);
        if (b.cid === 'relic') return;
        if (this.stage.open && (b.why === 'clash' || b.why === 'snatch')) await this.stage.arena.capture(b.cid);
        else void this.board.gift(b.seat);
        const c = creature(b.cid);
        this.audio.sfx('tame');
        const why = {
          clash: 'captures',
          snatch: 'snatches',
          steal: 'steals',
          cache: 'finds',
          riddle: 'gains',
          boon: 'is gifted',
          gamble: 'gambles and gets',
          gift: 'receives',
          power: 'takes',
          boss: 'lands the last hit and takes',
          wager: 'wins the bet and takes',
          nest: 'hatches',
          attack: 'stops the land, and is followed by',
          hilo: 'climbs the ladder and wins',
          trade: 'unmasks',
          altar: 'is granted',
          tame: 'tames',
        }[b.why];
        if (c.rarity === 'legendary')
          this.note(`${this.plain(b.seat)} ${why} the legendary ${c.name}.`, b.seat, 3, c.id);
        await this.flash(b.cid, `${this.name(b.seat)} ${why} <b>${esc(c.name)}</b>.`, `${why} ${c.name}`);
        return;
      }
      case 'lost': {
        P(b.seat).creatures = Math.max(0, P(b.seat).creatures - 1);
        {
          // The ally beside the hero is always their newest creature still held.
          const h = (this.held[b.seat] ??= []);
          const i = h.lastIndexOf(b.cid);
          if (i >= 0) h.splice(i, 1);
          void this.board.setAlly(b.seat, h.at(-1) ?? null);
        }
        this.refresh(b.seat);
        const c = creature(b.cid);
        const why: Record<Extract<Beat, { t: 'lost' }>['why'], string> = {
          clash: 'is beaten and flees',
          disaster: 'is lost to the disaster',
          world: 'falls into the void',
          riddle: 'is lost to the riddle',
          gamble: 'is lost to the gamble',
          stolen: 'is taken',
          release: 'is set free',
          fee: 'pays the toll',
          escaped: 'escapes the jar',
          hair: 'takes the blow instead. By a hair!',
          given: 'is handed over',
          void: 'is lost to the void',
          overboard: 'goes overboard',
          wager: 'is lost on the bet',
          trial: 'is trampled',
          attack: 'is taken by the land',
          trade: 'goes to the Masked Trader',
          altar: 'is offered on the altar',
          rope: 'falls with the rope',
          fled: 'runs away',
        };
        const olympian = c.world === 'olympus' && (c.rarity === 'legendary' || c.rarity === 'rare');
        const line = olympian && b.why !== 'release' ? 'yields with honour' : why[b.why];
        if (b.why === 'hair')
          this.note(`${this.plain(b.seat)} survived by a hair: ${c.name} took the blow.`, b.seat, 2.5, c.id);
        await this.hud.say(
          `${this.name(b.seat)}'s ${esc(c.name.split(',')[0]!)} ${line}.`,
          `${c.name} ${line}`,
          { tone: b.why === 'hair' ? 'gold' : 'bad', min: 1100, tail: 200 },
        );
        return;
      }
      case 'guarded':
        await this.hud.say(
          `Nothing gets through. ${this.name(b.seat)} keeps ${esc(creature(b.cid).name.split(',')[0]!)}.`,
          'nothing gets through',
          { tone: 'gold' },
        );
        return;
      case 'ascend': {
        this.hud.hint('ascend');
        await this.flash(
          b.cid,
          b.tier === 2
            ? `${esc(creature(b.cid).name.split(',')[0]!)} is <b class="gold">FABLED</b>: four lanes won for you. Every number +${TUNE.ascendLift} again. Guard it: the proud fall first.`
            : `${esc(creature(b.cid).name.split(',')[0]!)} <b class="gold">ASCENDS</b>: two lanes won for you. Every number +${TUNE.ascendLift}. Guard it: the proud fall first.`,
          b.tier === 2 ? 'fabled every number up again' : 'ascends every number up',
        );
        return;
      }
      case 'fuse':
        P(b.seat).creatures = Math.max(0, P(b.seat).creatures - 1);
        {
          const h = (this.held[b.seat] ??= []);
          const i = h.lastIndexOf(b.b);
          if (i >= 0) h.splice(i, 1);
          void this.board.setAlly(b.seat, h.at(-1) ?? null);
        }
        this.refresh(b.seat);
        this.note(
          `${this.plain(b.seat)} fused ${creature(b.a).name} with ${creature(b.b).name}.`,
          b.seat,
          2.5,
          b.a,
        );
        await bigCard(
          `<div class="fuse"><img src="${art(b.a)}" alt=""><b>+</b><img src="${art(b.b)}" alt=""></div><h2>FUSION</h2><p>${esc(creature(b.a).name.split(',')[0]!)} × ${esc(creature(b.b).name.split(',')[0]!)}: one card, the better of both in every stat.</p>`,
          2600,
        );
        return;
      case 'relic':
        P(b.seat).relics = b.relics;
        if (b.from !== null) P(b.from).relics = Math.max(0, P(b.from).relics - 1);
        this.refresh(b.seat);
        this.hud.hint('relic');
        this.audio.sfx('item');
        await this.hud.say(
          `${this.name(b.seat)} holds <b class="gold">${b.relics} relic${b.relics > 1 ? 's' : ''}</b>${b.relics >= 3 ? '. The fire calls.' : '.'}`,
          'holds relics',
          { tone: 'gold' },
        );
        return;
      case 'heart': {
        P(b.seat).hearts = b.hearts;
        this.refresh(b.seat);
        this.audio.sfx('shatter');
        // The heart breaks where everyone is looking: over the fight, or over the hero on the map.
        if (this.stage.open) await this.stage.arena.heartBreak();
        else await this.board.heartBreak(b.seat);
        const plate = this.hud.plateOf(b.seat);
        if (plate) {
          const r = plate.getBoundingClientRect();
          this.fx.burst(r.left + 40, r.top + r.height / 2, { n: 26, color: '#ff3355' });
        }
        const by =
          b.by !== null && b.why === 'player'
            ? ` (${this.plain(b.by)})`
            : b.cid
              ? ` (${creature(b.cid).name.split(',')[0]})`
              : '';
        this.note(`${this.plain(b.seat)} lost a heart${by}: ${HEART_WHY[b.why]}`, b.seat, 1);
        await this.hud.say(
          `${this.name(b.seat)} loses a heart. <small>${HEART_WHY[b.why]}${esc(by)}</small>`,
          `loses a heart ${HEART_WHY[b.why]}`,
          { tone: 'bad', min: 1500 },
        );
        return;
      }
      case 'heal':
        P(b.seat).hearts = b.hearts;
        this.refresh(b.seat);
        void this.board.gift(b.seat);
        this.audio.sfx('win');
        await this.hud.say(`${this.name(b.seat)} gains a heart.`, 'gains a heart', { tone: 'gold' });
        return;
      case 'out': {
        P(b.seat).out = true;
        for (const [id, w] of this.bets) if (w.by === b.seat || w.on === b.seat || w.to === b.seat) this.bets.delete(id);
        this.bounties.delete(b.seat);
        this.feuds = this.feuds.filter((f) => f.by !== b.seat && f.on !== b.seat);
        if (this.bombOn === b.seat) this.bombOn = null;
        this.refresh(null);
        await this.board.fallen(b.seat);
        this.board.tokensSet(this.tokens());
        this.audio.sfx('ko');
        this.fx.shake(0.8);
        this.note(
          `${this.plain(b.seat)} fell and became the world.`,
          b.seat,
          2.5,
          this.g.players[b.seat]!.hero.id,
        );
        await bigCard(
          `<img class="fallen" src="${art(this.g.players[b.seat]!.hero.id)}" alt=""><h2>${esc(this.plain(b.seat))} FALLS</h2><p class="verse">${VERSES.out.replaceAll(' / ', '<br>')}</p>`,
          3200,
          'out',
        );
        return;
      }
      case 'omen':
        this.hud.hint('omen');
        this.audio.sfx('omen');
        this.board.omen(b.spaces);
        return;
      case 'omenHeals':
        await this.board.omenHeals();
        await this.hud.say('The cracks close. False alarm.', 'the cracks close false alarm', {
          min: 900,
          tail: 200,
        });
        return;
      case 'eye':
        this.hud.stare();
        this.board.setActive(b.seat);
        await this.hud.say(`The world’s eye turns to ${this.name(b.seat)}.`, 'the world’s eye turns to', {
          min: 900,
          tail: 200,
          tone: 'bad',
        });
        return;
      case 'eat': {
        this.hud.hint('eat');
        this.audio.sfx('quake');
        this.fx.shake(b.size === 'world' ? 1 : 0.6);
        await this.board.eat(b.spaces, b.size === 'world' ? b.world : null);
        for (const id of b.spaces) this.spaces[id]!.void = true;
        const where = b.world
          ? `<b style="color:${WORLD[b.world].colour}">${WORLD[b.world].name}</b>`
          : 'the ring';
        await this.hud.say(
          b.size === 'world' ? `The world swallows ${where}.` : `The ground of ${where} falls away.`,
          'the world eats',
          { tone: 'bad', min: 1300 },
        );
        return;
      }
      case 'spared': {
        const why: Record<string, string> = {
          near: 'spared, by a hair',
          round1: 'is spared: the world is still waking',
          fly: 'is lifted to safety',
          brahmastra: 'is saved by a light no beast survives',
          cap: 'is spared',
        };
        if (b.why === 'near') this.note(`${this.plain(b.seat)} stood one step from the void.`, b.seat, 1.2);
        await this.hud.say(`${this.name(b.seat)} ${why[b.why]}. <b class="gold">SPARED!</b>`, 'spared', {
          tone: 'gold',
          min: 900,
          tail: 200,
        });
        return;
      }
      case 'tired':
        await this.hud.say(
          `${esc(creature(b.cid).name.split(',')[0]!)} uses <b>${GIFT[b.gift].name}</b> and tires.`,
          'uses its gift and tires',
          { min: 1000, tail: 200 },
        );
        return;
      case 'disaster': {
        this.hud.hint('disaster');
        const d = DISASTERS.find((x) => x.world === b.world)!;
        await this.board.disaster(b.seat, WORLD[b.world].colour);
        const dodge =
          b.why === 'dodge'
            ? `${esc(creature(b.dodged!).name.split(',')[0]!)} dodges it. <b class="gold">SPARED!</b>`
            : b.why === 'slept'
              ? 'Slept straight through it.'
              : b.why === 'brahmastra'
                ? 'A light no beast survives: undone.'
                : 'No creature can dodge it.';
        await bigCard(
          `<h2 style="color:${WORLD[b.world].colour}">${esc(d.name)}</h2><p>${esc(d.caption)}</p><small>Dodge: ${d.dodgeType ? `${TYPE[d.dodgeType].name} type` : GIFT[d.dodgeGift!].name}</small>`,
          1600,
          'disaster',
        );
        await this.hud.say(`${this.name(b.seat)}: ${dodge}`, dodge, { tone: b.why ? 'gold' : 'bad' });
        return;
      }
      case 'riddle':
        await this.hud.say(
          `${this.name(b.seat)} chooses: <i>${esc(b.pick === 'a' ? b.riddle.a : b.riddle.b)}</i>${b.random ? ' (eyes shut)' : ''}.`,
          b.pick === 'a' ? b.riddle.a : b.riddle.b,
        );
        return;
      case 'hunter': {
        const lead = creature(b.team[0]!);
        this.audio.sfx('slam');
        this.audio.grunt('roar');
        void lead;
        await this.board.addHunter(b.id, '', b.at, this.plain(b.prey), SEAT[b.prey]!);
        this.note(`Something from ${placeName(this.spaces[b.at]!)} hunted ${this.plain(b.prey)}.`, b.prey, 1.5);
        await this.hud.say(
          b.why === 'loose'
            ? `Whatever lived there breaks loose. It hunts ${this.name(b.prey)}.`
            : `A lair wakes. Something hunts ${this.name(b.prey)}.`,
          'they hunt',
          { tone: 'bad', min: 1500 },
        );
        return;
      }
      case 'hunterStep': {
        const path = [b.to];
        let left = b.left;
        while (this.g.log[this.shown]?.t === 'hunterStep' && (this.g.log[this.shown] as Extract<Beat, { t: 'hunterStep' }>).id === b.id) {
          const nx = this.g.log[this.shown] as Extract<Beat, { t: 'hunterStep' }>;
          path.push(nx.to);
          left = nx.left;
          this.shown++;
        }
        await this.board.stepHunter(b.id, path);
        await this.hud.say(
          left > 0 ? `The hunt closes in: <b>${left}</b> step${left > 1 ? 's' : ''} from ${this.name(b.prey)}.` : `The hunt has caught ${this.name(b.prey)}!`,
          'the hunt closes in',
          { tone: 'bad', min: 1100, tail: 200 },
        );
        return;
      }
      case 'hunterGone':
        this.board.removeHunter(b.id);
        if (b.why === 'stand') return;
        if (b.why === 'light') await this.hud.say('The hunters flee the Last Light.', 'the hunters flee', { min: 900 });
        return;
      case 'encounter': {
        const e = ENCOUNTERS.find((x) => x.id === b.enc)!;
        const f = b.fates[b.pick]!;
        const word = { good: 'BLESSED', bad: 'CURSED', none: 'NOTHING' }[f];
        if (f !== 'none') this.note(`${this.plain(b.seat)} chose ${e.items[b.pick]} at ${e.name}: ${f === 'good' ? e.good : e.bad}`, b.seat, 2);
        // Only YOUR choice opens (the other two stay sealed forever): first the reach, then what was inside.
        const one = `<span class="enc-item enc-${b.pick}"></span><b>${esc(e.items[b.pick]!)}</b>`;
        this.audio.sfx('standoff');
        await bigCard(`<h2>${esc(e.name)}</h2><div class="enc-reveal"><div class="enc-r picked shaking">${one}</div></div><p class="enc-out">${this.name(b.seat)} chooses…</p>`, 1300, 'encounter');
        this.audio.sfx(f === 'good' ? 'win' : f === 'bad' ? 'shatter' : 'standoff');
        await bigCard(
          `<h2>${esc(e.name)}</h2><div class="enc-reveal"><div class="enc-r ${f} picked">${one}</div></div><p class="enc-out ${f}"><b>${word}</b> ${esc(f === 'good' ? e.good : f === 'bad' ? e.bad : e.none)}</p>`,
          2600,
          `encounter ${f}`,
        );
        return;
      }
      case 'cache':
        this.hud.hint('cache');
        this.spaces[b.at]!.content = 'empty';
        this.board.updateSpaces([this.spaces[b.at]!]);
        this.audio.sfx('item');
        if (b.relic) void this.board.gift(b.seat);
        await this.hud.say(
          b.relic
            ? `${this.name(b.seat)} opens the cache: <b class="gold">A RELIC</b> of the old world, for one creature.`
            : `${this.name(b.seat)} opens the cache.`,
          'opens the cache',
          { tone: 'gold' },
        );
        return;
      case 'shrine':
        this.note(`${this.plain(b.seat)} stumbled onto the hidden shrine.`, b.seat, 3);
        await bigCard(
          `<h2>THE HIDDEN SHRINE</h2><p>It wanders. Nobody knows where. ${esc(this.plain(b.seat))} found it.</p>`,
          2400,
          'shrine',
        );
        return;
      case 'bet':
        this.note(`${this.plain(b.seat)} bet a heart and ${b.won ? 'won a Wonder' : 'lost it'}.`, b.seat, 2);
        await this.hud.say(
          b.won
            ? `${this.name(b.seat)} <b class="gold">wins the bet!</b>`
            : `${this.name(b.seat)} <b class="bad">loses the bet.</b>`,
          'the bet',
          { tone: b.won ? 'gold' : 'bad' },
        );
        return;
      case 'boon': {
        const bo = BOON[b.key];
        this.audio.sfx('win');
        if (bo.sacred) this.note(`${this.plain(b.seat)} was blessed by ${bo.name}.`, b.seat, 2);
        await bigCard(
          `<h2 class="${bo.sacred ? 'sacred' : ''}">${esc(bo.name)}</h2><p>${esc(bo.caption)}</p><small>${esc(bo.text)}</small><p class="who">for ${esc(this.plain(b.seat))}</p>`,
          2600,
          `boon${bo.sacred ? ' sacred' : ''}`,
        );
        return;
      }
      case 'boonUsed':
        await this.hud.say(
          `${this.name(b.seat)}: <b class="gold">${esc(BOON[b.key].name)}</b>. ${esc(BOON[b.key].caption)}`,
          BOON[b.key].caption,
          { tone: 'gold' },
        );
        return;
      case 'big': {
        P(b.seat).golden = 'used';
        this.refresh(b.seat);
        const tgt =
          typeof b.target === 'number'
            ? ` on ${this.plain(b.target)}`
            : b.target
              ? ` on ${WORLD[b.target as WorldId].name}`
              : '';
        this.note(`${this.plain(b.seat)} played the golden card: ${BIG[b.effect].name}${tgt}.`, b.seat, 3);
        await bigCard(
          `<h2 class="gold">${esc(BIG[b.effect].name.toUpperCase())}</h2><p>${esc(this.plain(b.seat))}${esc(tgt)}</p>`,
          2000,
          'golden',
        );
        return;
      }
      case 'redirect':
        await this.hud.say(
          `${this.name(b.seat)}: “Not here. Over there.” ${this.name(b.to)} takes it.`,
          'not here over there',
        );
        return;
      case 'fizzle':
        await this.hud.say('Already cursed this round. Twice is rude.', 'already cursed twice is rude');
        return;
      case 'oath':
        this.note(`${this.plain(b.a)} swore an oath against ${this.plain(b.b)}.`, b.a, 2);
        await this.hud.say(
          `${this.name(b.a)} swears an oath against ${this.name(b.b)}. When they meet, the winner takes two.`,
          'swears an oath',
        );
        return;
      case 'tree':
        await this.hud.say(`A wishing tree grows. No clash, no hunger here.`, 'a wishing tree grows', {
          tone: 'gold',
        });
        return;
      case 'mood':
        this.mood = b.mood;
        this.hud.world(b.mood, progress(this.g), TUNE.lastLightAt);
        this.audio.setMood(b.mood === 'frenzy' ? 'storm' : b.mood === 'sated' ? 'calm' : 'hunt');
        this.board.setActive(null);
        this.refresh(null);
        await this.hud.say(
          b.mood === 'hunt'
            ? 'The world hunts.'
            : b.mood === 'frenzy'
              ? 'The world is in a <b class="bad">frenzy</b>.'
              : 'The world is sated. Breathe.',
          b.mood,
          { min: 1000, tail: 200 },
        );
        return;
      case 'flipOmen':
        this.audio.setMood('silent');
        await bigCard(
          `<div class="verse"><p>${(b.n === 1 ? VERSES.flip1 : VERSES.flip2).replaceAll(' / ', '<br>')}</p></div>`,
          2600,
          'flipomen',
        );
        return;
      case 'flip': {
        const f = (await import('../game/v8/cards.ts')).FLIPS.find((x) => x.kind === b.flip)!;
        this.audio.sfx('thunder');
        this.fx.shake(1);
        await bigCard(
          `<h2>${esc(f.name.toUpperCase())}</h2><p class="verse">${f.verse.replaceAll(' / ', '<br>')}</p><small>${esc(f.text)}</small>`,
          3200,
          'flip',
        );
        this.spaces = b.board.map((s) => ({
          ...s,
          adj: [...s.adj],
          seen: this.spaces[s.id]!.seen,
          content: this.spaces[s.id]!.content,
          void: this.spaces[s.id]!.void,
        }));
        if (b.flip === 'rewire') await this.board.rewire(b.petals, this.spaces);
        else {
          this.board.setPetals(b.petals);
          this.board.setBoard(this.spaces);
        }
        this.board.tokensSet(this.tokens());
        for (const p of b.passes) {
          this.pv[p.from]!.creatures--;
          this.pv[p.to]!.creatures++;
        }
        this.refresh(null);
        this.note(`The table flipped: ${f.name}.`, null, 2);
        return;
      }
      case 'finalTurns':
        this.audio.setMood('storm');
        this.note(
          `Final Turns: fate chose ${this.plain(b.seat)}, who took ${BOON[b.boon].name}.`,
          b.seat,
          2,
        );
        await bigCard(
          `<div class="verse"><p>${VERSES.finalTurns.replaceAll(' / ', '<br>')}</p></div><h2>FINAL TURNS</h2><p>Fate draws a name: ${esc(this.plain(b.seat))} is blessed.</p>`,
          3000,
          'final',
        );
        return;
      case 'lastLight':
        this.hud.hint('lastLight');
        this.board.setHeat(1.2);
        await this.board.focus(CENTRE, 1.2, 900);
        this.audio.setMood('storm');
        await bigCard(
          `<h2>THE LAST LIGHT</h2><div class="verse"><p>${VERSES.lastLight.replaceAll(' / ', '<br>')}</p></div><small>The outer worlds will fall. Everyone is drawn to the fire.</small>`,
          3400,
          'lastlight',
        );
        return;
      case 'dim':
        this.audio.setMood('silent');
        for (const p of this.pv) if (!p.out) p.hearts = Math.min(p.hearts, this.g.players[p.seat]!.hearts);
        await bigCard(
          `<h2>THE LIGHT DIMS</h2><p>The survivors meet at the fire. One by one. Sudden death.</p>`,
          3000,
          'lastlight',
        );
        return;
      case 'suddenDeath':
        await this.hud.say('<b class="bad">SUDDEN DEATH.</b> The next clash ends it.', 'sudden death', {
          tone: 'bad',
        });
        return;
      case 'revive':
        this.pv[b.seat]!.out = false;
        this.pv[b.seat]!.hearts = 1;
        this.pv[b.seat]!.creatures = 2;
        this.at[b.seat] = b.at;
        this.board.tokensSet(this.tokens());
        this.refresh(b.seat);
        this.note(`${this.plain(b.seat)} came back from the world. Impossible, and yet.`, b.seat, 3.5);
        await bigCard(
          `<h2>${esc(this.plain(b.seat))} RETURNS</h2><p>The world spits one back. One heart. Two creatures.</p>`,
          2800,
          'revive',
        );
        return;
      case 'escape':
        this.note(`${this.plain(b.seat)} carried three relics into the fire and walked out.`, b.seat, 5);
        await bigCard(
          `<h2>ESCAPE</h2><div class="verse"><p>${VERSES.escape.replaceAll(' / ', '<br>')}</p></div>`,
          3600,
          'escape',
        );
        return;
      case 'win':
        this.audio.sfx('crown');
        if (b.why === 'walkout') {
          this.hud.stand(null, 0, 0, 0);
          this.note(`${this.plain(b.seat)} walked out of the world with ${this.g.players[b.seat]!.deck.length} creatures.`, b.seat, 5);
          await bigCard(
            `<small class="kicker">${esc(this.plain(b.seat))}</small><h2 class="gold">WALKS OUT</h2><div class="verse"><p>${VERSES.escape.replaceAll(' / ', '<br>')}</p></div>`,
            4200,
            'stand',
          );
        }
        return;
      default:
        return this.beat9(b);
    }
  }

  // ── v9 beats: the roll, powers, chance cards, bets, the bomb, curses, trials, stampedes, the world boss ────────────────
  private async beat9(b: Beat): Promise<void> {
    switch (b.t) {
      case 'power': {
        const h = this.g.players[b.seat]!.hero;
        this.powerAt[b.seat] = this.turnsOf[b.seat]! + powerEvery(this.g.players[b.seat]!);
        this.refresh(b.seat);
        this.hud.hint('power');
        this.audio.sfx('item');
        void this.board.gift(b.seat);
        this.note(`${this.plain(b.seat)} used ${h.giftName}.`, b.seat, 1);
        await this.hud.say(
          `${this.name(b.seat)}: <b class="gold">${esc(h.giftName.toUpperCase())}!</b> <small>${esc(h.giftText)}</small>`,
          `${h.giftName} ${h.giftText}`,
          { tone: 'gold', min: 1400 },
        );
        return;
      }
      case 'dice': {
        this.audio.sfx('card');
        const two = b.dice.length > 1;
        const why =
          b.mode === 'moon'
            ? ` <small>Moon Jump: doubled.</small>`
            : b.mode === 'flex'
              ? ` <small>Flex: +3.</small>`
            : b.mode === 'measure'
              ? ` <small>Measured, not rolled.</small>`
              : b.mode === 'lucky'
                ? ` <small>A lucky charm: the higher die.</small>`
                : '';
        const cap = b.cap === 'nap' ? ' <small>Still napping: at most 3.</small>' : b.cap === 'knees' ? ' <small>Bad knees: at most 4.</small>' : b.cap === 'curse' ? ' <small>The Crooked Curse: at most 2.</small>' : '';
        if (this.cursed.delete(b.seat)) this.refresh(b.seat);
        const bonus = b.bonus > 0 ? ` <small>+${b.bonus}: a blessing.</small>` : b.bonus < 0 ? ` <small>${b.bonus}: a curse from beyond.</small>` : '';
        await rollDie(
          b.dice,
          `${this.name(b.seat)} ${two ? 'keeps' : 'moves'} <b class="big">${b.n}</b>${why}${cap}${bonus}`,
          SEAT[b.seat]!,
        );
        this.hud.hint('fork');
        return;
      }
      case 'chance': {
        this.hud.hint('chance');
        this.audio.sfx('flip');
        const c = CHANCE[b.card];
        if (c && (c.kind === 'give' || c.kind === 'bet')) this.note(`${this.plain(b.seat)} drew ${c.name}.`, b.seat, 1);
        await chanceCard(b.card, this.plain(b.seat), SEAT[b.seat]!);
        return;
      }
      case 'news':
        if (b.tone === 'gold') this.audio.sfx('item');
        await this.hud.say(this.names(b.text), this.names(b.text, true), { tone: b.tone, min: 1300 });
        return;
      case 'wager': {
        this.bets.set(b.id, { by: b.by, on: b.on, card: b.card, call: b.call, ...(b.to !== undefined ? { to: b.to } : {}) });
        this.refresh(null);
        this.hud.hint('bet');
        this.audio.sfx('item');
        const c = CHANCE[b.card]!;
        if (b.to !== undefined) {
          const what =
            b.card === 'mirror'
              ? `If ${this.name(b.by)} wins their next battle, ${this.name(b.to)} loses their top creature. If ${this.name(b.by)} loses, ${this.name(b.to)} gains one.`
              : `${this.name(b.by)}'s next battle decides for both: a creature each, or a heart each.`;
          await this.hud.say(`<b class="gold">${esc(c.name)}</b>: ${this.name(b.by)} and ${this.name(b.to)}. ${what}`, `${c.name} ${c.text}`, { tone: 'gold' });
          return;
        }
        if (b.card === 'empty') {
          await this.hud.say(
            `${this.name(b.by)} calls ${this.name(b.on)} to <b class="${b.call === 'win' ? 'good' : 'bad'}">${(b.call ?? 'win').toUpperCase()}</b> their next battle. <small>Right: a creature${b.call === 'lose' ? `, taken from ${esc(this.plain(b.on))}` : ''}. Wrong: a heart.</small>`,
            `${c.name} ${c.text}`,
            { tone: 'gold' },
          );
          return;
        }
        const on = b.on === b.by ? 'their own' : `${this.name(b.on)}'s`;
        const side = ROOTS.has(b.card) ? ` <b class="gold">${this.name(b.by)} needs ${this.name(b.on)} to WIN.</b>` : '';
        const call = b.call ? ` <b class="${b.call === 'win' ? 'good' : 'bad'}">${b.call.toUpperCase()}</b> is the call.` : '';
        await this.hud.say(
          `${this.name(b.by)} bets on ${on} next battle.${call}${side} <small>${esc(c.name)}</small>`,
          `bets on the next battle ${c.text}`,
          { tone: 'gold', min: 1800 },
        );
        return;
      }
      case 'wagerEnd': {
        this.bets.delete(b.id);
        this.refresh(null);
        const c = CHANCE[b.card]!;
        if (b.result === 'void') {
          await this.hud.say(`${esc(c.name)}: no winner. The bet is off.`, 'the bet is off', { min: 1000 });
          return;
        }
        this.audio.sfx(b.result === 'win' ? 'win' : 'shatter');
        this.note(`${this.plain(b.by)} ${b.result === 'win' ? 'won' : 'lost'} ${c.name} on ${this.plain(b.on)}.`, b.by, 1.5);
        await bigCard(
          `<h2 class="${b.result === 'win' ? 'gold' : 'bad'}">${b.result === 'win' ? 'THE BET PAYS' : 'THE BET IS LOST'}</h2><p>${esc(c.name)}: ${esc(this.plain(b.by))} on ${esc(this.plain(b.on))}</p>`,
          1700,
          'wager',
        );
        return;
      }
      case 'wildDraw':
        // v12: the wild has no brain. Its calls are a blind draw, shown as one (fairness the table can see).
        this.audio.sfx('card');
        await this.hud.say(
          `The wild draws its calls blind: <b>${b.calls.filter((c) => c).join(' · ')}</b>`,
          'the wild draws its calls blind',
          { min: 900, tail: 200, quick: true },
        );
        return;
      case 'moment': {
        // v13: one card per moment of luck or nerve (dice tumble first when there are dice). The table turns the page.
        const text = this.names(esc(b.text));
        const title = this.names(esc(b.title));
        if (b.tone === 'gold') this.audio.sfx('item');
        else if (b.tone === 'bad') this.audio.sfx('slam');
        else this.audio.sfx('card');
        if (b.tone === 'bad' && /SNAPS|COLLECTS|MISSED|KEEPS/.test(b.title)) this.fx.shake(0.5);
        if (b.seat !== null && b.tone) this.note(this.names(`${b.kicker}: ${b.title.toLowerCase()}. ${b.text}`, true), b.seat, b.tone === 'gold' ? 2 : 2.5);
        if (b.dice?.length) {
          await rollDie(b.dice, `<small>${esc(b.kicker)}</small> <b class="${b.tone}">${title}</b><br>${text}`, b.seat !== null ? SEAT[b.seat]! : '#ffd36b');
          return;
        }
        const img = b.cid ? `<img class="mo-img" src="${art(b.cid)}" alt="">` : '';
        await bigCard(`<small class="kicker">${esc(b.kicker)}</small>${img}<h2 class="${b.tone}">${title}</h2><p>${text}</p>`, 2600, b.tone === 'gold' ? 'gold' : 'out');
        return;
      }
      case 'cave': {
        const pl = PLACES_V10.cave;
        if (b.fell) {
          this.audio.sfx('slam');
          this.fx.shake(0.9);
          void this.board.disaster(b.seat, '#8a6cff');
          this.note(`The Cave of Echoes came down on ${this.plain(b.seat)}.`, b.seat, 3);
          await bigCard(
            `<small class="kicker">${esc(pl.name)} · STEP ${b.depth + 1}</small><h2 class="bad">THE ROOF COMES DOWN</h2><p>${Math.round(b.risk * 100)}% it would. It did. Everything found is buried, and ${esc(this.plain(b.seat))}'s weakest creature with it.</p>`,
            2400,
            'out',
          );
          return;
        }
        this.audio.sfx('item');
        await this.hud.say(
          `<small>${esc(pl.name)} · STEP ${b.depth + 1}</small> ${this.name(b.seat)} finds <b class="gold">${esc(creature(b.cid!).name)}</b>.`,
          'finds in the cave',
          { tone: 'gold', min: 1000, quick: true },
        );
        return;
      }
      case 'caveOut':
        if (b.kept.length) this.note(`${this.plain(b.seat)} walked out of the Cave of Echoes with ${b.kept.length}.`, b.seat, 2);
        await this.hud.say(
          b.kept.length ? `${this.name(b.seat)} walks out with <b class="gold">${b.kept.length}</b> creature${b.kept.length > 1 ? 's' : ''}.` : `${this.name(b.seat)} walks out with nothing.`,
          'walks out of the cave',
          { tone: b.kept.length ? 'gold' : '', min: 900, quick: true },
        );
        return;
      case 'trust': {
        const word = (x: 'share' | 'take') => `<b class="${x === 'share' ? 'good' : 'bad'}">${x.toUpperCase()}</b>`;
        const both = b.pa === b.pb;
        const verdict =
          both && b.pa === 'share'
            ? 'They trusted each other. A creature each.'
            : both
              ? 'Both reached for it. The bridge snaps: each loses a creature.'
              : `${esc(this.plain(b.pa === 'take' ? b.a : b.b))} takes two. ${esc(this.plain(b.pa === 'take' ? b.b : b.a))} trusted, and loses a creature.`;
        this.audio.sfx(both && b.pa === 'share' ? 'win' : 'shatter');
        if (!both) this.fx.shake(0.6);
        this.note(`The Bridge of Trust: ${this.plain(b.a)} chose ${b.pa}, ${this.plain(b.b)} chose ${b.pb}.`, b.a, both && b.pa === 'share' ? 2 : 4);
        await bigCard(
          `<small class="kicker">${esc(PLACES_V10.trust.name)}</small><div class="trust-row"><div><span style="color:${SEAT[b.a]}">${esc(this.plain(b.a))}</span>${word(b.pa)}</div><div><span style="color:${SEAT[b.b]}">${esc(this.plain(b.b))}</span>${word(b.pb)}</div></div><p>${verdict}</p>`,
          3200,
          both && b.pa === 'share' ? 'gold' : 'out',
        );
        return;
      }
      case 'vendetta':
        if (!this.feuds.some((f) => f.by === b.by && f.on === b.on)) this.feuds.push({ by: b.by, on: b.on });
        this.refresh(null);
        this.hud.hint('feud');
        await this.hud.say(
          `${this.name(b.by)} will remember ${this.name(b.on)}. <small>VENGEANCE: their next duel, the winner takes two.</small>`,
          'vengeance',
          { tone: 'bad', min: 1200 },
        );
        return;
      case 'bounty':
        if (b.claimed === null) {
          this.bounties.set(b.on, b.by);
          this.refresh(null);
          this.audio.sfx('slam');
          await this.hud.say(
            `${this.name(b.by)} puts a price on ${this.name(b.on)}. <b class="bad">WANTED</b>. <small>Whoever beats them in a duel claims a heart.</small>`,
            'wanted',
            { tone: 'bad' },
          );
        } else {
          this.bounties.delete(b.on);
          this.refresh(null);
          this.audio.sfx('crown');
          this.note(`${this.plain(b.claimed)} collected the price on ${this.plain(b.on)}.`, b.claimed, 3);
          await this.hud.say(`${this.name(b.claimed)} collects the price on ${this.name(b.on)}'s head.`, 'collects the price', { tone: 'gold' });
        }
        return;
      case 'bomb': {
        this.bombOn = b.seat;
        this.refresh(null);
        this.hud.hint('bomb');
        if (b.seat === null) return;
        this.audio.sfx('slam');
        await this.board.followSeat(b.seat, 'region');
        void this.board.disaster(b.seat, '#ff3355');
        await this.hud.say(
          b.from === null
            ? `${this.name(b.seat)} now holds the <b class="bad">TICKING BOMB</b>.`
            : `${this.name(b.from)} hands the <b class="bad">TICKING BOMB</b> to ${this.name(b.seat)}. <small>It explodes when round ${b.round + 1} ends.</small>`,
          'hands the ticking bomb',
          { tone: 'bad', min: 1800 },
        );
        return;
      }
      case 'boom':
        this.bombOn = null;
        this.refresh(null);
        this.audio.sfx('ko');
        this.fx.shake(1);
        await this.board.followSeat(b.seat, 'region');
        await this.board.disaster(b.seat, '#ff5a1f');
        this.note(`The bomb went off in ${this.plain(b.seat)}'s hands.`, b.seat, 2);
        await this.hud.say(`<b class="bad">BOOM.</b> The bomb goes off in ${this.name(b.seat)}'s hands.`, 'boom the bomb goes off', {
          tone: 'bad',
          min: 1500,
        });
        return;
      case 'curse':
        this.cursed.add(b.seat);
        this.refresh(null);
        this.audio.sfx('omen');
        await this.hud.say(
          `${this.name(b.by)} lays the <b class="bad">CROOKED CURSE</b> on ${this.name(b.seat)}. <small>Their next roll moves them 2 steps at most.</small>`,
          'lays the crooked curse',
          { tone: 'bad', min: 1600 },
        );
        return;
      case 'trial': {
        const words = b.hits.map((h) => (h === 2 ? 'PERFECT' : h === 1 ? 'GOOD' : 'MISS'));
        await this.hud.say(`${this.name(b.seat)}: ${words.map((w) => `<b class="tr-${w.toLowerCase()}">${w}</b>`).join(' · ')}`, words.join(' '), {
          min: 900,
          tail: 150,
        });
        return;
      }
      case 'stampede': {
        this.audio.sfx('slam');
        this.fx.shake(0.7);
        for (const s of b.seats) void this.board.disaster(s, '#c98a3a');
        await this.hud.say(
          `A <b class="bad">STAMPEDE</b> thunders across <b style="color:${WORLD[b.world].colour}">${WORLD[b.world].name}</b>! ${b.seats.map((s) => this.name(s)).join(', ')}: dodge!`,
          'a stampede thunders dodge',
          { tone: 'bad', min: 1800 },
        );
        return;
      }
      case 'boss': {
        const c = creature(b.cid);
        this.bossName = c.name.split(',')[0]!;
        this.audio.sfx('slam');
        this.audio.grunt('roar');
        this.fx.shake(0.9);
        await this.board.addHunter(999, c.id, b.at, '', '#ff3355', `THE BEAST · ${b.hp}/${b.max}`);
        this.hud.boss(this.bossName, b.hp, b.max);
        this.hud.hint('boss');
        this.note(`${c.name} woke as the beast that hunts the world.`, null, 3, c.id);
        await bigCard(
          `<img class="fallen" src="${art(c.id)}" alt=""><h2 class="bad">THE BEAST WAKES</h2><p><b>${esc(c.name)}</b></p><p class="verse"><i>One health bar for all of you.<br>Whoever lands the last blow keeps it.</i></p><ul class="rules-mini"><li>At the end of every round it rolls its own die and runs at the nearest hero.</li><li>It fights only whoever it stops on, or whoever steps onto it.</li><li>After a fight it rests one round, then hunts someone else.</li></ul>`,
          3400,
          'boss',
        );
        return;
      }
      case 'bossStep': {
        const path = [b.to];
        while (this.g.log[this.shown]?.t === 'bossStep') {
          path.push((this.g.log[this.shown] as Extract<Beat, { t: 'bossStep' }>).to);
          this.shown++;
        }
        this.audio.sfx('step', 0);
        await this.board.stepHunter(999, path);
        return;
      }
      case 'allies':
        this.sworn = b.pairs;
        for (const p of this.g.players) this.refresh(p.seat);
        return;
      case 'bossHunt': {
        // v14 THE HUNT: the beast names its prey and rolls its own die, in front of everyone.
        const was = this.hunted;
        this.hunted = b.prey;
        if (was !== null) this.refresh(was);
        this.refresh(b.prey);
        this.board.setHunterLabel(999, `${this.bossName.toUpperCase()} · HUNTS ${this.plain(b.prey).toUpperCase()}`);
        if (b.rest) {
          await this.hud.say(
            `${esc(this.bossName)} licks its wounds and rests. <small>Next round it hunts ${this.name(b.prey)}.</small>`,
            'the beast rests',
            { tone: '', quick: true },
          );
          return;
        }
        this.audio.grunt('roar');
        await rollDie(
          [b.roll],
          `<small>THE HUNT</small> <b class="bad">${esc(this.bossName)} rolls ${b.roll}</b><br>It runs at ${this.name(b.prey)}.`,
          '#ff5a1f',
        );
        return;
      }
      case 'bossHit': {
        this.hud.boss(this.bossName, b.hp, b.max);
        this.board.setHunterLabel(999, `THE BEAST · ${b.hp}/${b.max}`);
        this.audio.sfx(b.dmg ? 'tame' : 'standoff');
        await this.hud.say(
          b.dmg
            ? `${this.name(b.seat)} wounds the beast: <b class="gold">−${b.dmg}</b>. <small>${b.hp} left.</small>`
            : `${this.name(b.seat)} cannot scratch the beast. <small>${b.hp} left.</small>`,
          'wounds the beast',
          { tone: b.dmg ? 'gold' : 'bad', min: 1500 },
        );
        return;
      }
      case 'content': {
        const sp = this.spaces[b.at]!;
        sp.content = b.content;
        this.board.updateSpaces([sp]);
        return;
      }
      case 'nest': {
        this.hud.hint('nest');
        await rollDie(
          [b.roll],
          b.roll === 6
            ? `${this.name(b.seat)} rolls <b class="big">6</b>. <small>Something hatches, and it follows you.</small>`
            : b.roll === 1
              ? `${this.name(b.seat)} rolls <b class="big">1</b>. <small>The mother is home. She bites.</small>`
              : `${this.name(b.seat)} rolls <b class="big">${b.roll}</b>. <small>An empty nest. Only a 6 hatches.</small>`,
          SEAT[b.seat]!,
        );
        return;
      }
      case 'weather': {
        const land = (w: WorldId | null) => (w ? `<b style="color:${WORLD[w].colour}">${WORLD[w].name}</b>` : '');
        this.hud.weather(
          `${b.storm ? `<span class="wx storm" title="End a turn there and lightning strikes: dodge it or lose a creature">STORM ${land(b.storm)}</span>` : ''}${b.sun ? `<span class="wx sun" title="The world will not eat that land this round, and no stampede crosses it">SUNSHINE ${land(b.sun)}</span>` : ''}`,
        );
        this.hud.hint('weather');
        if (b.storm) for (const p of this.g.players) if (!this.pv[p.seat]!.out && this.spaces[this.at[p.seat]!]?.world === b.storm) void this.board.disaster(p.seat, '#6d8fd8');
        await this.hud.say(
          `The weather turns. ${b.storm ? `A storm over ${land(b.storm)}: end a turn there and lightning strikes.` : ''} ${b.sun ? `Sunshine on ${land(b.sun)}: the world will not eat it this round.` : ''}`,
          'the weather turns a storm sunshine',
          { min: 1500, tail: 200 },
        );
        return;
      }
      case 'attack': {
        const A = ATTACKS[b.world];
        const col = WORLD[b.world].colour;
        this.hud.hint('attack');
        this.audio.sfx('thunder');
        this.fx.shake(0.7);
        await this.board.followSeat(b.seat, 'close');
        void this.board.disaster(b.seat, col);
        await bigCard(
          `<small class="kicker">THE LAND STRIKES · ${esc(this.plain(b.seat))}</small><h2 style="color:${col}">${esc(A.name)}</h2><p class="verse"><i>${esc(A.verse)}</i></p><p>${esc(A.text)}</p><p class="need">The top card of a shuffled deck needs <b>${A.stat} ${b.power}</b> or more.</p>`,
          readMs(`${A.verse} ${A.text}`, 3400),
          'attack',
        );
        if (!b.cid) {
          await this.hud.say(`${this.name(b.seat)} has no creature to stand in the way.`, 'no creature to stand in the way', { tone: 'bad' });
          return;
        }
        const c = creature(b.cid);
        const hair = Math.abs(b.value - b.power) <= 5;
        this.audio.sfx('flip');
        await bigCard(
          `<small class="kicker">THE TOP CARD</small><img class="topcard" src="${art(b.cid)}" alt=""><h2>${esc(c.name.split(',')[0]!)}</h2><p class="duel"><b class="big ${b.ok ? 'good' : 'bad'}">${A.stat} ${b.value}</b> <span>against</span> <b class="big">${b.power}</b></p><p class="${b.ok ? 'good' : 'bad'}"><b>${b.ok ? (hair ? 'STOPPED, BY A HAIR!' : 'STOPPED!') : hair ? 'SO CLOSE. NOT ENOUGH.' : 'TOO WEAK.'}</b> ${b.ok ? 'A creature of this land follows the one who stood firm.' : b.guarded ? 'But something protects it.' : 'The land takes it.'}</p>`,
          3200,
          `attack ${b.ok ? 'good' : 'bad'}`,
        );
        this.audio.sfx(b.ok ? 'win' : 'shatter');
        this.note(`${A.name} struck ${this.plain(b.seat)}: ${c.name.split(',')[0]} ${b.ok ? 'stopped it' : 'was taken'} (${b.value} against ${b.power}).`, b.seat, hair ? 3 : 2, b.cid);
        return;
      }
      case 'hilo': {
        const c = creature(b.cid);
        if (b.step === 0) {
          this.ladder = [{ cid: b.cid, val: b.val }];
          this.hud.hint('hilo');
          await bigCard(
            `<small class="kicker">${esc(this.plain(b.seat))}</small><h2>${esc(PLACES_V10.hilo.name)}</h2><p>${esc(PLACES_V10.hilo.text)}</p>${this.ladderHtml(b.stat)}`,
            3400,
            'hilo',
          );
          return;
        }
        this.ladder.push({ cid: b.cid, val: b.val });
        this.audio.sfx(b.ok ? 'win' : 'shatter');
        const done3 = b.ok && b.step === 3;
        if (!b.ok) this.note(`${this.plain(b.seat)} fell from the Oracle's Ladder on rung ${b.step}.`, b.seat, 1);
        if (done3) this.note(`${this.plain(b.seat)} climbed the Oracle's Ladder and won ${c.name}.`, b.seat, 3, b.cid);
        await bigCard(
          `<h2 class="${b.ok ? 'gold' : 'bad'}">${b.ok ? (done3 ? 'ALL THREE!' : 'RIGHT!') : 'WRONG. THE LADDER BREAKS.'}</h2><p>${esc(this.plain(b.seat))} said <b>${b.guess === 'hi' ? 'HIGHER' : 'LOWER'}</b>.</p>${this.ladderHtml(b.stat)}`,
          2600,
          `hilo ${b.ok ? 'good' : 'bad'}`,
        );
        return;
      }
      case 'altar':
        this.audio.sfx(b.pick === 'walk' ? 'standoff' : 'omen');
        await this.hud.say(
          b.pick === 'creature'
            ? `${this.name(b.seat)} lays their strongest creature on the altar. A heart, in return.`
            : b.pick === 'heart'
              ? `${this.name(b.seat)} offers a heart to the altar. Something rare answers.`
              : `${this.name(b.seat)} walks away from the altar.`,
          'the altar of bargains',
          { tone: b.pick === 'walk' ? '' : 'gold', min: 1800 },
        );
        return;
      case 'trade':
        if (!b.gave || !b.got) {
          await this.hud.say(`${this.name(b.seat)} shakes their head. The Masked Trader shrugs.`, 'walks away from the trader', { min: 1400 });
          return;
        }
        this.audio.sfx('flip');
        this.note(`${this.plain(b.seat)} traded ${creature(b.gave).name.split(',')[0]} blind for ${creature(b.got).name.split(',')[0]}.`, b.seat, creature(b.got).rarity === 'legendary' ? 3 : 1.5, b.got);
        await bigCard(
          `<h2>${esc(PLACES_V10.trader.name)}</h2><div class="fuse"><img src="${art(b.gave)}" alt=""><b>→</b><img src="${art(b.got)}" alt=""></div><p>${esc(creature(b.gave).name.split(',')[0]!)} for… <b class="${creature(b.got).rarity === 'legendary' || creature(b.got).rarity === 'rare' ? 'gold' : ''}">${esc(creature(b.got).name)}</b> <small>(${creature(b.got).rarity})</small></p>`,
          3200,
          'trade',
        );
        return;
      case 'mod': {
        const good = b.v > 0;
        const c = creature(b.cid);
        this.audio.sfx(good ? 'item' : 'omen');
        if (b.by !== null && b.by !== b.seat) this.note(`${this.plain(b.by)} put ${b.name} on ${this.plain(b.seat)}'s ${c.name.split(',')[0]}.`, b.by, 1.5);
        await this.flash(
          b.cid,
          `${b.by !== null && b.by !== b.seat ? `${this.name(b.by)}: ` : ''}<b class="${good ? 'gold' : 'bad'}">${esc(b.name)}</b> on ${this.name(b.seat)}'s ${esc(c.name.split(',')[0]!)}: every stat <b class="${good ? 'gold' : 'bad'}">${good ? '+' : ''}${b.v}</b>.`,
          `${b.name} every stat ${b.v}`,
        );
        return;
      }
      case 'heel': {
        const m = creature(b.mine);
        const t = creature(b.theirs);
        const hair = Math.abs(b.a - b.b) <= 5;
        this.audio.sfx('slam');
        await bigCard(
          `<small class="kicker">THE ACHILLES' HEEL · ${esc(this.plain(b.seat))} strikes ${esc(this.plain(b.on))}</small><div class="fuse"><img src="${art(b.mine)}" alt=""><b>→</b><img src="${art(b.theirs)}" alt=""></div><p>${esc(t.name.split(',')[0]!)} is weakest in <b>${b.stat}</b>.</p><p class="duel"><b class="big ${b.hit ? 'good' : 'bad'}">${esc(m.name.split(',')[0]!)} ${b.a}</b><span>against</span><b class="big">${b.b}</b></p><p class="${b.hit ? 'good' : 'bad'}"><b>${b.hit ? (hair ? 'BY A HAIR: IT LANDS!' : 'IT LANDS!') : 'IT GLANCES OFF.'}</b> ${b.hit ? `${esc(this.plain(b.on))} loses a heart.` : `${esc(this.plain(b.seat))} loses ${esc(m.name.split(',')[0]!)}.`}</p>`,
          3600,
          `attack ${b.hit ? 'good' : 'bad'}`,
        );
        this.note(`${this.plain(b.seat)} struck ${this.plain(b.on)}'s weakness (${b.stat}) and ${b.hit ? 'drew blood' : 'missed'}.`, b.seat, 2.5, b.theirs);
        return;
      }
      case 'door': {
        this.audio.sfx('omen');
        this.fx.shake(0.6);
        await this.board.followSeat(b.seat, 'close');
        await bigCard(
          `<small class="kicker">DEATH'S DOOR</small><h2 class="bad">${esc(this.plain(b.seat))} IS FALLING</h2><p>One roll, once a match. A <b>5</b> or a <b>6</b> and they stay.</p>`,
          2600,
          'out',
        );
        await rollDie(
          [b.roll],
          b.saved
            ? `${this.name(b.seat)} rolls <b class="big">${b.roll}</b>. <b class="gold">BY A HAIR!</b> <small>They stand up, on one heart.</small>`
            : `${this.name(b.seat)} rolls <b class="big">${b.roll}</b>. <small>The door closes.</small>`,
          SEAT[b.seat]!,
        );
        this.note(
          b.saved ? `${this.plain(b.seat)} rolled a ${b.roll} at Death's Door and stood back up.` : `${this.plain(b.seat)} rolled a ${b.roll} at Death's Door.`,
          b.seat,
          b.saved ? 5 : 2,
        );
        if (b.saved) this.audio.sfx('crown');
        return;
      }
      case 'wheel': {
        const act: Record<string, string> = {
          swapHearts: 'SWAPS HEARTS WITH',
          swapDecks: 'SWAPS EVERY CREATURE WITH',
          giveTop: 'GIVES THEIR BEST TO',
          stealHeart: 'STEALS A HEART FROM',
          legend: 'IS GIVEN A LEGEND, AS',
          curseAll: 'IS SPARED WITH',
        };
        const live = this.pv.filter((p) => !p.out);
        const nameCell = (s: number) => ({ html: `<b style="color:${SEAT[s]}">${esc(this.plain(s))}</b>` });
        this.audio.sfx('flip');
        this.hud.hint('wheel');
        await wheelReels(
          [
            { options: live.map((p) => nameCell(p.seat)), final: nameCell(b.a) },
            { options: Object.values(act).map((t) => ({ html: `<i>${t}</i>` })), final: { html: `<i>${act[b.act]}</i>` } },
            { options: live.map((p) => nameCell(p.seat)), final: nameCell(b.b) },
          ],
          'THE WHEEL OF PRALAYA',
          this.plain(b.seat),
          SEAT[b.seat]!,
        );
        this.note(`The Wheel of Pralaya: ${this.plain(b.a)} ${act[b.act]!.toLowerCase()} ${this.plain(b.b)}.`, b.a, 4);
        return;
      }
      case 'swapAll': {
        this.pv[b.a]!.hearts = b.aHearts;
        this.pv[b.b]!.hearts = b.bHearts;
        this.pv[b.a]!.creatures = b.aCount;
        this.pv[b.b]!.creatures = b.bCount;
        if (b.what === 'decks') {
          [this.held[b.a], this.held[b.b]] = [this.held[b.b] ?? [], this.held[b.a] ?? []];
          void this.board.setAlly(b.a, this.held[b.a]!.at(-1) ?? null);
          void this.board.setAlly(b.b, this.held[b.b]!.at(-1) ?? null);
        }
        this.refresh(null);
        this.audio.sfx('swap');
        await this.hud.say(
          b.what === 'hearts'
            ? `${this.name(b.a)} now has <b>${b.aHearts}</b> heart${b.aHearts === 1 ? '' : 's'}; ${this.name(b.b)} has <b>${b.bHearts}</b>.`
            : `${this.name(b.a)} and ${this.name(b.b)} trade every creature they own.`,
          'the wheel swaps',
          { tone: 'gold', min: 1800 },
        );
        return;
      }
      case 'bloodMoon':
        this.bloodOn = b.on;
        this.hud.blood(b.on);
        if (!b.on) return;
        this.hud.hint('blood');
        this.audio.sfx('thunder');
        this.audio.setMood('storm');
        await bigCard(
          `<small class="kicker">THIS ROUND</small><h2 class="bad">BLOOD MOON</h2><p class="verse"><i>The moon turns red, the stakes turn twice:<br>win, and take two; lose, and pay the price.</i></p><p>Every battle this round counts double. The winner takes <b>two</b> creatures.</p>`,
          4200,
          'out',
        );
        return;
      case 'die':
        await rollDie([b.roll], b.roll === 6 ? `${this.name(b.seat)} rolls <b class="big">6</b>. <small>A legend answers.</small>` : b.roll === 1 ? `${this.name(b.seat)} rolls <b class="big">1</b>. <small>Blood.</small>` : `${this.name(b.seat)} rolls <b class="big">${b.roll}</b>. <small>Nothing. This time.</small>`, SEAT[b.seat]!);
        return;
      case 'rope':
        this.audio.sfx('item');
        this.note(`${this.plain(b.a)} tied a rope to ${this.plain(b.b)}.`, b.a, 1);
        await this.hud.say(
          `${this.name(b.a)} ties a rope to ${this.name(b.b)}. <small>Through ${esc(this.plain(b.a))}'s next turn, when one loses a creature, so does the other.</small>`,
          'bound by rope when one falls so does the other',
          { tone: 'gold', min: 2200 },
        );
        return;
      case 'stand': {
        this.hud.stand(this.plain(b.seat), b.have, b.need, b.left);
        // The world goes quiet for the last one: no boss, no bomb, no bets on the plates.
        this.hud.boss(null);
        this.board.removeHunter(999);
        this.bombOn = null;
        this.bets.clear();
        this.refresh(null);
        if (!b.start) {
          await this.hud.say(
            `${this.name(b.seat)} holds <b class="${b.have >= b.need ? 'gold' : 'bad'}">${b.have} of ${b.need}</b> creatures. <b>${b.left}</b> turn${b.left > 1 ? 's' : ''} left to walk out.`,
            'the last stand turns left',
            { min: 1800 },
          );
          return;
        }
        this.audio.setMood('storm');
        this.audio.anthem(true);
        this.hud.hint('stand');
        this.note(`${this.plain(b.seat)} was the last one standing, with ${b.have} creatures. The Last Stand began.`, b.seat, 4);
        await bigCard(
          `<small class="kicker">THE LAST ONE STANDING</small><h2 class="gold">THE LAST STAND</h2><p>${esc(this.plain(b.seat))} is alive. But this world only lets you out with <b>${b.need} creatures</b>. They hold <b>${b.have}</b>.</p><p><b>${b.left} turns</b> to find the rest. Before every turn, each fallen player lays a trap.</p><p class="verse"><i>The door is near, the door is narrow. Fill your hands, or feed the marrow.</i></p><small>Fail, or fall, and the fallen win together.</small>`,
          7000,
          'stand',
        );
        return;
      }
      case 'trap':
        this.traps.add(b.at);
        this.board.setTraps([...this.traps]);
        this.audio.sfx('slam');
        await this.hud.say(`${this.name(b.by)} lays a trap at <b>${esc(placeName(this.spaces[b.at]!))}</b>.`, 'lays a trap', { min: 1200, tail: 200 });
        return;
      case 'trapSprung':
        this.traps.delete(b.at);
        this.board.setTraps([...this.traps]);
        this.note(`${this.plain(b.seat)} walked into ${this.plain(b.by)}'s trap.`, b.by, 2.5);
        return;
      case 'worldWins':
        this.hud.stand(null, 0, 0, 0);
        this.audio.sfx('ko');
        this.fx.shake(1);
        this.note(`${this.plain(b.seat)} could not walk out. The world kept them, and the fallen won.`, null, 6);
        await bigCard(
          `<h2 class="bad">THE WORLD KEEPS THEM</h2><p>${esc(this.plain(b.seat))} never found the way out.</p><p>The fallen win together: <b>${b.seats.map((s) => esc(this.plain(s))).join(', ')}</b>.</p>`,
          5000,
          'out',
        );
        return;
      case 'bossDown': {
        this.hud.boss(null);
        if (this.hunted !== null) {
          const was = this.hunted;
          this.hunted = null;
          this.refresh(was);
        }
        this.board.removeHunter(999);
        this.audio.sfx('crown');
        this.fx.shake(1);
        this.note(`${this.plain(b.seat)} landed the last hit on ${creature(b.cid).name}.`, b.seat, 5, b.cid);
        await bigCard(
          `<img class="fallen" src="${art(b.cid)}" alt=""><h2 class="gold">THE BEAST FALLS</h2><p>${esc(this.plain(b.seat))} lands the last hit.</p>`,
          3000,
          'boss',
        );
        return;
      }
    }
  }


  private async flash(cid: string, html: string, plain: string): Promise<void> {
    const c = cardEl(cid);
    c.classList.add('flash');
    this.root.append(c);
    setTimeout(() => c.remove(), 1700);
    await this.hud.say(html, plain, { min: 1300, tail: 200, tone: 'gold' });
  }

  private async emerge(b: Extract<Beat, { t: 'emerge' }>): Promise<void> {
    this.hud.hintOff();
    this.emerging = { team: b.team, at: b.at, seat: b.seat, vs: b.source === 'rival' ? b.by : null };
    await this.board.focus(b.at, 1.4, 500);
    this.audio.setMood('hunt');
    if (b.law) this.hud.hint('law');
    if (b.source === 'rival' && b.by !== null) {
      this.audio.sfx('slam');
      await this.stage.emerge(
        [],
        b.law,
        `${this.name(b.seat)} <span>meets</span> ${this.name(b.by)}`,
        false,
        this.spaces[b.at]?.world ?? null,
      );
      await this.hud.say(
        `${this.name(b.seat)} meets ${this.name(b.by)}. Only one walks away whole.`,
        'meets only one walks away whole',
        { min: 1600 },
      );
      return;
    }
    const lead = creature(b.team[0]!);
    const intro: Record<Extract<Beat, { t: 'emerge' }>['source'], string> = {
      lair: 'Something lives here…',
      unleash: `${b.by !== null ? this.plain(b.by) : 'Someone'} sends a welcome party.`,
      ambush: 'The world sends its beasts.',
      spirit: 'A Spirit guides the beasts.',
      riddle: 'The roaring door opens.',
      stampede: `${b.by !== null ? this.plain(b.by) : 'Someone'} plays the golden card: STAMPEDE.`,
      hunter: 'The hunters caught up!',
      boss: 'The beast is on you! Every lane you win wounds it. Win, and it rests.',
      rival: '',
      tame: 'A lone beast. Beat it one on one and it follows you.',
      trap: `${b.by !== null ? this.plain(b.by) : 'A spirit'}'s trap springs!`,
    };
    // v10 (owner: "zero idea… saamne wale ka kuch na pata ho"): the wild burst out as shapes in the smoke, nameless and silent.
    const dark = true;
    await this.hud.say(esc(intro[b.source]!), intro[b.source]!, { min: 900, tail: 100 });
    this.hud.hint('emerge');
    await this.stage.emerge(
      b.team,
      b.law,
      `<small>${esc(placeName(this.spaces[b.at]!))}</small><b>${b.team.length}</b> shape${b.team.length > 1 ? 's' : ''} in the smoke`,
      dark,
      this.spaces[b.at]?.world ?? null,
    );
    if (!dark)
      await this.hud.say(`<b>${esc(lead.name)}</b>: “${esc(lead.line)}”`, lead.line, {
        min: 1600,
        tail: 300,
      });
  }

  // ── Asks ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private async answer(a: Ask): Promise<Answer> {
    const p = this.g.players[a.seat]!;
    switch (a.k) {
      case 'fate': {
        const sets = a.cards.map((f: Fate, i: number) => ({
          ends: reach(this.g, p, f),
          colour: TRAIL[i]!,
          label: String(i + 1),
        }));
        this.board.trails(sets.filter((s, i) => a.cards[i]!.fx.k === 'move'));
        const opts: Option[] = a.cards.map((f, i) => ({
          html: `<span class="fate-kind ${f.kind}" style="--tc:${TRAIL[i]}">${f.kind}</span><b>${esc(f.text)}</b><small>${esc(f.how)}</small>`,
          label: f.text,
          cls: 'fatecard',
        }));
        if (a.golden)
          opts.push({
            html: '<span class="fate-kind golden">golden</span><b>Play the golden card</b><small>Your big moment, instead of moving</small>',
            label: 'golden',
            cls: 'fatecard golden',
          });
        const i = await choose(opts, {
          title: `${this.name(a.seat)}, choose your fate`,
          sub: 'Coloured rings on the board: where each card can take you.',
          timer: 15,
          cls: 'fates',
        });
        this.board.clearTrails();
        return i === a.cards.length ? { k: 'playGolden' } : { k: 'fate', index: i };
      }
      case 'steps': {
        const g = p.hero.gift;
        const i = await choose(
          a.options.map((n) => ({
            html: `<span class="die mini">${n}</span><small>step${n > 1 ? 's' : ''}</small>`,
            label: `${n} steps`,
          })),
          {
            title: g === 'measure' ? `${this.name(a.seat)}: measure it. Choose your roll.` : g === 'twoDice' ? `${this.name(a.seat)}: you saw it coming. Keep which die?` : 'How far?',
            def: a.options.length - 1,
            timer: 12,
          },
        );
        return { k: 'steps', n: a.options[i]! };
      }
      case 'fork': {
        const mover = a.mover === a.seat ? '' : ` (for ${esc(this.plain(a.mover))})`;
        this.hud.hint('fork');
        const to = await this.pickSpace(
          a.options,
          `${this.name(a.seat)}: a fork${mover}. ${a.left} step${a.left > 1 ? 's' : ''} left.`,
          8,
        );
        return { k: 'fork', to };
      }
      case 'target': {
        const titles: Record<import('../game/v8/rules.ts').TargetWhy | 'stampede' | 'exile' | 'plunder', string> = {
          unleash: 'Who gets the welcome party?',
          swap: 'Swap places with whom?',
          parrot: 'Settle it with whom?',
          stampede: 'Who does the stampede chase?',
          exile: 'Swap places with whom?',
          plunder: 'Take the top creature of whom?',
          spirit: 'Spirit: whom should the world strike?',
          oath: 'Name your rival.',
          redirect: 'Pass the curse to whom?',
          bomb: 'Hand the ticking bomb to whom?',
          curse: 'Who gets the Crooked Curse?',
          scent: 'Whom should the beasts hunt?',
          kingFrom: 'Kingmaker: whose top creature is given away?',
          kingTo: 'Kingmaker: and who receives it?',
          toll: 'The Toll: who pays with their top creature?',
          chalice: 'Your top creature goes to whom?',
          gift: 'You must give the rare creature to whom?',
          heartTax: 'The Heart Tax: who receives it?',
          duel: 'Challenge whom?',
          arenaA: 'Arena of the Gods: the first fighter?',
          arenaB: 'Arena of the Gods: and their opponent?',
          quick: 'Quick Draw: against whom?',
          prophet: 'The Prophet: whose fate will you call?',
          empty: 'The Empty-Handed Wager: whose next battle will you call?',
          mirror: 'The Mirror: who feels your next battle?',
          pact: 'The Blood Pact: whose blood joins yours?',
          bounty: 'Wanted: whose head carries the price?',
          trust: 'The Bridge of Trust: who holds the other end?',
          whistle: 'The beast hunts whom?',
          pickpocket: 'The Pickpocket: whose pocket?',
          ring: 'The Challenge Ring: who is called in?',
          anchor: 'The Dark Pact: whose battle do you chain yourself to?',
          chest: "The Liar's Chest: who is offered the chest?",
          bss: 'Blade, Shield, Spell: against whom?',
          haunt: 'The Fallen Whisper: to whom do you whisper?',
          ally: 'The Oath Stone: whom do you offer your hand?',
          hitch: 'Hitch a ride on whose battle?',
          cutCrown: 'Cut the Crown: bet against whom?',
          devil: "The Devil's Bargain: whose fate is tied to yours?",
          ransom: "The King's Ransom: whose champion is at stake?",
          robinA: 'Robin of the Woods: who gives?',
          robinB: 'Robin of the Woods: and who receives?',
          underdog: "The Underdog's Hour: swap champions with whom?",
          double: 'Double or Nothing: steal from whom?',
          lions: 'Release the lions on whom?',
          swapAny: 'Swap places with whom?',
          jar: 'Jar a creature from whom?',
          switch: 'Bait and switch with whom?',
          slipper: 'Who gets the slipper?',
          hexGive: 'The Cursed Idol: whose top creature takes the hex?',
          relicGive: "The Dragon's Hoard: whose top creature gets the relic?",
          rope: 'Bound by Rope: tie yourself to whom?',
          heel: "The Achilles' Heel: whose weakness do you strike?",
          bloodPrice: 'The Blood Price: whose heart do you take?',
          sinking: 'The Sinking Ship: who goes down with you?',
          feast: 'The Feast: who dines with you?',
        };
        const i = await choose(
          a.options.map((s) => ({
            html: `<img class="mini" src="${art(this.g.players[s]!.hero.id)}" alt=""><b style="color:${SEAT[s]}">${esc(this.plain(s))}</b><small>${this.pv[s]!.hearts} heart${this.pv[s]!.hearts === 1 ? '' : 's'} · ${this.pv[s]!.creatures} creatures</small>`,
            label: this.plain(s),
          })),
          // v14: a timed-out pick falls by lot, never on the lowest seat.
          { title: `${this.name(a.seat)}: ${titles[a.why]}`, timer: 15, def: Math.floor(Math.random() * a.options.length) },
        );
        return { k: 'target', seat: a.options[i]! };
      }
      case 'world': {
        const titles = {
          portal: 'Which world?',
          swallow: 'Which world falls?',
          sky: 'Point at a world. It is eaten next.',
          merchant: 'Which world is eaten next?',
        };
        const i = await choose(
          a.options.map((w) => ({
            html: `<b style="color:${WORLD[w].colour}">${WORLD[w].name}</b>`,
            label: WORLD[w].name,
          })),
          { title: `${this.name(a.seat)}: ${titles[a.why]}`, timer: 15 },
        );
        return { k: 'world', world: a.options[i]! };
      }
      case 'space': {
        if (a.why === 'roll') this.hud.hint('dest');
        if (a.why === 'trap') this.hud.hint('trap');
        if (a.why === 'heart') this.hud.hint('heart');
        const title =
          a.why === 'roll'
            ? `${this.name(a.seat)}: <b>${a.n}</b> steps. Every glowing place is yours to choose. Where do you go?`
            : a.why === 'trap'
              ? `${this.name(a.seat)}, spirit: lay a trap. Where will the survivor walk?`
              : a.why === 'heart'
                ? `${this.name(a.seat)}: the Burning Heart throws you anywhere. Name the place.`
                : `${this.name(a.seat)}: where to?`;
        const opts = a.why === 'roll' ? a.options.slice(0, 40) : a.options;
        const tags = new Map<number, { text: string; colour: string }>();
        if (a.why === 'roll')
          for (const id of opts) {
            const here = this.g.players.filter((q) => !q.out && q.seat !== a.seat && this.at[q.seat] === id);
            if (here.length) {
              const q = here[0]!;
              tags.set(id, { text: q.hearts === 1 ? `DUEL · ${q.name} · LAST HEART` : `DUEL · ${q.name}`, colour: SEAT[q.seat]! });
            } else if (this.g.boss && this.g.boss.at === id) tags.set(id, { text: 'THE BOSS', colour: '#ff5a1f' });
            else if (this.g.hunters.some((h) => h.at === id)) tags.set(id, { text: 'HUNTERS', colour: '#ff5a1f' });
            else if (this.g.boss) {
              // v14 THE HUNT: how close the beast would be (it runs one die a round), so dodging it is a real choice.
              const d = distance(this.g.board, id, this.g.boss.at);
              if (d <= 6) tags.set(id, { text: `BEAST ${d} AWAY`, colour: '#ff8a3d' });
            }
          }
        const at = await this.pickSpace(opts, title, a.why === 'roll' ? 25 : 20, tags);
        return { k: 'space', at };
      }
      case 'golden': {
        const i = await choose(
          a.effects.map((e) => ({
            html: `<b>${BIG[e].name}</b><small>${BIG[e].rule}</small>`,
            label: BIG[e].name,
            cls: 'golden',
          })),
          { title: `${this.name(a.seat)}: your big moment`, sub: 'Once a match. Make it count.', timer: 20 },
        );
        return { k: 'golden', effect: a.effects[i]! };
      }
      case 'team': {
        await this.ensureStage(a);
        this.teamOwned.set(a.seat, a.drawn);
        let close: (() => void) | null = null;
        if (a.secret) {
          const mover = this.turnSeat >= 0 && this.turnSeat !== a.seat ? this.plain(this.turnSeat) : null;
          close = await cover(
            this.plain(a.seat),
            SEAT[a.seat]!,
            mover && a.vs === this.turnSeat
              ? `${mover} landed on you: a duel. Set your fighters. This is still ${mover}'s turn; yours comes after.`
              : `Set your fighters against ${a.vs !== null ? this.plain(a.vs) : 'your rival'}.`,
          );
        }
        this.hud.hint('team');
        if (a.canBet) this.hud.hint('bet');
        const ans = await this.stage.askTeam(a, this.plain(a.seat));
        close?.();
        return ans;
      }
      case 'roll': {
        this.hud.hint('roll');
        const h = p.hero;
        const opts: Option[] = [
          { html: '<span class="die mini">?</span><b>Roll the die</b><small>Then choose where you go</small>', label: 'roll' },
          {
            html: `<span class="fate-kind power">power</span><b>${esc(h.giftName)}</b><small>${a.ready === 0 ? esc(h.giftText) : `Ready in ${a.ready} turn${a.ready > 1 ? 's' : ''}`}</small>`,
            label: h.giftName,
            cls: 'fatecard',
            disabled: a.ready > 0,
          },
        ];
        if (a.golden)
          opts.push({
            html: '<span class="fate-kind golden">golden</span><b>Play the golden card</b><small>Your big moment, instead of moving</small>',
            label: 'golden',
            cls: 'fatecard golden',
          });
        const i = await choose(opts, {
          title: `${this.name(a.seat)}, your move`,
          sub: a.ready === 0 ? `Your power is ready. Use it before you roll, or save it.` : undefined,
          timer: 20,
          cls: 'fates',
        });
        return { k: 'roll', use: i === 1 ? 'power' : i === 2 ? 'golden' : 'roll' };
      }
      case 'predict': {
        const i = await choose(
          [
            { html: '<b class="good">WIN</b><small>They win their next battle</small>', label: 'win' },
            { html: '<b class="bad">LOSE</b><small>They lose their next battle</small>', label: 'lose' },
          ],
          { title: `${this.name(a.seat)}: will ${this.name(a.on)} win or lose their next battle?`, timer: 15, def: Math.random() < 0.5 ? 0 : 1 },
        );
        return { k: 'yes', yes: i === 0 };
      }
      case 'pick': {
        if (a.why === 'trust') {
          const vs = a.vs ?? 0;
          const close = await cover(this.plain(a.seat), SEAT[a.seat]!, `The Bridge of Trust with ${this.plain(vs)}. Choose in secret.`);
          const i = await choose(
            [
              { html: '<b class="good">SHARE</b><small>If they share too: a creature each. If they take: you lose a creature.</small>', label: 'share' },
              { html: '<b class="bad">TAKE</b><small>If they share: two creatures for you, one lost by them. If they take too: you each lose one.</small>', label: 'take' },
            ],
            { title: `${this.name(a.seat)}: share or take?`, sub: `${esc(this.plain(vs))} is choosing too. Nobody sees your choice until both are made.`, timer: 25, def: 0 },
          );
          close();
          return { k: 'pick', i };
        }
        const head =
          a.why === 'altar'
            ? { title: `${this.name(a.seat)}: ${PLACES_V10.altar.name}`, sub: 'Every gift here has a price.' }
            : a.why === 'trader'
              ? { title: `${this.name(a.seat)}: ${PLACES_V10.trader.name}`, sub: 'One of yours, for one you cannot see. A common, or a legend.' }
              : a.why === 'ransom'
                ? { title: `${this.name(a.seat)}: The King's Ransom`, sub: 'There is no free choice here. Only a price.' }
                : a.why === 'devil'
                  ? { title: `${this.name(a.seat)}: The Devil's Bargain`, sub: 'Help yourself and feed the leader, or bleed to bring them down.' }
              : { title: `${this.name(a.seat)}: the Poisoned Chalice`, sub: 'One of these will happen. You choose which.' };
        const i = await choose(
          a.options.map((t) => ({ html: `<b>${this.names(esc(t))}</b>`, label: this.names(t, true) })),
          { ...head, timer: 20, def: a.why === 'devil' ? 0 : a.options.length - 1 },
        );
        return { k: 'pick', i };
      }
      case 'choice': {
        let close: (() => void) | null = null;
        if (a.secret) close = await cover(this.plain(a.seat), SEAT[a.seat]!, a.title);
        const i = await choose(
          a.options.map((t) => ({ html: `<b>${esc(t)}</b>`, label: t })),
          { title: `${this.name(a.seat)}: ${esc(a.title)}`, sub: this.names(esc(a.sub)), timer: 20, def: a.def },
        );
        close?.();
        return { k: 'pick', i };
      }
      case 'deeper': {
        this.hud.hint('cave');
        const i = await choose(
          [
            { html: `<b class="bad">GO DEEPER</b><small>${Math.round(a.risk * 100)}% the roof comes down</small>`, label: 'deeper' },
            { html: `<b class="good">WALK OUT</b><small>Keep ${a.found.length} creature${a.found.length > 1 ? 's' : ''}</small>`, label: 'walk out' },
          ],
          {
            title: `${this.name(a.seat)}: ${a.found.length} found. Deeper?`,
            sub: a.found.map((cid) => esc(creature(cid).name.split(',')[0]!)).join(' · '),
            timer: 20,
            def: 1,
          },
        );
        return { k: 'yes', yes: i === 0 };
      }
      case 'hilo': {
        this.hud.hint('hilo');
        const c = creature(a.cid);
        const body = document.createElement('div');
        body.className = 'hilo-ask';
        body.innerHTML = `<img src="${art(a.cid)}" alt=""><div><small>${esc(c.name.split(',')[0]!)}</small><b class="big">${a.stat} ${a.val}</b><small>Rung ${a.step} of 3</small></div>`;
        const i = await choose(
          [
            { html: '<b class="good">HIGHER</b><small>The next card beats it (or ties)</small>', label: 'higher' },
            { html: '<b class="bad">LOWER</b><small>The next card is below it (or ties)</small>', label: 'lower' },
          ],
          { title: `${this.name(a.seat)}: higher or lower than <b>${a.val}</b>?`, sub: `${a.stat} runs from about 10 to 99.`, body, timer: 20, def: a.val < 55 ? 0 : 1 },
        );
        return { k: 'yes', yes: i === 0 };
      }
      case 'trial': {
        this.hud.hint('trial');
        const title =
          a.card === 'stampedeWorld' ? 'Stampede! Dodge!' : a.card === 'lightning' ? 'Lightning! Dodge!' : (CHANCE[a.card]?.name ?? 'The Trial');
        const hits = await trialRing(title, this.plain(a.seat), SEAT[a.seat]!, a.n);
        return { k: 'trial', hits };
      }
      case 'strike': {
        this.hud.hint('strike');
        const hits = await this.stage.askStrike(a.side, a.lanes, this.plain(a.seat));
        return { k: 'strike', hits };
      }
      case 'move': {
        this.hud.hint('move');
        return this.stage.askMove(a, this.teamOwned.get(a.seat) ?? []);
      }
      case 'encounter': {
        // Three that look alike: the stakes are read aloud first, then you choose (pure luck, everyone watching).
        const e = a.enc;
        const i = await choose(
          e.items.map((it, k) => ({
            html: `<span class="enc-item enc-${k}"></span><b>${esc(it)}</b>`,
            label: it,
            cls: 'enc',
          })),
          { title: esc(e.name), sub: `<i>“${esc(e.verse)}”</i> ${this.name(a.seat)} must choose.`, timer: 15, cls: 'encounter' },
        );
        return { k: 'encounter', pick: i };
      }
      case 'riddle': {
        this.hud.hint('riddle');
        const body = document.createElement('div');
        body.className = 'verse';
        body.innerHTML = `<p>${esc(a.riddle.verse).replaceAll(' / ', '<br>')}</p>`;
        const i = await choose(
          [
            { html: `<b>${esc(a.riddle.a)}</b>`, label: a.riddle.a, cls: 'door' },
            { html: `<b>${esc(a.riddle.b)}</b>`, label: a.riddle.b, cls: 'door' },
          ],
          {
            title: `${esc(a.riddle.name)}`,
            sub: `${this.name(a.seat)} must choose`,
            body,
            def: 1,
            timer: 15,
            cls: 'riddle',
          },
        );
        return { k: 'riddle', pick: i === 0 ? 'a' : 'b' };
      }
      case 'release': {
        const body = document.createElement('div');
        body.className = 'cards';
        const i = await choose(
          a.deck.map((o) => ({
            html: cardEl(o.cid, { owned: o, small: true }).outerHTML,
            label: creature(o.cid).name,
            cls: 'cardopt',
          })),
          {
            title:
              a.why === 'fee'
                ? `${this.name(a.seat)}: which creature pays?`
                : a.why === 'trade'
                  ? `${this.name(a.seat)}: which creature goes to the Masked Trader?`
                  : a.why === 'equip'
                    ? `${this.name(a.seat)}: who carries ${esc(a.relic ?? 'the relic')}? Every stat rises.`
                    : `${this.name(a.seat)}: too many creatures. Release one.`,
            def: a.why === 'equip' ? this.strongestIndex(a.deck) : this.weakestIndex(a.deck),
            timer: 15,
            cls: 'wide',
          },
        );
        void body;
        return { k: 'release', uid: a.deck[i]!.uid };
      }
      case 'fuse': {
        const opts = a.deck.map((o) => ({
          html: cardEl(o.cid, { owned: o, small: true }).outerHTML,
          label: creature(o.cid).name,
          cls: 'cardopt',
        }));
        const x = await choose(opts, { title: 'Fuse: the first creature', timer: 15, cls: 'wide' });
        const rest = a.deck.filter((_, i) => i !== x);
        const y = await choose(
          rest.map((o) => ({
            html: cardEl(o.cid, { owned: o, small: true }).outerHTML,
            label: creature(o.cid).name,
            cls: 'cardopt',
          })),
          { title: 'Fuse: the second creature', timer: 15, cls: 'wide' },
        );
        return { k: 'fuse', a: a.deck[x]!.uid, b: rest[y]!.uid };
      }
      case 'boon': {
        const i = await choose(
          a.options.map((k) => ({
            html: `<b>${esc(BOON[k].name)}</b><small>${esc(BOON[k].text)}</small>`,
            label: BOON[k].name,
            cls: 'sacred',
          })),
          { title: `${this.name(a.seat)}: the last may yet take all`, sub: 'Choose a blessing.', timer: 20 },
        );
        return { k: 'boon', key: a.options[i]! };
      }
      case 'wish': {
        const picks = ['heart', 'creature', 'rest'] as const;
        const i = await choose(
          [
            { html: '<b>A heart</b>', label: 'heart' },
            { html: '<b>The finest creature of this world</b>', label: 'creature' },
            { html: '<b>Rest: +2 on your next roll</b>', label: 'rest' },
          ],
          { title: 'Kamadhenu grants one wish', timer: 15 },
        );
        return { k: 'wish', pick: picks[i]! };
      }
      case 'doom': {
        const label = (ids: number[]) => {
          const w = this.g.board[ids[0]!]?.world;
          return w ? `${WORLD[w].name} (${ids.length})` : `${ids.length} spaces`;
        };
        const i = await choose(
          a.options.map((o) => ({ html: `<b>${label(o)}</b>`, label: label(o) })),
          { title: `${this.name(a.seat)}, Spirit: what does the world eat next?`, timer: 10 },
        );
        return { k: 'doom', index: i };
      }
      case 'stop': {
        const i = await choose(
          [
            { html: '<b>Sit down and eat</b><small>Stop them here</small>', label: 'stop' },
            { html: '<b>Let them pass</b>', label: 'pass' },
          ],
          { title: `${this.name(a.seat)}: ${this.name(a.mover)} passes by.`, timer: 8, def: 1 },
        );
        return { k: 'yes', yes: i === 0 };
      }
      case 'pull': {
        const i = await choose(
          [
            { html: '<b>Challenge the Ringmaster</b>', label: 'challenge' },
            { html: '<b>Land as normal</b>', label: 'land' },
          ],
          { title: `${this.name(a.seat)}: the show must go on?`, timer: 8, def: 1 },
        );
        return { k: 'yes', yes: i === 0 };
      }
    }
  }

  private strongestIndex(deck: { cid: string }[]): number {
    let w = 0;
    deck.forEach((o, i) => {
      if (creature(o.cid).power > creature(deck[w]!.cid).power) w = i;
    });
    return w;
  }
  private weakestIndex(deck: { cid: string }[]): number {
    let w = 0;
    deck.forEach((o, i) => {
      if (creature(o.cid).power < creature(deck[w]!.cid).power) w = i;
    });
    return w;
  }

  private async ensureStage(a: Extract<Ask, { k: 'team' }>): Promise<void> {
    if (this.stage.open) return;
    // A clash asked without an emerge on screen yet (should not happen: emerge always precedes).
    await this.catchUp();
    void a;
  }

  private pickSpace(options: number[], title: string, timer: number, tags?: Map<number, { text: string; colour: string }>): Promise<number> {
    return new Promise((done) => {
      void this.hud.say(title, 'choose a space', { min: 300, tail: 0, prompt: true });
      let ended = false;
      const end = (id: number) => {
        if (ended) return;
        ended = true;
        clearTimeout(t);
        removeEventListener('keydown', key);
        off();
        this.hud.clear();
        done(id);
      };
      const off = this.board.pick(options, end, tags);
      const key = (e: KeyboardEvent) => {
        const n = Number(e.key);
        if (n >= 1 && n <= Math.min(9, options.length)) end(options[n - 1]!);
        else if (e.code === 'Enter') end(options[0]!);
      };
      addEventListener('keydown', key);
      const t = setTimeout(() => end(options[0]!), (timer * 1000) / clock.speed);
      if (auto.on) setTimeout(() => end(options[Math.floor(Math.random() * options.length)]!), 600 / clock.speed);
    });
  }

  /** Close the stage when a clash's consequences are told. */
  async afterClash(): Promise<void> {
    await this.stage.close();
    await wait(100);
    void alive;
  }
}
