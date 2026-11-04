/**
 * The arena (feel-v8 verdicts 9–15): a clash is a different stage, not a popup. The camera dives from the map into a side view
 * painted from the land you stand in; your three on the left, theirs on the right, one row per lane (far to near). Three small
 * fights, played one at a time: the lane in focus is lit, the others dim; wind-up → lunge → impact (hit-stop, flash, knockback,
 * sparks) → recovery. Shake only on the deciding blow. Cutouts breathe from the feet. Pure presentation: the rules decided.
 */
import { Assets, BlurFilter, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { gsap } from 'gsap';
import { creature } from '../../game/v8/rules.ts';
import { formOf, statsOf } from '../../game/v8/stats.ts';
const creatureStats = (cid: string) => statsOf(creature(cid));
import type { Move, WorldId } from '../../game/v8/types.ts';
import { REDUCED, clock } from '../../play/anim.ts';
import { FORM_LOOK, art } from '../look.ts';
import { MOVE, TYPE } from '../text.ts';
import { Sparks, addTrauma, app, done, hitStop, puff, softDot, streak } from './gfx.ts';

const hex = (c: string): number => Number.parseInt(c.replace('#', ''), 16);
type Side = 'me' | 'foe';

interface Fighter {
  c: Container;
  body: Container;
  sprite: Sprite;
  flash: Sprite;
  shadow: Graphics;
  cid: string;
  breath: gsap.core.Tween | null;
  /** The plate's number (hidden as '?' until the stat is called and revealed) and its label. */
  val: Text | null;
  tag: Text | null;
}

export class Arena {
  private root = new Container();
  private back = new Container();
  private ground = new Graphics();
  private cast = new Container();
  private sparks: Sparks;
  private dust: Sparks;
  private labels = new Container();
  private fighters: Record<Side, (Fighter | null)[]> = { me: [null, null, null], foe: [null, null, null] };
  private huddle: Fighter[] = [];
  private tex = new Map<string, Texture>();
  private isOpen = false;
  private dark = false;

  constructor() {
    this.sparks = new Sparks('add');
    this.dust = new Sparks('normal');
    this.root.addChild(this.back, this.ground, this.cast, this.dust.view, this.sparks.view, this.labels);
    this.root.visible = false;
    app.ticker.add(() => {
      if (this.isOpen) this.layoutBack();
    });
  }

  get open(): boolean {
    return this.isOpen;
  }

  /** A tall screen (a phone held upright) stacks the three duels as rows; a wide one sets them side by side. */
  private get tall(): boolean {
    return app.screen.width < app.screen.height * 0.9;
  }
  /** Lane geometry in screen px: three duels (lane 1 | lane 2 | lane 3), yours on the left of each pair. */
  slot(side: Side, lane: number): { x: number; y: number; s: number } {
    const sw = app.screen.width;
    const sh = app.screen.height;
    if (this.tall) {
      const s = Math.min(0.62, sw / 640, sh / 1400);
      return { x: sw * (side === 'me' ? 0.27 : 0.73), y: sh * (0.38 + lane * 0.2), s };
    }
    const s = Math.min(1.1, sh / 900, sw / 1450);
    const col = sw / 3;
    // A pair stands close; pairs stand apart (the eye must group each duel at a glance).
    const gap = Math.min(col * 0.19, 112);
    const cx = col * (lane + 0.5);
    return { x: cx + (side === 'me' ? -gap : gap), y: sh * 0.6, s };
  }
  /** Where a lane's numbers and cause sit (drawn by the DOM): between the pair when stacked, above it when side by side. */
  laneMid(lane: number): { x: number; y: number } {
    const a = this.slot('me', lane);
    if (this.tall) return { x: app.screen.width / 2, y: a.y - 70 * a.s };
    return { x: (app.screen.width / 3) * (lane + 0.5), y: a.y - 300 * a.s };
  }

  private async load(ids: string[]): Promise<void> {
    await Promise.all(
      ids
        .filter((u) => !this.tex.has(u))
        .map(async (u) => {
          try {
            this.tex.set(u, await Assets.load<Texture>(u));
          } catch {
            /* a missing painting: the fighter shows as a silhouette */
          }
        }),
    );
  }

  private layoutBack(): void {
    const sw = app.screen.width;
    const sh = app.screen.height;
    const bg = this.back.children[0] as Sprite | undefined;
    if (bg?.texture) {
      const k = Math.max(sw / bg.texture.width, sh / bg.texture.height) * 1.04;
      bg.scale.set(k);
      bg.position.set(sw / 2, sh / 2);
    }
    const shade = this.back.children[1] as Graphics | undefined;
    shade
      ?.clear()
      .rect(0, 0, sw, sh)
      .fill({ color: 0x07050c, alpha: this.dark ? 0.72 : 0.42 });
    this.ground.clear();
    // One stage plate per duel, under both fighters: the lane is a place, not two loose figures.
    for (let lane = 0; lane < 3; lane++) {
      const a = this.slot('me', lane);
      const b = this.slot('foe', lane);
      const cx = (a.x + b.x) / 2;
      const rx = (b.x - a.x) / 2 + 110 * a.s;
      this.ground
        .ellipse(cx, a.y + 6, rx, 30 * a.s)
        .fill({ color: 0x000000, alpha: 0.5 })
        .ellipse(cx, a.y + 6, rx, 30 * a.s)
        .stroke({ width: 2, color: 0xd1ad62, alpha: 0.35 });
    }
    this.laneTags(sw);
  }

  private tags: Text[] = [];
  /** LANE 1 · 2 · 3 under each duel. */
  private laneTags(sw: number): void {
    if (!this.tags.length)
      for (let i = 0; i < 3; i++) {
        const t = new Text({
          text: `LANE ${i + 1}`,
          style: { fontFamily: 'Cinzel', fontWeight: '800', fontSize: 14, fill: '#d1ad62', letterSpacing: 4, stroke: { color: 0x000000, width: 4 } },
        });
        t.anchor.set(0.5, 0);
        t.resolution = 2;
        this.tags.push(t);
        this.back.parent?.addChild(t);
      }
    this.tags.forEach((t, i) => {
      const a = this.slot('me', i);
      const b = this.slot('foe', i);
      t.position.set((a.x + b.x) / 2, a.y + 34 * a.s);
      t.visible = sw > 0;
      if (t.parent !== this.root) this.root.addChildAt(t, 2);
    });
  }

  /** The dive: from the map into the land's own painting. */
  async enter(world: WorldId | null, dark: boolean): Promise<void> {
    this.dark = dark;
    const url = `${import.meta.env.BASE_URL}art/scene-${world ?? 'centre-fire'}.webp`;
    await this.load([url]);
    this.back.removeChildren();
    const bg = new Sprite(this.tex.get(url) ?? Texture.EMPTY);
    bg.anchor.set(0.5);
    // The land stays a place, never a fighter: soften it behind the cast (depth of field).
    bg.filters = [new BlurFilter({ strength: 5, quality: 3 })];
    this.back.addChild(bg, new Graphics());
    this.clearCast();
    if (!this.root.parent) app.stage.addChild(this.root);
    else app.stage.setChildIndex(this.root, app.stage.children.length - 1);
    this.root.visible = true;
    this.root.pivot.set(0, 0);
    this.root.position.set(0, 0);
    this.root.scale.set(1);
    this.isOpen = true;
    this.layoutBack();
    if (REDUCED) return;
    this.root.alpha = 0;
    bg.scale.set(bg.scale.x * 1.25);
    await done(
      gsap
        .timeline()
        .to(this.root, { alpha: 1, duration: 0.35, ease: 'power2.out' })
        .from(bg, { rotation: 0.06, duration: 0.6, ease: 'expo.out' }, 0),
    );
  }

  async close(): Promise<void> {
    if (!this.isOpen) return;
    if (!REDUCED) await done(gsap.to(this.root, { alpha: 0, duration: 0.3, ease: 'power2.in' }));
    this.root.visible = false;
    this.root.alpha = 1;
    this.isOpen = false;
    this.clearCast();
  }

  private clearCast(): void {
    for (const f of [...this.fighters.me, ...this.fighters.foe, ...this.huddle]) if (f) this.kill(f);
    this.fighters = { me: [null, null, null], foe: [null, null, null] };
    this.huddle = [];
    // Kill every tween on a label before it goes (a delayed fade on a destroyed Text reads a null position).
    this.labels.removeChildren().forEach((c) => {
      gsap.killTweensOf(c);
      gsap.killTweensOf(c.scale);
      c.destroy();
    });
  }
  private kill(f: Fighter): void {
    f.breath?.kill();
    gsap.killTweensOf(f.c);
    gsap.killTweensOf(f.body);
    gsap.killTweensOf(f.body.scale);
    f.c.destroy({ children: true });
  }

  private make(cid: string, side: Side, hidden: boolean): Fighter {
    const url = art(cid);
    const t = this.tex.get(url);
    const c = new Container();
    const shadow = new Graphics().ellipse(0, 0, 70, 16).fill({ color: 0x000000, alpha: 0.35 });
    const body = new Container();
    const sprite = new Sprite(t ?? Texture.WHITE);
    sprite.anchor.set(0.5, 1);
    const look = FORM_LOOK[formOf(cid).key] ?? FORM_LOOK.plain!;
    sprite.tint = look.tint;
    const h = 230 * look.scale;
    const k = t ? h / t.height : 1;
    sprite.scale.set(side === 'foe' ? -k : k, k);
    if (!t) {
      sprite.width = 120;
      sprite.height = h;
    }
    if (hidden) {
      // Nothing to read: no outline, no size, no colour. A knot of dark smoke with a question in it.
      sprite.texture = puff();
      sprite.tint = 0x6a4a9a;
      sprite.width = 220;
      sprite.height = 230;
      sprite.scale.x = Math.abs(sprite.scale.x);
      sprite.alpha = 0.95;
    }
    // A white copy for the impact flash (additive, normally invisible).
    const flash = new Sprite(sprite.texture);
    flash.anchor.set(0.5, 1);
    flash.scale.copyFrom(sprite.scale);
    flash.tint = 0xffffff;
    flash.blendMode = 'add';
    flash.alpha = 0;
    body.addChild(sprite, flash);
    if (hidden) {
      flash.visible = false;
      const q = new Text({ text: '?', style: { fontFamily: 'Cinzel', fontWeight: '800', fontSize: 96, fill: '#d1ad62', stroke: { color: 0x000000, width: 6 } } });
      q.anchor.set(0.5, 1);
      q.y = -60;
      q.resolution = 2;
      body.addChild(q);
    }
    // A type ring at the feet (the circle is the strategy: its colour is always readable).
    if (!hidden) {
      const ty = creature(cid).type;
      const ring = new Graphics()
        .ellipse(0, 0, 64, 15)
        .stroke({ width: 5, color: hex(TYPE[ty].colour), alpha: 0.9 });
      c.addChild(ring);
    }
    c.addChild(shadow, body);
    const pl = hidden ? null : this.plate(cid);
    if (pl) c.addChild(pl.p);
    this.cast.addChild(c);
    const f: Fighter = { c, body, sprite, flash, shadow, cid, breath: null, val: pl?.val ?? null, tag: pl?.tag ?? null };
    this.breathe(f);
    return f;
  }

  /** The fighter's plate under its feet: power in a type-coloured seal, then its name and type (always readable). */
  /** The fighter's plate under its feet: a seal with '?' (no number shows until a stat is called and the order revealed), its
   *  name, and the stat label once called. No family, no hierarchy: just the card. */
  private plate(cid: string): { p: Container; val: Text; tag: Text } {
    const cr = creature(cid);
    const p = new Container();
    p.y = 26;
    const seal = new Graphics().circle(0, 16, 24).fill({ color: 0x0c0810 }).circle(0, 16, 24).stroke({ width: 4, color: 0xd1ad62 });
    const val = new Text({ text: '?', style: { fontFamily: 'Cinzel', fontWeight: '800', fontSize: 22, fill: '#ffffff' } });
    val.anchor.set(0.5);
    val.y = 16;
    const name = new Text({
      text: `${cr.name.split(',')[0]!}`,
      style: { fontFamily: 'Cinzel', fontWeight: '800', fontSize: 15, fill: '#f3e7cf', stroke: { color: 0x000000, width: 5 }, align: 'center', wordWrap: true, wordWrapWidth: 128, breakWords: true },
    });
    name.anchor.set(0.5, 0);
    name.y = 44;
    const tag = new Text({ text: '', style: { fontFamily: 'Cinzel', fontWeight: '800', fontSize: 12, fill: '#ffd36b', letterSpacing: 1, align: 'center', wordWrap: true, wordWrapWidth: 128, stroke: { color: 0x000000, width: 4 } } });
    tag.anchor.set(0.5, 0);
    tag.y = 44 + name.height;
    for (const t of [val, name, tag]) t.resolution = 2;
    p.addChild(seal, val, name, tag);
    return { p, val, tag };
  }

  /** The reveal: each lane's called stat shows on both cards, one lane at a time (Top Trumps: read it out). */
  /** v10: each lane shows both calls ("SPEED + SIZE") and each card's total. */
  async reveal(lanes: readonly { tag: string; me: number | null; foe: number | null }[]): Promise<void> {
    for (let lane = 0; lane < 3; lane++) {
      const L = lanes[lane];
      if (!L?.tag) continue;
      for (const side of ['me', 'foe'] as const) {
        const f = this.fighters[side][lane];
        const v = L[side];
        if (!f?.val || !f.tag || v === null) continue;
        f.val.text = String(v);
        f.tag.text = L.tag;
        if (!REDUCED) gsap.fromTo(f.val.scale, { x: 1.8, y: 1.8 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
      }
      await new Promise((ok) => setTimeout(ok, 380 / clock.speed));
    }
  }

  /** Idle breathing from the feet (feel-v8 verdict 11): scaleY 1.000→1.025, scaleX 1.000→0.990, 2.4–3.6 s, random phase. */
  private breathe(f: Fighter): void {
    if (REDUCED) return;
    f.breath = gsap.to(f.body.scale, {
      y: 1.025,
      x: 0.99,
      duration: 1.2 + Math.random() * 0.6,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
      delay: Math.random() * 1.2,
    });
  }

  private put(f: Fighter, p: { x: number; y: number; s: number }): void {
    f.c.position.set(p.x, p.y);
    f.c.scale.set(p.s);
    this.sortCast();
  }
  private sortCast(): void {
    const kids = [...this.cast.children].sort((a, b) => a.y - b.y);
    kids.forEach((c, i) => this.cast.setChildIndex(c, i));
  }

  /** The wild team bursts out: they leap in and mill about on the right (their order is still hidden). */
  async emerge(team: string[], dark: boolean, roar: (i: number) => void): Promise<void> {
    // The faces float unassigned: no lane labels under them yet (they would collide with the names).
    for (const t of this.tags) t.alpha = 0;
    await this.load(team.map((c) => art(c)));
    const sw = app.screen.width;
    const sh = app.screen.height;
    for (const [i, cid] of team.entries()) {
      const f = this.make(cid, 'foe', dark);
      this.huddle.push(f);
      const k = Math.min(1, sh / 900, sw / 1450) * 0.92;
      const p = { x: sw * (0.5 + (i - 1) * 0.16), y: sh * (0.6 - (i % 2) * 0.03), s: k };
      this.put(f, p);
      roar(i);
      if (!REDUCED) {
        f.body.y = -sh * 0.5;
        f.c.alpha = 0;
        const tl = gsap
          .timeline()
          .to(f.c, { alpha: 1, duration: 0.1 })
          .to(f.body, { y: 0, duration: 0.42, ease: 'power3.in' }, 0)
          .add(() => {
            addTrauma(0.22);
            this.dust.emit(puff(), p.x, p.y, {
              n: 10,
              speed: 200,
              spread: Math.PI,
              dir: -Math.PI / 2,
              ttl: 0.8,
              size: 0.5,
              grow: 2,
              tint: 0xa08a70,
              alpha: 0.7,
              jitter: 40,
            });
          })
          .fromTo(
            f.body.scale,
            { x: 1.25, y: 0.75 },
            { x: 1, y: 1, duration: 0.5, ease: 'elastic.out(1, 0.45)' },
          );
        await new Promise((ok) => setTimeout(ok, 330));
        void tl;
      }
    }
  }

  /** The honest tell: one of them steps into its known lane. */
  async tell(lane: number, cid: string): Promise<void> {
    const f = this.huddle.find((x) => x.cid === cid);
    if (!f) return;
    this.huddle = this.huddle.filter((x) => x !== f);
    this.fighters.foe[lane] = f;
    await this.stride(f, this.slot('foe', lane));
    this.tag('foe', lane, 'KNOWN', 0x9fd3ff);
  }

  /** While you choose: your fighters step into the lanes you give them. */
  async setMine(cids: (string | null)[]): Promise<void> {
    await this.load(cids.filter((c): c is string => !!c).map((c) => art(c)));
    cids.forEach((cid, lane) => {
      const cur = this.fighters.me[lane];
      if (cur?.cid === cid) return;
      if (cur) this.kill(cur);
      this.fighters.me[lane] = null;
      if (!cid) return;
      const f = this.make(cid, 'me', false);
      this.fighters.me[lane] = f;
      const p = this.slot('me', lane);
      this.put(f, p);
      if (!REDUCED) {
        f.body.y = -60;
        gsap.to(f.body, { y: 0, duration: 0.35, ease: 'bounce.out' });
      }
    });
  }

  /** Both orders revealed: everyone takes their lane (a rival's three march in from the right). */
  async orders(mine: (string | null)[], theirs: (string | null)[], hiddenFoe: boolean): Promise<void> {
    for (const t of this.tags) t.alpha = 1;
    await this.setMine(mine);
    await this.load(theirs.filter((c): c is string => !!c).map((c) => art(c)));
    const moves: Promise<void>[] = [];
    theirs.forEach((cid, lane) => {
      if (!cid) return;
      if (this.fighters.foe[lane]?.cid === cid) return;
      // Hidden shapes never become the fighter: the real creature steps out of the smoke at the reveal.
      let f = hiddenFoe ? undefined : this.huddle.find((x) => x.cid === cid);
      if (f) this.huddle = this.huddle.filter((x) => x !== f);
      else {
        f = this.make(cid, 'foe', false);
        const p = this.slot('foe', lane);
        this.put(f, { x: app.screen.width + 200, y: p.y, s: p.s });
      }
      if (hiddenFoe) f.sprite.tint = 0xffffff;
      this.fighters.foe[lane] = f;
      moves.push(this.stride(f, this.slot('foe', lane), lane * 0.12));
    });
    for (const f of this.huddle) this.kill(f);
    this.huddle = [];
    await Promise.all(moves);
  }

  /** A walk to a spot: little hops, never a slide. */
  private async stride(f: Fighter, p: { x: number; y: number; s: number }, delay = 0): Promise<void> {
    if (REDUCED) return this.put(f, p);
    const hops = 3;
    await done(
      gsap
        .timeline({ delay, onUpdate: () => this.sortCast() })
        .to(f.c, { x: p.x, y: p.y, duration: 0.5, ease: 'power1.inOut' }, 0)
        .to(f.c.scale, { x: p.s, y: p.s, duration: 0.5 }, 0)
        .to(
          f.body,
          { y: -22, duration: 0.5 / hops / 2, yoyo: true, repeat: hops * 2 - 1, ease: 'sine.out' },
          0,
        ),
    );
  }

  private tag(side: Side, lane: number, text: string, colour: number): void {
    const p = this.slot(side, lane);
    const t = new Text({
      text,
      style: {
        fontFamily: 'Cinzel',
        fontWeight: '800',
        fontSize: 18,
        fill: colour,
        letterSpacing: 2,
        stroke: { color: 0x000000, width: 5 },
      },
    });
    t.anchor.set(0.5, 1);
    t.position.set(p.x, p.y - 240 * p.s);
    this.labels.addChild(t);
    if (!REDUCED) gsap.from(t, { y: t.y + 14, alpha: 0, duration: 0.3, ease: 'back.out(3)' });
  }

  /** A special move fires: a bolt of light from the caster to its target, the move's name stamped over the lane. */
  async fired(side: Side, move: Move, lane: number, target: number): Promise<void> {
    const from = this.fighters[side][lane];
    const foeSide: Side = side === 'me' ? 'foe' : 'me';
    const hitsOwn = move === 'DOUBLE' || move === 'REVERSE' || move === 'SNATCH';
    const to = hitsOwn ? from : this.fighters[foeSide][target];
    const colour = side === 'me' ? 0xffd36b : 0xff4d6d;
    this.tag(side, lane, MOVE[move].name.toUpperCase(), colour);
    if (from && !REDUCED) {
      await done(
        gsap.to(from.body.scale, {
          x: 0.9,
          y: 1.12,
          duration: 0.16,
          yoyo: true,
          repeat: 1,
          ease: 'power2.out',
        }),
      );
      const a = { x: from.c.x, y: from.c.y - 120 * from.c.scale.y };
      const b = to ? { x: to.c.x, y: to.c.y - 120 * to.c.scale.y } : a;
      const orb = new Sprite(softDot());
      orb.anchor.set(0.5);
      orb.tint = colour;
      orb.blendMode = 'add';
      orb.scale.set(2.2);
      orb.position.set(a.x, a.y);
      this.labels.addChild(orb);
      const s = { t: 0 };
      await done(
        gsap.to(s, {
          t: 1,
          duration: hitsOwn ? 0.3 : 0.45,
          ease: 'power2.in',
          onUpdate: () => {
            const x = a.x + (b.x - a.x) * s.t;
            const y = a.y + (b.y - a.y) * s.t - Math.sin(Math.PI * s.t) * 90;
            orb.position.set(x, y);
            this.sparks.emit(softDot(), x, y, { n: 1, speed: 30, ttl: 0.35, size: 0.3, tint: colour });
          },
        }),
      );
      orb.destroy();
      this.sparks.emit(softDot(), b.x, b.y, {
        n: 22,
        speed: 280,
        ttl: 0.6,
        size: 0.35,
        tint: [colour, 0xffffff],
      });
      if (to) this.flashOn(to);
    }
    if (move === 'SWAP' && target !== lane) {
      const row = this.fighters[foeSide];
      const fa = row[lane];
      const fb = row[target];
      row[lane] = fb ?? null;
      row[target] = fa ?? null;
      await Promise.all([
        fa ? this.stride(fa, this.slot(foeSide, target)) : Promise.resolve(),
        fb ? this.stride(fb, this.slot(foeSide, lane)) : Promise.resolve(),
      ]);
    }
  }

  private flashOn(f: Fighter): void {
    if (REDUCED) return;
    f.flash.alpha = 0.95;
    gsap.to(f.flash, { alpha: 0, duration: 0.14, ease: 'power2.out' });
  }

  /** Light one lane, dim the others (the subject of the moment). */
  spotlight(lane: number | null): void {
    for (const side of ['me', 'foe'] as const)
      this.fighters[side].forEach((f, i) => {
        if (!f) return;
        const on = lane === null || i === lane;
        gsap.to(f.c, { alpha: on ? 1 : 0.42, duration: 0.25 });
      });
  }

  /** One small fight (feel-v8 verdict 9): wind-up 180 ms → lunge 140 ms → hit-stop 80/140 ms → flash 50 ms + knockback →
   *  recovery 400 ms. A tie: both charge, collide, bounce. The loser of the lane slumps; the winner hops. */
  async fight(lane: number, res: 'me' | 'foe' | 'tie', deciding: boolean): Promise<void> {
    const me = this.fighters.me[lane];
    const foe = this.fighters.foe[lane];
    this.spotlight(lane);
    if (REDUCED || !me || !foe) {
      if (res !== 'tie') this.slump((res === 'me' ? foe : me) ?? null);
      return;
    }
    const stop = deciding ? 140 : 80;
    if (res === 'tie') {
      const mx = (me.c.x + foe.c.x) / 2;
      const tl = gsap.timeline();
      tl.to([me.body.scale, foe.body.scale], { x: 0.92, y: 1.08, duration: 0.18, ease: 'power2.out' })
        .to(me.c, { x: mx - 70 * me.c.scale.x, duration: 0.14, ease: 'expo.in' })
        .to(foe.c, { x: mx + 70 * foe.c.scale.x, duration: 0.14, ease: 'expo.in' }, '<');
      await done(tl);
      await this.impact(mx, me.c.y - 120 * me.c.scale.y, stop, 0.2, 0xcfd8ff);
      this.flashOn(me);
      this.flashOn(foe);
      const p1 = this.slot('me', lane);
      const p2 = this.slot('foe', lane);
      await done(
        gsap
          .timeline()
          .to([me.body.scale, foe.body.scale], { x: 1, y: 1, duration: 0.4, ease: 'elastic.out(1, 0.5)' })
          .to(me.c, { x: p1.x, duration: 0.45, ease: 'power2.out' }, 0)
          .to(foe.c, { x: p2.x, duration: 0.45, ease: 'power2.out' }, 0),
      );
      return;
    }
    // The camera leans into the lane in focus (feel-v8 verdict 12); the deciding blow comes in slow motion.
    this.lean(lane, deciding ? 1.12 : 1.06);
    if (deciding) gsap.globalTimeline.timeScale(clock.speed * 0.4);
    const [w, l] = res === 'me' ? [me, foe] : [foe, me];
    const dir = res === 'me' ? 1 : -1;
    const home = { x: w.c.x };
    const gap = Math.abs(l.c.x - w.c.x);
    await done(
      gsap
        .timeline()
        // Anticipation: pull back, crouch, lean away.
        .to(w.c, { x: home.x - 16 * dir, duration: 0.18, ease: 'power2.out' })
        .to(w.body.scale, { x: 0.94, y: 1.05, duration: 0.18, ease: 'power2.out' }, 0)
        .to(w.body, { rotation: -0.1 * dir, duration: 0.18 }, 0)
        // The strike.
        .to(w.c, { x: home.x + (gap - 120 * w.c.scale.x) * dir, duration: 0.14, ease: 'expo.in' })
        .to(w.body.scale, { x: 1.08, y: 0.95, duration: 0.14 }, '<')
        .to(w.body, { rotation: 0.08 * dir, duration: 0.14 }, '<'),
    );
    if (deciding) gsap.globalTimeline.timeScale(clock.speed);
    this.sparks.emit(streak(), l.c.x, l.c.y - 110 * l.c.scale.y, {
      n: 8,
      speed: 520,
      dir: dir > 0 ? 0 : Math.PI,
      spread: 0.9,
      ttl: 0.3,
      size: 0.7,
      tint: 0xffffff,
    });
    await this.impact(
      l.c.x - 20 * dir,
      l.c.y - 120 * l.c.scale.y,
      stop,
      deciding ? 0.6 : 0.25,
      res === 'me' ? 0xffd36b : 0xff4d6d,
    );
    this.flashOn(l);
    const kb = (deciding ? 60 : 30) * dir;
    await done(
      gsap
        .timeline()
        .to(l.c, { x: l.c.x + kb, duration: 0.1, ease: 'power3.out' })
        .to(l.body, { rotation: 0.22 * dir, duration: 0.1 }, '<')
        .to(w.c, { x: home.x, duration: 0.4, ease: 'power2.out' }, 0.05)
        .to(w.body, { rotation: 0, duration: 0.4 }, '<')
        .to(w.body.scale, { x: 1, y: 1, duration: 0.4, ease: 'elastic.out(1, 0.5)' }, '<'),
    );
    this.slump(l);
    this.lean(null, 1);
    // The winner's hop (StS victory hop).
    await done(
      gsap
        .timeline()
        .to(w.body, { y: -36, duration: 0.18, ease: 'power2.out' })
        .to(w.body, { y: 0, duration: 0.22, ease: 'bounce.out' }),
    );
  }

  /** Lean the whole arena toward a lane (a camera push-in), or back to rest. */
  private lean(lane: number | null, z: number): void {
    if (REDUCED) return;
    const m = lane === null ? { x: app.screen.width / 2, y: app.screen.height / 2 } : this.laneMid(lane);
    const px = m.x;
    const py = lane === null ? m.y : m.y + 200;
    const gx = this.root.x + (px - this.root.pivot.x) * this.root.scale.x;
    const gy = this.root.y + (py - this.root.pivot.y) * this.root.scale.y;
    this.root.pivot.set(px, py);
    this.root.position.set(gx, gy);
    gsap.to(this.root.scale, { x: z, y: z, duration: 0.45, ease: 'power2.out' });
    gsap.to(this.root, { x: px, y: py, duration: 0.45, ease: 'power2.out' });
  }

  private async impact(x: number, y: number, ms: number, trauma: number, colour: number): Promise<void> {
    this.sparks.emit(softDot(), x, y, {
      n: 30,
      speed: 420,
      ttl: 0.55,
      size: 0.4,
      tint: [colour, 0xffffff],
      gravity: 300,
    });
    this.dust.emit(puff(), x, y + 80, {
      n: 6,
      speed: 120,
      ttl: 0.7,
      size: 0.5,
      grow: 1.8,
      tint: 0x9a8a7a,
      alpha: 0.6,
    });
    addTrauma(trauma);
    await hitStop(ms);
  }

  private slump(f: Fighter | null): void {
    if (!f) return;
    f.breath?.pause();
    gsap.to(f.body, {
      rotation: f.sprite.scale.x < 0 ? -0.25 : 0.25,
      y: 14,
      duration: 0.3,
      ease: 'power2.in',
    });
    gsap.to(f.c, { alpha: 0.5, duration: 0.4 });
    f.sprite.tint = 0x8a8090;
  }

  /** THE STRIKE (action commands, Paper Mario / Mario & Luigi): a ring closes on your fighter; press as it meets the gold.
   *  Perfect ±80 ms → 2 · good ±200 ms → 1 · late or early → 0. One ring per lane, the arena leaning into it. */
  async charge(side: Side, lane: number, autoPress: boolean, onPress: (hit: number) => void): Promise<number> {
    const f = this.fighters[side][lane];
    if (!f) return 0;
    this.spotlight(lane);
    this.lean(lane, 1.08);
    const cx = f.c.x;
    const cy = f.c.y - 120 * f.c.scale.y;
    const R = 120 * f.c.scale.y;
    const ring = new Container();
    ring.position.set(cx, cy);
    const target = new Graphics().circle(0, 0, R).stroke({ width: 8, color: 0xffd36b }).circle(0, 0, R).stroke({ width: 22, color: 0xffd36b, alpha: 0.18 });
    const closing = new Graphics().circle(0, 0, R).stroke({ width: 6, color: 0xffffff });
    ring.addChild(target, closing);
    this.labels.addChild(ring);
    const D = 1200 / clock.speed;
    const startScale = 2.8;
    const t0 = performance.now() + 250 / clock.speed;
    const hitAt = t0 + D * ((startScale - 1) / (startScale - 0.3));
    const hit = await new Promise<number>((ok) => {
      let done = false;
      const finish = (h: number) => {
        if (done) return;
        done = true;
        app.ticker.remove(tick);
        removeEventListener('keydown', key);
        app.canvas.removeEventListener('pointerdown', tap);
        ok(h);
      };
      const judge = () => {
        const dt = Math.abs(performance.now() - hitAt) * clock.speed;
        finish(dt <= 80 ? 2 : dt <= 200 ? 1 : 0);
      };
      const tick = () => {
        const k = (performance.now() - t0) / D;
        closing.scale.set(Math.max(0.3, startScale - (startScale - 0.3) * Math.max(0, k)));
        closing.alpha = k < 0 ? 0.4 : 1;
        if (k >= 1) finish(0);
      };
      const key = (e: KeyboardEvent) => {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          if (performance.now() >= t0 - 60) judge();
        }
      };
      const tap = () => {
        if (performance.now() >= t0 - 60) judge();
      };
      app.ticker.add(tick);
      addEventListener('keydown', key);
      app.canvas.addEventListener('pointerdown', tap);
      if (autoPress) setTimeout(judge, hitAt - performance.now() + (Math.random() - 0.5) * 380 / clock.speed);
    });
    ring.destroy({ children: true });
    onPress(hit);
    this.stamp(f, hit, side === 'me' ? 0xffd36b : 0xff8aa0);
    await new Promise((ok) => setTimeout(ok, 420 / clock.speed));
    return hit;
  }

  /** The verdict of one blow over a fighter: PERFECT (it powers up) · GOOD · MISS (it sags). */
  private stamp(f: Fighter, hit: number, colour: number): void {
    const word = hit >= 2 ? 'PERFECT' : hit === 1 ? 'GOOD' : 'MISS';
    const t = new Text({
      text: word,
      style: { fontFamily: 'Cinzel', fontWeight: '800', fontSize: hit >= 2 ? 40 : 30, fill: hit >= 2 ? colour : hit === 1 ? 0xffffff : 0x9a90a8, letterSpacing: 3, stroke: { color: 0x000000, width: 7 } },
    });
    t.anchor.set(0.5);
    t.resolution = 2;
    t.position.set(f.c.x, f.c.y - 270 * f.c.scale.y);
    this.labels.addChild(t);
    if (REDUCED) return;
    gsap.fromTo(t.scale, { x: 1.8, y: 1.8 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
    gsap.to(t, { alpha: 0, y: t.y - 30, delay: 1.1, duration: 0.5, onComplete: () => t.destroy() });
    if (hit >= 2) {
      this.sparks.emit(softDot(), f.c.x, f.c.y - 120 * f.c.scale.y, { n: 30, speed: 320, ttl: 0.7, size: 0.4, tint: [colour, 0xffffff] });
      gsap.fromTo(f.body.scale, { x: 1.18, y: 0.86 }, { x: 1, y: 1, duration: 0.45, ease: 'elastic.out(1, 0.4)' });
      addTrauma(0.18);
    } else if (hit === 0) gsap.fromTo(f.body, { rotation: 0.12 }, { rotation: 0, duration: 0.5, ease: 'elastic.out(1, 0.3)' });
  }

  /** The jungle's blows, shown lane by lane (it strikes too). */
  async stamps(side: Side, hits: number[]): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const f = this.fighters[side][i];
      if (!f) continue;
      this.stamp(f, hits[i] ?? 0, 0xff8aa0);
      await new Promise((ok) => setTimeout(ok, 260 / clock.speed));
    }
    this.lean(null, 1);
    this.spotlight(null);
  }

  /** A captured creature: it glows gold, rises, shrinks and flies to your side of the arena. */
  async capture(cid: string): Promise<void> {
    const f = [...this.fighters.foe, ...this.fighters.me].find((x) => x?.cid === cid) ?? null;
    if (!f || REDUCED) return;
    f.breath?.pause();
    f.sprite.tint = 0xffffff;
    f.c.alpha = 1;
    gsap.to(f.body, { rotation: 0, y: 0, duration: 0.2 });
    f.flash.tint = 0xffd36b;
    gsap.to(f.flash, { alpha: 0.85, duration: 0.25 });
    const to = { x: app.screen.width * 0.12, y: app.screen.height * 0.85 };
    const tl = gsap
      .timeline()
      .to(f.c, { y: f.c.y - 60, duration: 0.35, ease: 'power2.out' })
      .to(f.c, { x: to.x, y: to.y, duration: 0.55, ease: 'power3.in' })
      .to(f.c.scale, { x: 0.15, y: 0.15, duration: 0.55, ease: 'power3.in' }, '<');
    await done(tl);
    this.sparks.emit(softDot(), to.x, to.y, { n: 30, speed: 300, ttl: 0.7, size: 0.4, tint: [0xffd36b, 0xffffff] });
    f.c.visible = false;
  }

  /** A heart breaks over the fight. */
  async heartBreak(): Promise<void> {
    if (REDUCED) return;
    const x = app.screen.width / 2;
    const y = app.screen.height * 0.4;
    this.sparks.emit(softDot(), x, y, { n: 44, speed: 460, ttl: 0.8, size: 0.45, tint: [0xff3355, 0xff8aa0, 0xffffff], gravity: 600 });
    addTrauma(0.4);
    await new Promise((ok) => setTimeout(ok, 300));
  }

  /** The verdict: the side that won rises; the beaten fall (Showdown faint: drop and fade, accelerating). */
  async verdict(outcome: 'win' | 'lose' | 'standoff'): Promise<void> {
    this.spotlight(null);
    if (REDUCED || outcome === 'standoff') return;
    const losers = outcome === 'win' ? this.fighters.foe : this.fighters.me;
    const winners = outcome === 'win' ? this.fighters.me : this.fighters.foe;
    addTrauma(0.35);
    await Promise.all([
      ...losers
        .filter((f): f is Fighter => !!f)
        .map((f) => done(gsap.to(f.c, { y: f.c.y + 90, alpha: 0, duration: 0.5, ease: 'power2.in' }))),
      ...winners
        .filter((f): f is Fighter => !!f)
        .map((f, i) =>
          done(
            gsap
              .timeline({ delay: i * 0.08 })
              .to(f.c, { alpha: 1, duration: 0.1 })
              .to(f.body, { y: -44, duration: 0.2, ease: 'power2.out' })
              .to(f.body, { y: 0, duration: 0.25, ease: 'bounce.out' }),
          ),
        ),
    ]);
  }
}
