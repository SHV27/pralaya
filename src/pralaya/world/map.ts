/**
 * THE WORLD (D105, GDD-v8 §13): the board is a broken world adrift over the void. Eight painted islands (one per land) ring the
 * volcano of the Burning Heart; rope bridges join them; five named places sit on each island. Heroes are figurines that hop
 * along the roads; unseen places hide under mist that parts; eaten ground cracks and falls into the stars; a Great Rewire drifts
 * islands past each other; the Heart's fire grows with the clock. The camera follows the hero whose turn it is.
 * The Director owns WHAT happens (beats); this class only shows it. It keeps its own copy of the board, updated by the Director.
 */
import { Assets, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import { gsap } from 'gsap';
import { CENTRE, type Content, type Space } from '../../game/v8/map.ts';
import { HEART_NAME, PLACES } from '../../game/v8/places.ts';
import type { WorldId } from '../../game/v8/types.ts';
import { REDUCED, clock, el, esc } from '../../play/anim.ts';
import type { Audio } from '../../play/audio.ts';
import { ART } from '../look.ts';
import { WORLD } from '../text.ts';
import { Camera } from './camera.ts';
import { Sparks, addTrauma, app, done, layer, puff, softDot, streak, vignette } from './gfx.ts';
import {
  CX,
  CY,
  H,
  ISLAND_W,
  TIER,
  VOLCANO_W,
  W,
  boundsOf,
  islandAt,
  onCurve,
  placeAt,
  roadCurve,
  roadsOf,
  slotOf,
  type Pt,
} from './layout.ts';

export interface TokenView {
  seat: number;
  at: number;
  out: boolean;
  colour: string;
  art: string;
}

const hex = (c: string): number => Number.parseInt(c.replace('#', ''), 16);
const GLYPH_COLOUR: Record<Content, number> = {
  lair: 0xff4d6d,
  disaster: 0xff7a2f,
  riddle: 0x9fd3ff,
  cache: 0xffd36b,
  empty: 0xc9a2ff,
  nest: 0x9be07a,
  gate: 0xffd36b,
  hilo: 0x7fe0ff,
  tame: 0xffa05a,
  altar: 0xff6fae,
  trader: 0xd6c08a,
  golden: 0xffd36b,
  wheel: 0xff7a2f,
  cave: 0x9a8cff,
  trust: 0x6fe0c8,
  gauntlet: 0xff9a5a,
  ring: 0xff6b5a,
  pier: 0x7fc8ff,
  shrine: 0xff8a3d,
  oathStone: 0xc7b3ff,
};
/** The rock colour of each land's underside (tinted toward its palette). */
const ROCK: Record<WorldId, number> = {
  india: 0x4a3122,
  olympus: 0x5b5560,
  cosmos: 0x2e2140,
  pirate: 0x2c3a36,
  night: 0x24283c,
  lost: 0x46505a,
  toon: 0x5a3a4a,
  wild: 0x2d3a22,
};

/** The name of a place (it travels with its land in a Great Rewire). */
export function placeName(s: Space): string {
  if (s.id === CENTRE || !s.world) return HEART_NAME;
  return PLACES[s.world][slotOf(s.id).slot]!;
}

interface Marker {
  c: Container;
  disc: Graphics;
  glyph: Graphics;
  mist: Sprite;
  label: Text;
  crack: Graphics;
  hole: Graphics;
  trap?: Graphics;
}
interface Figure {
  c: Container;
  body: Container;
  ring: Graphics;
  beacon: Sprite;
  shadow: Graphics;
  colour: string;
}

export class WorldMap {
  readonly cam: Camera;
  private world = new Container();
  private sky = new Container();
  private stars: TilingSprite[] = [];
  private islandLayer = layer('islands');
  private roadLayer = layer('roads');
  private ropeLayer = layer('ropes');
  private markLayer = new Container();
  private lifeBack: Sparks;
  private tokenLayer = layer('tokens');
  private fxLayer: Sparks;
  private dust: Sparks;
  private titleLayer = layer('titles');
  private overlay = new Container();
  private islands = new Map<WorldId, Container>();
  private titles = new Map<WorldId, Text>();
  private volcano = new Container();
  private fire!: Sprite;
  private fireGlow!: Sprite;
  private markers = new Map<number, Marker>();
  private roads = new Map<string, Graphics>();
  private figs = new Map<number, Figure>();
  private at = new Map<number, number>();
  private out = new Set<number>();
  private picks: Container[] = [];
  private spaces: Space[] = [];
  private petals: WorldId[] = [];
  private active: number | null = null;
  private landTex = new Map<string, Texture>();
  private banner: HTMLElement;
  private heat = 0;
  private audio: Audio;

  constructor(host: HTMLElement, audio: Audio) {
    this.audio = audio;
    app.stage.removeChildren();
    app.stage.addChild(this.sky, this.world, this.overlay);
    this.lifeBack = new Sparks('add');
    this.fxLayer = new Sparks('add');
    this.dust = new Sparks('normal');
    this.world.addChild(
      this.ropeLayer,
      this.islandLayer,
      this.roadLayer,
      this.lifeBack.view,
      this.markLayer,
      this.tokenLayer,
      this.dust.view,
      this.fxLayer.view,
      this.titleLayer,
    );
    this.cam = new Camera(this.world);
    this.banner = el('div', 'place-banner');
    host.append(this.banner);
    this.buildSky();
    app.ticker.add((t) => this.life(t.deltaMS / 1000));
  }

  /** Load the paintings the world needs (islands if painted, else the land scenes; heroes). */
  async load(heroArt: string[]): Promise<void> {
    const ids = Object.keys(WORLD) as WorldId[];
    const want = [
      ...ids.map((w) => [`land-${w}`, `${ART}land-${w}.webp`] as const),
      ...ids.map((w) => [`scene-${w}`, `${ART}scene-${w}.webp`] as const),
      ['land-heart', `${ART}land-heart.webp`] as const,
      ['scene-centre-fire', `${ART}scene-centre-fire.webp`] as const,
      ['scene-table', `${ART}scene-table.webp`] as const,
      ...heroArt.map((u) => [u, u] as const),
    ];
    await Promise.all(
      want.map(async ([k, url]) => {
        try {
          this.landTex.set(k, await Assets.load<Texture>(url));
        } catch {
          /* fall back */
        }
      }),
    );
  }

  // ── The sky: the void under the broken world ─────────────────────────────────────────────────────────────────────────
  private buildSky(): void {
    const neb = document.createElement('canvas');
    neb.width = 512;
    neb.height = 512;
    const g = neb.getContext('2d')!;
    const base = g.createRadialGradient(256, 300, 20, 256, 300, 380);
    base.addColorStop(0, '#2a1638');
    base.addColorStop(0.5, '#120a1e');
    base.addColorStop(1, '#050309');
    g.fillStyle = base;
    g.fillRect(0, 0, 512, 512);
    for (const [x, y, r, c] of [
      [120, 140, 160, 'rgba(120,60,170,0.22)'],
      [400, 380, 190, 'rgba(40,90,160,0.16)'],
      [330, 120, 120, 'rgba(200,90,60,0.12)'],
    ] as const) {
      const n = g.createRadialGradient(x, y, 0, x, y, r);
      n.addColorStop(0, c);
      n.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = n;
      g.fillRect(0, 0, 512, 512);
    }
    const bg = new Sprite(Texture.from(neb));
    bg.label = 'nebula';
    this.sky.addChild(bg);
    for (const [n, size, alpha] of [
      [260, 1.1, 0.55],
      [120, 1.8, 0.8],
      [40, 2.6, 1],
    ] as const) {
      const c = document.createElement('canvas');
      c.width = c.height = 1024;
      const s = c.getContext('2d')!;
      for (let i = 0; i < n; i++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 1024;
        const r = size * (0.5 + Math.random());
        const tone = Math.random();
        s.fillStyle = tone < 0.15 ? '#ffd9a8' : tone < 0.3 ? '#b9c7ff' : '#ffffff';
        s.globalAlpha = 0.4 + Math.random() * 0.6;
        s.beginPath();
        s.arc(x, y, r, 0, Math.PI * 2);
        s.fill();
      }
      const t = new TilingSprite({ texture: Texture.from(c), width: 100, height: 100 });
      t.alpha = alpha;
      this.stars.push(t);
      this.sky.addChild(t);
    }
    const vig = new Sprite(vignette());
    vig.label = 'vignette';
    this.overlay.addChild(vig);
  }

  private skyTick(): void {
    const sw = app.screen.width;
    const sh = app.screen.height;
    const bg = this.sky.getChildByLabel('nebula') as Sprite;
    bg.width = sw * 1.3;
    bg.height = sh * 1.3;
    bg.x = -sw * 0.15 - (this.cam.x - CX) * 0.02;
    bg.y = -sh * 0.15 - (this.cam.y - CY) * 0.02;
    this.stars.forEach((t, i) => {
      t.width = sw;
      t.height = sh;
      const k = 0.05 + i * 0.07;
      t.tilePosition.set(-this.cam.x * k, -this.cam.y * k);
    });
    const vig = this.overlay.getChildByLabel('vignette') as Sprite;
    vig.width = sw;
    vig.height = sh;
  }

  // ── Islands ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Paint the eight islands at their petals (a Great Rewire changes which land sits where). */
  setPetals(petals: readonly WorldId[]): void {
    this.petals = [...petals];
    if (!this.islands.size) {
      for (const w of petals) this.islands.set(w, this.makeIsland(w));
      this.makeVolcano();
    }
    petals.forEach((w, k) => {
      const c = this.islands.get(w)!;
      const p = islandAt(k);
      c.position.set(p.x, p.y);
      const t = this.titles.get(w)!;
      t.position.set(p.x, p.y - 330);
    });
    this.sortIslands();
  }

  private sortIslands(): void {
    const kids = [...this.islandLayer.children].sort((a, b) => a.y - b.y);
    kids.forEach((c, i) => this.islandLayer.setChildIndex(c, i));
  }

  private makeIsland(w: WorldId): Container {
    const c = new Container();
    c.label = w;
    const land = this.landTex.get(`land-${w}`);
    if (land) {
      // A painted miniature of the land, adrift: a rock root hangs under it and the void glows beneath.
      const glow = new Sprite(softDot());
      glow.anchor.set(0.5);
      glow.tint = hex(WORLD[w].colour);
      glow.blendMode = 'add';
      glow.alpha = 0.22;
      glow.scale.set(14, 6);
      glow.y = 330;
      c.addChild(glow, this.rockRoot(w));
      const s = new Sprite(land);
      s.anchor.set(0.5, 0.6);
      s.scale.set((ISLAND_W * 1.12) / land.width);
      c.addChild(s);
    } else c.addChild(this.proceduralIsland(w));
    this.islandLayer.addChild(c);
    const t = new Text({
      text: WORLD[w].name.toUpperCase(),
      style: {
        fontFamily: 'Cinzel',
        fontWeight: '800',
        fontSize: 64,
        fill: WORLD[w].colour,
        letterSpacing: 6,
        stroke: { color: 0x07050c, width: 10, join: 'round' },
        dropShadow: { color: 0x000000, blur: 12, distance: 0, alpha: 0.9 },
      },
    });
    t.anchor.set(0.5);
    t.resolution = 2;
    this.titleLayer.addChild(t);
    this.titles.set(w, t);
    return c;
  }

  /** The rock root hanging under a floating miniature (shared by every land, tinted to it). */
  private rockRoot(w: WorldId): Graphics {
    const g = new Graphics();
    const r = ISLAND_W * 0.4;
    const top = 150;
    const pts = [-r, top, -r * 0.7, top + 120, -r * 0.42, top + 230, -r * 0.12, top + 380, r * 0.08, top + 300, r * 0.3, top + 210, r * 0.62, top + 110, r * 0.9, top + 20];
    g.poly(pts).fill({ color: ROCK[w] });
    g.poly([-r, top, -r * 0.7, top + 120, -r * 0.42, top + 230, -r * 0.12, top + 380, -r * 0.2, top + 120]).fill({ color: 0x000000, alpha: 0.28 });
    for (let i = 1; i <= 3; i++) {
      const y = top + i * 70;
      const ww = r * (1 - i * 0.22);
      g.moveTo(-ww, y).quadraticCurveTo(0, y + 16, ww, y - 6).stroke({ width: 5, color: 0x000000, alpha: 0.3 });
    }
    for (let i = 0; i < 7; i++) {
      const x = (i / 6 - 0.5) * r * 1.4;
      const y0 = top + 60 + Math.abs(x) * -0.2 + 40;
      g.moveTo(x, y0).bezierCurveTo(x + 12, y0 + 70, x - 16, y0 + 120, x + 4, y0 + 170 + (i % 3) * 40).stroke({ width: 3, color: 0x24180c, alpha: 0.85 });
    }
    return g;
  }

  /** An island torn out of its land: its painting on a cracked plateau, a rock root hanging into the void. */
  private proceduralIsland(w: WorldId): Container {
    const c = new Container();
    const rx = ISLAND_W / 2;
    const ry = rx * 0.6;
    const rock = ROCK[w];
    // The underside: a jagged cone of rock with strata.
    const under = new Graphics();
    const pts: number[] = [];
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * (i / n);
      pts.push(rx * Math.cos(a) * 1.0, ry * Math.sin(a) * 0.55 + 10);
    }
    const depth = rx * 1.05;
    pts.push(
      -rx * 0.55,
      depth * 0.45,
      -rx * 0.3,
      depth * 0.75,
      -rx * 0.05,
      depth,
      rx * 0.18,
      depth * 0.7,
      rx * 0.5,
      depth * 0.42,
    );
    under.poly(pts).fill({ color: rock });
    for (let i = 1; i <= 4; i++) {
      const yy = (depth * i) / 5;
      const ww = rx * (1 - i / 5.4);
      under
        .moveTo(-ww, yy)
        .quadraticCurveTo(0, yy + 18, ww, yy - 6)
        .stroke({ width: 5, color: 0x000000, alpha: 0.28 });
    }
    under.poly(pts).stroke({ width: 4, color: 0x000000, alpha: 0.35 });
    // Hanging roots.
    for (let i = 0; i < 9; i++) {
      const x = (Math.random() - 0.5) * rx * 1.4;
      const y0 = ry * 0.4 + Math.random() * 40;
      under
        .moveTo(x, y0)
        .bezierCurveTo(x + 14, y0 + 60, x - 18, y0 + 110, x + 6, y0 + 150 + Math.random() * 80)
        .stroke({ width: 3, color: 0x2a1c10, alpha: 0.8 });
    }
    c.addChild(under);
    // The plateau: the land's painting inside a rough ellipse, a lit rim.
    const scene = this.landTex.get(`scene-${w}`);
    const rim: number[] = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const j = 1 + (Math.sin(i * 2.7) * 0.03 + Math.sin(i * 5.3) * 0.02);
      rim.push(rx * Math.cos(a) * j, ry * Math.sin(a) * j);
    }
    const lip = new Graphics()
      .poly(rim)
      .fill({ color: rock })
      .poly(rim)
      .stroke({ width: 22, color: 0x000000, alpha: 0.45 });
    lip.y = 14;
    c.addChild(lip);
    if (scene) {
      const s = new Sprite(scene);
      s.anchor.set(0.5);
      s.scale.set(Math.max((rx * 2.1) / scene.width, (ry * 2.1) / scene.height) * 1.0);
      const mask = new Graphics().poly(rim).fill({ color: 0xffffff });
      s.mask = mask;
      c.addChild(s, mask);
    } else c.addChild(new Graphics().poly(rim).fill({ color: hex(WORLD[w].colour) }));
    const edge = new Graphics().poly(rim).stroke({ width: 8, color: hex(WORLD[w].colour), alpha: 0.55 });
    const shade = new Graphics().poly(rim).stroke({ width: 40, color: 0x000000, alpha: 0.22 });
    c.addChild(shade, edge);
    return c;
  }

  private makeVolcano(): void {
    const v = this.volcano;
    v.position.set(CX, CY);
    const land = this.landTex.get('land-heart');
    if (land) {
      const s = new Sprite(land);
      s.anchor.set(0.5, 0.42);
      s.scale.set(VOLCANO_W / land.width);
      v.addChild(s);
    } else {
      const g = new Graphics();
      const r = VOLCANO_W / 2;
      g.poly([
        -r,
        140,
        -r * 0.55,
        -40,
        -r * 0.2,
        -170,
        r * 0.2,
        -170,
        r * 0.55,
        -40,
        r,
        140,
        r * 0.4,
        520,
        0,
        640,
        -r * 0.4,
        520,
      ]).fill({
        color: 0x1d1418,
      });
      g.poly([-r, 140, -r * 0.55, -40, -r * 0.2, -170, r * 0.2, -170, r * 0.55, -40, r, 140]).stroke({
        width: 10,
        color: 0x000000,
        alpha: 0.4,
      });
      for (const [x0, x1] of [
        [-60, -260],
        [40, 220],
        [-10, -60],
      ] as const)
        g.moveTo(x0, -150)
          .quadraticCurveTo((x0 + x1) / 2 + 30, 0, x1, 130)
          .stroke({ width: 10, color: 0xff6a1a, alpha: 0.85 });
      v.addChild(g);
      const crown = this.landTex.get('scene-centre-fire');
      if (crown) {
        const s = new Sprite(crown);
        s.anchor.set(0.5);
        s.scale.set(330 / crown.width);
        s.y = -170;
        const m = new Graphics().ellipse(0, -170, 165, 70).fill({ color: 0xffffff });
        s.mask = m;
        v.addChild(s, m);
      }
    }
    this.fireGlow = new Sprite(softDot());
    this.fireGlow.anchor.set(0.5);
    this.fireGlow.tint = 0xff7a2f;
    this.fireGlow.blendMode = 'add';
    this.fireGlow.position.set(0, -170);
    this.fire = new Sprite(softDot());
    this.fire.anchor.set(0.5, 0.8);
    this.fire.tint = 0xffd36b;
    this.fire.blendMode = 'add';
    this.fire.position.set(0, -150);
    v.addChild(this.fireGlow, this.fire);
    this.islandLayer.addChild(v);
    this.setHeat(0);
  }

  /** The Heart's fire is the clock: it grows as the Last Light nears (0..1+). */
  setHeat(p: number): void {
    this.heat = Math.max(0, Math.min(1.2, p));
    const s = 4 + this.heat * 7;
    gsap.to(this.fireGlow.scale, { x: s * 2.4, y: s * 1.6, duration: 1.2, ease: 'sine.out' });
    gsap.to(this.fire.scale, {
      x: 1.4 + this.heat * 1.6,
      y: 2.2 + this.heat * 2.4,
      duration: 1.2,
      ease: 'sine.out',
    });
    this.fireGlow.alpha = 0.45 + this.heat * 0.4;
  }

  // ── Places and roads ────────────────────────────────────────────────────────────────────────────────────────────────
  /** Draw (or redraw) every place and road from the presented board. */
  setBoard(spaces: readonly Space[]): void {
    this.spaces = spaces.map((s) => ({ ...s, adj: [...s.adj] }));
    for (const g of this.roads.values()) {
      gsap.killTweensOf(g);
      g.destroy();
    }
    this.roads.clear();
    for (const r of roadsOf(this.spaces)) {
      if (this.spaces[r.a]!.void || this.spaces[r.b]!.void) continue;
      const g = this.drawRoad(r.a, r.b, r.rope);
      this.roads.set(`${r.a}-${r.b}`, g);
      // Rope bridges hang behind the islands (anchored under their rims); footpaths are inked on top of the land.
      (r.rope ? this.ropeLayer : this.roadLayer).addChild(g);
    }
    for (const s of this.spaces) this.paintPlace(s);
  }

  private drawRoad(a: number, b: number, rope: boolean): Graphics {
    const pa = placeAt(a);
    const pb = placeAt(b);
    const { c, len } = roadCurve(pa, pb, rope);
    const g = new Graphics();
    if (rope) {
      // Two ropes with planks between them, sagging over the void.
      const n = Math.max(6, Math.floor(len / 30));
      const left: Pt[] = [];
      const right: Pt[] = [];
      for (let i = 0; i <= n; i++) {
        const p = onCurve(pa, c, pb, i / n);
        left.push({ x: p.x, y: p.y - 9 });
        right.push({ x: p.x, y: p.y + 9 });
      }
      for (let i = 1; i < n; i++) {
        const l = left[i]!;
        const r = right[i]!;
        g.moveTo(l.x, l.y - 2)
          .lineTo(r.x, r.y + 2)
          .stroke({ width: 11, color: 0x6b4a2a });
        g.moveTo(l.x, l.y - 2)
          .lineTo(r.x, r.y + 2)
          .stroke({ width: 2, color: 0x2a1a0c, alpha: 0.6 });
      }
      for (const side of [left, right]) {
        g.moveTo(side[0]!.x, side[0]!.y);
        for (const p of side.slice(1)) g.lineTo(p.x, p.y);
        g.stroke({ width: 4, color: 0xc7a46a, alpha: 0.95 });
      }
    } else {
      // A footpath of inked dots (Slay the Spire: one every ~17 px, never a ruler line).
      const n = Math.max(3, Math.floor(len / 26));
      for (let i = 1; i < n; i++) {
        const p = onCurve(pa, c, pb, i / n);
        g.circle(p.x, p.y, 6.5).fill({ color: 0x1a120a, alpha: 0.55 });
        g.circle(p.x, p.y - 1, 4.5).fill({ color: 0xf3e7cf, alpha: 0.9 });
      }
    }
    return g;
  }

  /** v10 the Last Stand: the fallen's traps, as iron jaws around a place. */
  private trapSet = new Set<number>();
  setTraps(ids: readonly number[]): void {
    const old = this.trapSet;
    this.trapSet = new Set(ids);
    for (const id of new Set([...old, ...ids])) {
      const m = this.markers.get(id);
      if (!m) continue;
      m.trap ??= m.c.addChild(new Graphics());
      m.trap.clear();
      if (!this.trapSet.has(id)) continue;
      const teeth: number[] = [];
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        const r = k % 2 ? 70 : 84;
        teeth.push(Math.cos(a) * r, Math.sin(a) * r * 0.58);
      }
      m.trap.poly(teeth).stroke({ width: 6, color: 0xff3355, alpha: 0.95 });
      if (!REDUCED) gsap.fromTo(m.trap.scale, { x: 1.6, y: 1.6 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2)' });
    }
  }

  private paintPlace(s: Space): void {
    let m = this.markers.get(s.id);
    if (!m) {
      m = this.makeMarker(s);
      this.markers.set(s.id, m);
    }
    const p = placeAt(s.id);
    m.c.position.set(p.x, p.y);
    if (s.void) {
      m.disc.visible = m.glyph.visible = m.label.visible = m.mist.visible = m.crack.visible = false;
      m.hole.visible = true;
      return;
    }
    m.hole.visible = false;
    m.disc.visible = m.label.visible = true;
    const colour = s.world ? hex(WORLD[s.world].colour) : 0xffd36b;
    m.disc.clear();
    const big = s.id === CENTRE ? 1.5 : 1;
    m.disc
      .ellipse(0, 6, 62 * big, 36 * big)
      .fill({ color: 0x000000, alpha: 0.45 })
      .ellipse(0, 0, 56 * big, 32 * big)
      .fill({ color: 0x17111c, alpha: 0.92 })
      .ellipse(0, 0, 56 * big, 32 * big)
      .stroke({ width: 6, color: colour, alpha: 0.95 })
      .ellipse(0, -3, 44 * big, 22 * big)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.12 });
    m.label.text = placeName(s).toUpperCase();
    m.label.style.fill = s.world ? WORLD[s.world].colour : '#ffd36b';
    m.glyph.clear();
    const seen = s.seen || s.id === CENTRE;
    if (seen) drawGlyph(m.glyph, s.id === CENTRE ? s.content : 'sealed');
    m.glyph.visible = seen;
    if (seen && m.mist.visible && m.mist.alpha > 0.05) this.partMist(m);
    if (!seen) {
      m.mist.visible = true;
      m.mist.alpha = 0.92;
      m.mist.scale.set(1.25);
    }
  }

  private makeMarker(s: Space): Marker {
    const c = new Container();
    const disc = new Graphics();
    const glyph = new Graphics();
    const crack = new Graphics();
    const hole = new Graphics();
    hole
      .poly([-70, -10, -40, -36, 0, -30, 44, -38, 74, -6, 52, 26, 8, 36, -46, 28])
      .fill({ color: 0x0a0612 });
    hole.poly([-70, -10, -40, -36, 0, -30, 44, -38, 74, -6, 52, 26, 8, 36, -46, 28]).stroke({
      width: 5,
      color: 0x8f5bd6,
      alpha: 0.8,
    });
    hole.visible = false;
    const mist = new Sprite(puff());
    mist.anchor.set(0.5, 0.55);
    mist.tint = 0xd6cfe6;
    mist.width = 210;
    mist.height = 150;
    const label = new Text({
      text: '',
      style: {
        fontFamily: 'Cinzel',
        fontWeight: '800',
        fontSize: 19,
        fill: '#f3e7cf',
        letterSpacing: 1,
        align: 'center',
        // Nine places share an island now: names wrap onto two short lines under their own marker.
        wordWrap: true,
        wordWrapWidth: 150,
        lineHeight: 20,
        stroke: { color: 0x07050c, width: 6, join: 'round' },
      },
    });
    label.anchor.set(0.5, 0);
    label.y = s.id === CENTRE ? 58 : 40;
    label.resolution = 2;
    c.addChild(hole, disc, glyph, crack, label, mist);
    this.markLayer.addChild(c);
    return { c, disc, glyph, mist, label, crack, hole };
  }

  /** The clouds part (never fade): the mist swells outward and thins over ~0.9 s (feel-v8 verdict 5). */
  private partMist(m: Marker): void {
    if (REDUCED) {
      m.mist.visible = false;
      return;
    }
    gsap.to(m.mist.scale, {
      x: m.mist.scale.x * 2.2,
      y: m.mist.scale.y * 1.7,
      duration: 0.95,
      ease: 'power2.out',
    });
    gsap.to(m.mist, {
      alpha: 0,
      y: -30,
      duration: 0.95,
      ease: 'power2.out',
      onComplete: () => {
        m.mist.visible = false;
        m.mist.y = 0;
      },
    });
  }

  updateSpaces(list: readonly Space[]): void {
    for (const s of list) {
      this.spaces[s.id] = { ...s, adj: [...s.adj] };
      this.paintPlace(this.spaces[s.id]!);
    }
  }

  // ── Heroes as figurines ──────────────────────────────────────────────────────────────────────────────────────────────
  tokensSet(list: readonly TokenView[]): void {
    for (const t of list) {
      let f = this.figs.get(t.seat);
      if (!f) {
        f = this.makeFigure(t);
        this.figs.set(t.seat, f);
      }
      if (t.out) this.out.add(t.seat);
      else this.out.delete(t.seat);
      this.at.set(t.seat, t.out ? -1 : t.at);
    }
    this.layoutFigures(0);
  }

  private makeFigure(t: TokenView): Figure {
    const c = new Container();
    const colour = hex(t.colour);
    const shadow = new Graphics().ellipse(0, 0, 46, 16).fill({ color: 0x000000, alpha: 0.45 });
    const beacon = new Sprite(softDot());
    beacon.anchor.set(0.5);
    beacon.tint = colour;
    beacon.blendMode = 'add';
    beacon.scale.set(4.5, 2.2);
    beacon.alpha = 0;
    const body = new Container();
    const base = new Graphics()
      .ellipse(0, -4, 40, 14)
      .fill({ color: 0x120c10 })
      .ellipse(0, -10, 36, 12)
      .fill({ color: colour })
      .moveTo(-6, -14)
      .lineTo(-6, -40)
      .lineTo(6, -40)
      .lineTo(6, -14)
      .fill({ color: 0x2a2024 });
    // A cardboard standee, like a board-game miniature: the hero in an arched frame of their seat colour.
    const SW = 104;
    const SH = 150;
    const arch = (g: Graphics, pad: number) =>
      g
        .moveTo(-SW / 2 - pad, 0)
        .lineTo(-SW / 2 - pad, -SH + SW / 2)
        .arc(0, -SH + SW / 2, SW / 2 + pad, Math.PI, 0)
        .lineTo(SW / 2 + pad, 0)
        .closePath();
    const medal = new Container();
    medal.y = -40;
    const back = arch(new Graphics(), 10).fill({ color: 0x0c0810 });
    const tex = this.landTex.get(t.art);
    const face = new Sprite(tex ?? Texture.WHITE);
    face.anchor.set(0.5, 0);
    face.scale.set(tex ? (SW * 1.25) / tex.width : 0);
    face.y = -SH - 6;
    const mask = arch(new Graphics(), 0).fill({ color: 0xffffff });
    face.mask = mask;
    const ring = arch(new Graphics(), 5).stroke({ width: 9, color: colour, join: 'round' });
    const gloss = new Graphics().moveTo(-SW / 2 + 10, -SH + 40).lineTo(-SW / 2 + 10, -20).stroke({ width: 4, color: 0xffffff, alpha: 0.18 });
    medal.addChild(back, face, mask, ring, gloss);
    body.addChild(base, medal);
    c.addChild(beacon, shadow, body);
    this.tokenLayer.addChild(c);
    return { c, body, ring, beacon, shadow, colour: t.colour };
  }

  private spot(seat: number, at: number): Pt {
    const p = placeAt(at);
    const mates = [...this.at].filter(([s, a]) => a === at && !this.out.has(s)).map(([s]) => s);
    const i = mates.indexOf(seat);
    if (mates.length < 2 || i < 0) return { x: p.x, y: p.y - 6 };
    const a = (i / mates.length) * Math.PI * 2 - Math.PI / 2;
    return { x: p.x + 70 * Math.cos(a), y: p.y - 6 + 34 * Math.sin(a) };
  }

  private layoutFigures(secs: number): void {
    for (const [seat, f] of this.figs) {
      const at = this.at.get(seat) ?? -1;
      f.c.visible = at >= 0 && !this.out.has(seat);
      if (at < 0) continue;
      const p = this.spot(seat, at);
      if (secs && !REDUCED) gsap.to(f.c, { x: p.x, y: p.y, duration: secs, ease: 'power2.out' });
      else f.c.position.set(p.x, p.y);
    }
    this.sortFigures();
  }
  private sortFigures(): void {
    const kids = [...this.tokenLayer.children].sort((a, b) => a.y - b.y);
    kids.forEach((c, i) => this.tokenLayer.setChildIndex(c, i));
  }

  setActive(seat: number | null): void {
    this.active = seat;
    for (const [s, f] of this.figs) {
      gsap.killTweensOf(f.beacon);
      gsap.killTweensOf(f.body.scale);
      f.body.scale.set(1);
      if (s === seat) {
        f.beacon.alpha = 0.5;
        gsap.to(f.beacon, { alpha: 0.95, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        gsap.to(f.body.scale, {
          x: 1.04,
          y: 0.97,
          duration: 1.4,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut',
        });
        this.tokenLayer.setChildIndex(f.c, this.tokenLayer.children.length - 1);
      } else f.beacon.alpha = 0;
    }
  }

  /** Allies walk with you (owner Q11): your newest creature stands beside your figure and travels with it. */
  private allies = new Map<number, { sprite: Sprite; cid: string }>();
  private allyWant = new Map<number, string | null>();
  async setAlly(seat: number, cid: string | null): Promise<void> {
    const f = this.figs.get(seat);
    if (!f) return;
    this.allyWant.set(seat, cid);
    const old = this.allies.get(seat);
    if (old?.cid === cid) return;
    if (old) {
      this.allies.delete(seat);
      gsap.killTweensOf(old.sprite);
      gsap.killTweensOf(old.sprite.scale);
      old.sprite.destroy();
    }
    if (!cid) return;
    const url = `${ART}${cid}.webp`;
    let tex = this.landTex.get(url);
    if (!tex) {
      try {
        tex = await Assets.load<Texture>(url);
        this.landTex.set(url, tex);
      } catch {
        return;
      }
    }
    // Two quick changes: only the latest request may land (a slower texture load must not resurrect an old ally).
    if (this.allyWant.get(seat) !== cid || this.allies.has(seat) || f.c.destroyed) return;
    const sp = new Sprite(tex);
    sp.anchor.set(0.5, 1);
    const k = 92 / Math.max(1, tex.height);
    sp.scale.set(k);
    sp.position.set(70, 4);
    f.c.addChildAt(sp, 2);
    this.allies.set(seat, { sprite: sp, cid });
    if (!REDUCED) {
      gsap.from(sp.scale, { x: 0, y: 0, duration: 0.4, ease: 'back.out(2)' });
      gsap.to(sp, { y: -6, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }
  }

  /** The camera rides with this hero (a turn begins). */
  async followSeat(seat: number, tier: 'close' | 'region' = 'region'): Promise<void> {
    const f = this.figs.get(seat);
    if (!f || !f.c.visible) return this.cam.overview();
    await this.cam.track(f.c, tier);
  }

  /** Walk a figurine along the roads, one hop per place (260 ms hop, arc, squash on landing, dust: feel-v8 verdict 6). */
  async walk(seat: number, path: number[], perStep = 300): Promise<void> {
    const f = this.figs.get(seat);
    if (!f) return;
    this.cam.track(f.c, 'close');
    let from = this.at.get(seat) ?? path[0]!;
    for (const n of path) {
      const a = placeAt(from);
      const b = this.spot(seat, n);
      this.at.set(seat, n);
      if (REDUCED) {
        f.c.position.set(b.x, b.y);
        continue;
      }
      const rope = slotOf(from).k !== slotOf(n).k;
      const { c } = roadCurve(a, placeAt(n), rope);
      const s = { t: 0 };
      const hop = rope ? 30 : 46;
      const dur = (rope ? perStep * 1.6 : perStep) / 1000;
      const tl = gsap.timeline();
      tl.to(f.body.scale, { x: 0.92, y: 1.08, duration: dur * 0.25, ease: 'power2.out' }, 0)
        .to(
          s,
          {
            t: 1,
            duration: dur,
            ease: 'sine.inOut',
            onUpdate: () => {
              const p = onCurve(a, c, b, s.t);
              f.c.position.set(p.x, p.y);
              // The ballistic hop (Showdown: y = -3x² + 4x shape, peak mid-hop) and the shadow that shrinks at the top.
              const h = Math.sin(Math.PI * s.t) * hop;
              f.body.y = -h;
              f.shadow.scale.set(1 - (0.35 * h) / hop);
            },
          },
          0,
        )
        .to(f.body.scale, { x: 1.14, y: 0.86, duration: 0.07, ease: 'power2.in' }, dur)
        .to(f.body.scale, { x: 1, y: 1, duration: 0.18, ease: 'back.out(3)' }, dur + 0.07);
      await new Promise<void>((ok) => setTimeout(ok, (dur * 1000) / clock.speed));
      this.dust.emit(puff(), b.x, b.y + 4, {
        n: 5,
        speed: 90,
        spread: Math.PI,
        dir: -Math.PI / 2,
        ttl: 0.6,
        size: 0.35,
        grow: 1.6,
        tint: 0xb59a7a,
        alpha: 0.6,
        gravity: -20,
        jitter: 30,
      });
      this.audio.sfx('step', 1);
      from = n;
    }
    this.layoutFigures(0.25);
    if (seat === this.active) this.cam.track(f.c, 'close');
  }

  /** Vanish into a swirl here, burst out there (portal, push, swap). */
  async jump(seat: number, to: number, ms = 900): Promise<void> {
    const f = this.figs.get(seat);
    if (!f) return;
    const from = { x: f.c.x, y: f.c.y };
    if (!REDUCED) {
      this.fxLayer.emit(softDot(), from.x, from.y - 80, {
        n: 26,
        speed: 260,
        ttl: 0.7,
        size: 0.45,
        tint: [0xa77bf0, 0xffd36b],
        jitter: 20,
      });
      await done(gsap.to(f.body, { rotation: Math.PI * 2, duration: ms / 2000, ease: 'power2.in' }));
      gsap.to(f.body.scale, { x: 0.05, y: 0.05, duration: 0.01 });
    }
    this.at.set(seat, to);
    const p = this.spot(seat, to);
    f.c.position.set(p.x, p.y);
    await this.cam.to({ x: p.x, y: p.y - 40 }, TIER.region, 0.9);
    if (!REDUCED) {
      f.body.rotation = 0;
      this.fxLayer.emit(softDot(), p.x, p.y - 80, {
        n: 30,
        speed: 300,
        ttl: 0.7,
        size: 0.45,
        tint: [0xa77bf0, 0xffffff],
        jitter: 20,
      });
      addTrauma(0.25);
      await done(gsap.to(f.body.scale, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2.4)' }));
    }
    this.layoutFigures(0.2);
  }

  // ── Marks: omens, trails, picks ──────────────────────────────────────────────────────────────────────────────────────
  /** Omens: glowing cracks on doomed ground (the world never says it in words). */
  omen(ids: readonly number[]): void {
    for (const [, m] of this.markers) {
      gsap.killTweensOf(m.crack);
      m.crack.clear();
      m.crack.visible = false;
    }
    for (const id of ids) {
      const m = this.markers.get(id);
      if (!m) continue;
      m.crack.visible = true;
      m.crack
        .moveTo(-58, -4)
        .lineTo(-30, 4)
        .lineTo(-40, 22)
        .moveTo(-30, 4)
        .lineTo(-4, -6)
        .lineTo(18, 10)
        .lineTo(52, 2)
        .moveTo(18, 10)
        .lineTo(12, 30)
        .moveTo(-4, -6)
        .lineTo(6, -26)
        .stroke({ width: 6, color: 0xff3355, alpha: 0.95, cap: 'round', join: 'round' });
      m.crack.alpha = 0.4;
      gsap.to(m.crack, { alpha: 1, duration: 0.8, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }
  }
  async omenHeals(): Promise<void> {
    const list = [...this.markers.values()].filter((m) => m.crack.visible);
    await Promise.all(
      list.map((m) => {
        gsap.killTweensOf(m.crack);
        return done(
          gsap.to(m.crack, { alpha: 0, duration: 0.7, onComplete: () => void (m.crack.visible = false) }),
        );
      }),
    );
  }

  /** Each fate card's reach in its own colour, labelled 1/2/3; the camera frames them all. */
  trails(sets: readonly { ends: number[]; colour: string; label: string }[]): void {
    this.clearTrails();
    const all: number[] = [];
    sets.forEach((t, si) =>
      t.ends.slice(0, 18).forEach((id) => {
        all.push(id);
        const p = placeAt(id);
        const g = new Container();
        const ring = new Graphics()
          .ellipse(0, 0, 78 + si * 12, 46 + si * 7)
          .stroke({ width: 7, color: hex(t.colour), alpha: 0.95 });
        const lab = new Text({
          text: t.label,
          style: {
            fontFamily: 'Cinzel',
            fontWeight: '800',
            fontSize: 40,
            fill: t.colour,
            stroke: { color: 0x000000, width: 8 },
          },
        });
        lab.anchor.set(0.5);
        lab.position.set((si - (sets.length - 1) / 2) * 44, -84);
        lab.resolution = 2;
        g.addChild(ring, lab);
        g.position.set(p.x, p.y);
        gsap.fromTo(
          ring.scale,
          { x: 0.85, y: 0.85 },
          {
            x: 1.05,
            y: 1.05,
            duration: 0.63,
            yoyo: true,
            repeat: -1,
            ease: 'sine.inOut',
            delay: Math.random() * 0.6,
          },
        );
        this.markLayer.addChild(g);
        this.picks.push(g);
      }),
    );
    const here = this.active !== null ? this.at.get(this.active) : undefined;
    if (all.length)
      void this.cam.frame(boundsOf(here !== undefined && here >= 0 ? [...all, here] : all), 0.9, TIER.region);
  }
  clearTrails(): void {
    for (const g of this.picks) {
      gsap.killTweensOf(g);
      for (const k of g.children) gsap.killTweensOf(k.scale);
      g.destroy({ children: true });
    }
    this.picks = [];
  }

  /** Ask for a place: only the legal places breathe, each out of step (StS: never in unison); click, tap or a number key. */
  pick(options: readonly number[], onPick: (id: number) => void, tags?: Map<number, { text: string; colour: string }>): () => void {
    this.clearTrails();
    options.forEach((id, i) => {
      const p = placeAt(id);
      const g = new Container();
      g.position.set(p.x, p.y);
      const ring = new Graphics()
        .ellipse(0, 0, 66, 40)
        .fill({ color: 0xffd36b, alpha: 0.18 })
        .ellipse(0, 0, 66, 40)
        .stroke({ width: 7, color: 0xffd36b });
      const lab = new Text({
        text: String(i + 1),
        style: {
          fontFamily: 'Cinzel',
          fontWeight: '800',
          fontSize: 48,
          fill: '#ffd36b',
          stroke: { color: 0x000000, width: 9 },
        },
      });
      lab.anchor.set(0.5);
      lab.y = -92;
      lab.resolution = 2;
      g.addChild(ring, lab);
      const tag = tags?.get(id);
      if (tag) {
        // v12: a rival, the boss or hunters stand there: you choose the fight on purpose (Ludo: "kaat dunga").
        const t = new Text({
          text: tag.text,
          style: { fontFamily: 'Cinzel', fontWeight: '800', fontSize: 26, fill: tag.colour, stroke: { color: 0x000000, width: 7 } },
        });
        t.anchor.set(0.5);
        t.y = 62;
        t.resolution = 2;
        g.addChild(t);
      }
      g.eventMode = 'static';
      g.cursor = 'pointer';
      g.hitArea = {
        contains: (x: number, y: number) => (x * x) / (80 * 80) + ((y + 20) * (y + 20)) / (60 * 60) <= 1,
      };
      g.on('pointertap', () => onPick(id));
      gsap.fromTo(
        ring.scale,
        { x: 0.91, y: 0.91 },
        {
          x: 1.18,
          y: 1.18,
          duration: 0.63,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut',
          delay: Math.random() * 0.63,
        },
      );
      this.markLayer.addChild(g);
      this.picks.push(g);
    });
    const here = this.active !== null ? this.at.get(this.active) : undefined;
    void this.cam.frame(
      boundsOf(here !== undefined && here >= 0 ? [...options, here] : [...options]),
      0.8,
      TIER.region,
    );
    return () => this.clearTrails();
  }

  /** v12 the Road Not Taken: a label floats over each place for a breath, then fades (nothing stays on the map). */
  flashLabels(items: readonly { at: number; text: string; colour: string }[], ms = 3000): void {
    for (const it of items) {
      const p = placeAt(it.at);
      const t = new Text({
        text: it.text,
        style: { fontFamily: 'Cinzel', fontWeight: '800', fontSize: 30, fill: it.colour, stroke: { color: 0x000000, width: 8 }, align: 'center' },
      });
      t.anchor.set(0.5);
      t.resolution = 2;
      t.position.set(p.x, p.y - 70);
      t.alpha = 0;
      this.markLayer.addChild(t);
      gsap
        .timeline({ onComplete: () => t.destroy() })
        .to(t, { alpha: 1, y: p.y - 96, duration: 0.35, ease: 'back.out' })
        .to(t, { alpha: 0, duration: 0.5, delay: ms / 1000 - 0.85 });
    }
    if (items.length) {
      const here = this.active !== null ? this.at.get(this.active) : undefined;
      void this.cam.frame(boundsOf(here !== undefined && here >= 0 ? [...items.map((x) => x.at), here] : items.map((x) => x.at)), 0.7, TIER.region);
    }
  }
  /** The camera punches in on a place (null: back to the hero whose turn it is). */
  async focus(id: number | null, scale = 1.45, ms = 650): Promise<void> {
    if (id === null) {
      if (this.active !== null) return this.followSeat(this.active, 'region');
      return this.cam.overview(ms / 1000);
    }
    const p = placeAt(id);
    await this.cam.to({ x: p.x, y: p.y - 60 }, scale > 1.3 ? TIER.close : TIER.region, ms / 1000);
  }

  overview(secs = 1.1): Promise<void> {
    return this.cam.overview(secs);
  }

  /** Arrival is a moment: the place's name slides in once the camera settles (feel-v8 verdict 7). */
  async arrive(id: number, who?: string): Promise<void> {
    const s = this.spaces[id];
    if (!s) return;
    const world = s.world ? WORLD[s.world] : null;
    this.banner.innerHTML = `<b style="color:${world?.colour ?? '#ffd36b'}">${esc(placeName(s))}</b><small>${who ? `${esc(who)} · ` : ''}${esc(world?.name ?? 'The heart of the world')}</small>`;
    this.banner.classList.remove('on');
    void this.banner.offsetWidth;
    this.banner.classList.add('on');
    this.bannerOff();
    const m = this.markers.get(id);
    if (m && !REDUCED)
      gsap.fromTo(m.disc.scale, { x: 1.25, y: 1.25 }, { x: 1, y: 1, duration: 0.5, ease: 'back.out(3)' });
  }
  private bannerTimer = 0;
  /** A banner names the moment, then leaves (one subject at a time). */
  private bannerOff(ms = 2200): void {
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.hideBanner(), ms / clock.speed);
  }
  hideBanner(): void {
    this.banner.classList.remove('on');
  }

  /** Screen position of a place (client px; the canvas fills the window). */
  screenOf(id: number): { x: number; y: number } {
    const p = this.world.toGlobal(placeAt(id));
    return { x: p.x, y: p.y };
  }
  figureScreen(seat: number): { x: number; y: number } | null {
    const f = this.figs.get(seat);
    if (!f || !f.c.visible) return null;
    const p = this.world.toGlobal({ x: f.c.x, y: f.c.y - 100 });
    return { x: p.x, y: p.y };
  }

  // ── Hunters: beasts loose in the world, running the roads after one hero ────────────────────────────────────────────
  private hunters = new Map<number, Container>();
  /** Beasts break loose: their leader stands on the map in a red ring, the name of its prey over it. */
  async addHunter(id: number, cid: string, at: number, prey: string, preyColour: string, banner?: string): Promise<void> {
    const url = `${ART}${cid}.webp`;
    // v10: an unnamed hunt (no cid) is a shape of smoke: nobody knows what follows them until it catches them.
    let tex = cid ? this.landTex.get(url) : puff();
    if (!tex) {
      try {
        tex = await Assets.load<Texture>(url);
        this.landTex.set(url, tex);
      } catch {
        tex = Texture.WHITE;
      }
    }
    const c = new Container();
    const p = placeAt(at);
    c.position.set(p.x + 60, p.y - 10);
    const glow = new Sprite(softDot());
    glow.anchor.set(0.5);
    glow.tint = 0xff2244;
    glow.blendMode = 'add';
    glow.scale.set(4, 1.8);
    const ring = new Graphics().ellipse(0, 0, 64, 20).stroke({ width: 6, color: 0xff3355 });
    const body = new Sprite(tex);
    body.anchor.set(0.5, 1);
    body.scale.set(170 / Math.max(1, tex.height));
    if (!cid) {
      body.tint = 0x3a1020;
      body.width = 150;
      body.height = 170;
    }
    const label = new Text({
      text: banner ?? `HUNTING ${prey.toUpperCase()}`,
      style: { fontFamily: 'Cinzel', fontWeight: '800', fontSize: 22, fill: preyColour, letterSpacing: 2, stroke: { color: 0x000000, width: 6 } },
    });
    label.anchor.set(0.5, 1);
    label.y = -180;
    label.resolution = 2;
    c.addChild(glow, ring, body, label);
    this.tokenLayer.addChild(c);
    this.hunters.set(id, c);
    gsap.to(glow, { alpha: 0.4, duration: 0.6, yoyo: true, repeat: -1 });
    await this.cam.to({ x: c.x, y: c.y - 80 }, TIER.region, 0.7);
    if (!REDUCED) {
      body.y = -400;
      await done(gsap.to(body, { y: 0, duration: 0.45, ease: 'power3.in' }));
      addTrauma(0.35);
      this.dust.emit(puff(), c.x, c.y, { n: 12, speed: 200, spread: Math.PI, dir: -Math.PI / 2, ttl: 0.8, size: 0.5, grow: 2, tint: 0x8a6a5a, alpha: 0.7, jitter: 40 });
    }
  }
  /** The hunt runs: one hop per place, the camera with it. */
  async stepHunter(id: number, path: number[]): Promise<void> {
    const c = this.hunters.get(id);
    if (!c) return;
    void this.cam.track(c, 'region');
    for (const n of path) {
      const p = placeAt(n);
      const to = { x: p.x + 60, y: p.y - 10 };
      if (REDUCED) c.position.set(to.x, to.y);
      else {
        const body = c.children[2]!;
        await done(
          gsap
            .timeline()
            .to(c, { x: to.x, y: to.y, duration: 0.32, ease: 'sine.inOut' })
            .to(body, { y: -30, duration: 0.16, yoyo: true, repeat: 1, ease: 'sine.out' }, 0),
        );
        this.dust.emit(puff(), to.x, to.y, { n: 4, speed: 80, ttl: 0.5, size: 0.3, grow: 1.6, tint: 0x8a6a5a, alpha: 0.6 });
        this.audio.sfx('step', 0);
      }
    }
    this.cam.track(null);
  }
  /** Rewrite a marker's banner (the world boss's health). */
  setHunterLabel(id: number, text: string): void {
    const t = this.hunters.get(id)?.children[3];
    if (t instanceof Text) t.text = text;
  }
  removeHunter(id: number): void {
    const c = this.hunters.get(id);
    if (!c) return;
    this.hunters.delete(id);
    gsap.killTweensOf(c.children[0]!);
    gsap.to(c, { alpha: 0, duration: 0.4, onComplete: () => c.destroy({ children: true }) });
  }

  // ── Consequences you can SEE (owner: "har cheez saamne hoti hui dikhe") ─────────────────────────────────────────────
  /** A heart shatters over the hero's head: the camera goes to them, the heart cracks and bursts into shards. */
  async heartBreak(seat: number): Promise<void> {
    const f = this.figs.get(seat);
    if (!f || !f.c.visible) return;
    await this.cam.to({ x: f.c.x, y: f.c.y - 90 }, TIER.close, 0.55);
    const h = heartShape(0xff3355);
    h.position.set(f.c.x, f.c.y - 230);
    this.markLayer.addChild(h);
    if (REDUCED) {
      await new Promise((ok) => setTimeout(ok, 600));
      h.destroy();
      return;
    }
    h.scale.set(0.2);
    await done(gsap.to(h.scale, { x: 1.3, y: 1.3, duration: 0.3, ease: 'back.out(3)' }));
    await done(gsap.to(h, { rotation: 0.12, duration: 0.06, yoyo: true, repeat: 5 }));
    addTrauma(0.45);
    this.fxLayer.emit(softDot(), h.x, h.y, { n: 36, speed: 380, ttl: 0.8, size: 0.35, tint: [0xff3355, 0xff8aa0, 0xffffff], gravity: 600 });
    gsap.to(f.body, { x: 10, duration: 0.05, yoyo: true, repeat: 5, onComplete: () => void (f.body.x = 0) });
    h.destroy();
    await new Promise((ok) => setTimeout(ok, 350 / clock.speed));
  }

  /** The land's disaster lands on a hero: the sky darkens over their island, the storm of that land falls, lightning. */
  async disaster(seat: number, colour: string): Promise<void> {
    const f = this.figs.get(seat);
    if (!f || !f.c.visible) return;
    await this.cam.to({ x: f.c.x, y: f.c.y - 80 }, TIER.region, 0.6);
    if (REDUCED) return;
    const dark = new Graphics().rect(f.c.x - 1400, f.c.y - 1200, 2800, 2400).fill({ color: 0x05030a });
    dark.alpha = 0;
    this.world.addChildAt(dark, this.world.getChildIndex(this.tokenLayer));
    gsap.to(dark, { alpha: 0.55, duration: 0.35 });
    const tint = hex(colour);
    for (let i = 0; i < 6; i++)
      setTimeout(() => {
        this.fxLayer.emit(streak(), f.c.x + (Math.random() - 0.5) * 500, f.c.y - 600, { n: 14, speed: 1100, dir: Math.PI / 2 + 0.2, spread: 0.15, ttl: 0.55, size: 1.4, tint: [tint, 0xffffff], alpha: 0.8 });
      }, (i * 120) / clock.speed);
    await new Promise((ok) => setTimeout(ok, 380 / clock.speed));
    this.fxLayer.emit(softDot(), f.c.x, f.c.y - 120, { n: 1, speed: 0, ttl: 0.18, size: 30, tint: 0xffffff, alpha: 0.9 });
    this.audio.sfx('thunder');
    addTrauma(0.6);
    this.fxLayer.emit(softDot(), f.c.x, f.c.y - 60, { n: 40, speed: 420, ttl: 0.7, size: 0.4, tint: [tint, 0xffffff], gravity: 500 });
    await new Promise((ok) => setTimeout(ok, 500 / clock.speed));
    gsap.to(dark, { alpha: 0, duration: 0.6, onComplete: () => dark.destroy() });
  }

  /** A gift (a creature, a relic) rises from the ground into the hero: a column of light. */
  async gift(seat: number, gold = true): Promise<void> {
    const f = this.figs.get(seat);
    if (!f || !f.c.visible || REDUCED) return;
    const tint = gold ? 0xffd36b : 0x9fd3ff;
    for (let i = 0; i < 10; i++)
      setTimeout(() => this.fxLayer.emit(softDot(), f.c.x + (Math.random() - 0.5) * 60, f.c.y, { n: 4, speed: 260, dir: -Math.PI / 2, spread: 0.3, ttl: 0.9, size: 0.4, tint: [tint, 0xffffff] }), (i * 50) / clock.speed);
    gsap.fromTo(f.body.scale, { x: 1, y: 1 }, { x: 1.12, y: 1.12, duration: 0.25, yoyo: true, repeat: 1, ease: 'sine.inOut' });
  }

  // ── The world eats ───────────────────────────────────────────────────────────────────────────────────────────────────
  /** The ground cracks, shakes and falls into the stars; bridges snap; a whole land can tear away (X3). */
  async eat(ids: readonly number[], whole: WorldId | null): Promise<void> {
    await this.omenHeals();
    const pts = ids.map(placeAt);
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    await this.cam.to({ x: cx, y: cy }, whole ? TIER.overview * 1.6 : TIER.region, 0.7);
    this.audio.sfx('quake');
    addTrauma(whole ? 0.75 : 0.45);
    // Cracks first (the setup), then the fall (the event).
    for (const id of ids) {
      const m = this.markers.get(id);
      if (!m) continue;
      m.crack.clear();
      m.crack.visible = true;
      m.crack.alpha = 1;
      m.crack
        .moveTo(-70, -6)
        .lineTo(-30, 6)
        .lineTo(-44, 30)
        .moveTo(-30, 6)
        .lineTo(0, -8)
        .lineTo(24, 12)
        .lineTo(66, 0)
        .stroke({ width: 8, color: 0xffb36b, cap: 'round', join: 'round' });
    }
    await new Promise((ok) => setTimeout(ok, 450 / clock.speed));
    const falls: Promise<void>[] = [];
    ids.forEach((id, i) => {
      const m = this.markers.get(id);
      if (!m) return;
      const p = placeAt(id);
      const chunk = new Container();
      chunk.position.set(p.x, p.y);
      const rock = new Graphics()
        .poly([-80, -14, -44, -40, 0, -34, 50, -42, 84, -8, 40, 70, 0, 120, -46, 64])
        .fill({ color: 0x3a2a24 })
        .poly([-80, -14, -44, -40, 0, -34, 50, -42, 84, -8, 30, 10, -20, 12])
        .fill({ color: 0x5a4a3a });
      chunk.addChild(rock);
      this.markLayer.addChild(chunk);
      m.disc.visible = m.glyph.visible = m.label.visible = m.crack.visible = m.mist.visible = false;
      m.hole.visible = true;
      for (const f of this.figs.values())
        if (Math.hypot(f.c.x - p.x, f.c.y - p.y) < 90) this.markLayer.addChild(chunk);
      const d = 0.08 * i;
      this.dust.emit(puff(), p.x, p.y, {
        n: 12,
        speed: 160,
        ttl: 1.1,
        size: 0.6,
        grow: 2,
        tint: 0x8a7a6a,
        alpha: 0.7,
        jitter: 80,
        gravity: 40,
      });
      this.fxLayer.emit(softDot(), p.x, p.y, {
        n: 18,
        speed: 240,
        ttl: 0.9,
        size: 0.25,
        tint: [0xff7a2f, 0xffd36b],
        gravity: 500,
        dir: -Math.PI / 2,
        spread: Math.PI,
      });
      falls.push(
        done(
          gsap
            .timeline({ delay: d })
            .to(chunk, {
              y: p.y + 900,
              rotation: (Math.random() - 0.5) * 1.6,
              duration: 1.5,
              ease: 'power2.in',
            })
            .to(chunk, { alpha: 0, duration: 0.6 }, 0.9)
            .to(chunk.scale, { x: 0.5, y: 0.5, duration: 1.5, ease: 'power1.in' }, 0)
            .add(() => chunk.destroy({ children: true })),
        ),
      );
    });
    // Bridges and paths that touched the ground snap and fall.
    for (const [k, g] of [...this.roads]) {
      const [a, b] = k.split('-').map(Number);
      if (!ids.includes(a!) && !ids.includes(b!)) continue;
      this.roads.delete(k);
      falls.push(
        done(
          gsap.to(g, { y: 500, alpha: 0, duration: 1.2, ease: 'power2.in', onComplete: () => g.destroy() }),
        ),
      );
    }
    if (whole) {
      const isl = this.islands.get(whole);
      const title = this.titles.get(whole);
      if (isl) {
        this.audio.sfx('quake');
        addTrauma(0.9);
        this.dust.emit(puff(), isl.x, isl.y + 120, {
          n: 40,
          speed: 260,
          ttl: 1.6,
          size: 1.2,
          grow: 2.2,
          tint: 0x6a5a5a,
          alpha: 0.7,
          jitter: 500,
          gravity: 60,
        });
        falls.push(
          done(
            gsap
              .timeline()
              .to(isl, { x: isl.x + 6, duration: 0.05, yoyo: true, repeat: 9 })
              .to(isl, {
                y: isl.y + 1400,
                rotation: (Math.random() - 0.5) * 0.5,
                duration: 2.6,
                ease: 'power2.in',
              })
              .to(isl.scale, { x: 0.6, y: 0.6, duration: 2.6, ease: 'power1.in' }, '<')
              .to(isl, { alpha: 0, duration: 1 }, '-=1'),
          ),
        );
        if (title) gsap.to(title, { alpha: 0, duration: 1 });
      }
    }
    await Promise.all(falls);
    for (const id of ids) if (this.spaces[id]) this.spaces[id]!.void = true;
  }

  // ── The Great Rewire ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** Two lands drift past each other through the void and trade places; whoever stands there floats while the world turns. */
  async rewire(petals: readonly WorldId[], board: readonly Space[]): Promise<void> {
    const moved = petals.map((w, k) => ({ w, k })).filter(({ w, k }) => this.petals[k] !== w);
    await this.overview(1);
    const lifted = [...this.figs.entries()].filter(([s]) => {
      const at = this.at.get(s) ?? -1;
      return at >= 0 && moved.some(({ k }) => slotOf(at).k === k);
    });
    for (const [, f] of lifted) gsap.to(f.body, { y: -70, duration: 0.6, ease: 'power2.out' });
    this.audio.sfx('quake');
    addTrauma(0.5);
    for (const g of this.roads.values()) gsap.to(g, { alpha: 0, duration: 0.5 });
    await Promise.all(
      moved.map(({ w, k }) => {
        const isl = this.islands.get(w)!;
        const t = this.titles.get(w)!;
        const to = islandAt(k);
        const mid = { x: CX + (isl.x + to.x - 2 * CX) * 0.75, y: CY + (isl.y + to.y - 2 * CY) * 0.75 };
        const out = { x: mid.x + (mid.x - CX) * 0.35, y: mid.y + (mid.y - CY) * 0.35 };
        const s = { t: 0 };
        const a = { x: isl.x, y: isl.y };
        gsap.to(t, { x: to.x, y: to.y - 330, duration: 2.6, ease: 'sine.inOut' });
        return done(
          gsap.to(s, {
            t: 1,
            duration: 2.6,
            ease: 'sine.inOut',
            onUpdate: () => {
              const p = onCurve(a, out, to, s.t);
              isl.position.set(p.x, p.y);
              isl.rotation = Math.sin(Math.PI * s.t) * 0.08;
              this.sortIslands();
            },
          }),
        );
      }),
    );
    this.petals = [...petals];
    this.setBoard(board);
    for (const g of this.roads.values()) {
      g.alpha = 0;
      gsap.to(g, { alpha: 1, duration: 0.6 });
    }
    for (const [, f] of lifted) gsap.to(f.body, { y: 0, duration: 0.5, ease: 'bounce.out' });
    await new Promise((ok) => setTimeout(ok, 600 / clock.speed));
  }

  /** The fallen leave the world (a figure dissolves upward as a spirit). */
  async fallen(seat: number): Promise<void> {
    const f = this.figs.get(seat);
    if (!f || !f.c.visible) return;
    await this.cam.to({ x: f.c.x, y: f.c.y - 60 }, TIER.close, 0.6);
    this.fxLayer.emit(softDot(), f.c.x, f.c.y - 100, {
      n: 40,
      speed: 120,
      ttl: 1.6,
      size: 0.4,
      tint: [0xb9c7ff, 0xffffff],
      gravity: -160,
      jitter: 60,
    });
    await done(gsap.to(f.c, { alpha: 0, y: f.c.y - 120, duration: 1.4, ease: 'power1.in' }));
    f.c.alpha = 1;
    this.out.add(seat);
    this.layoutFigures(0);
  }

  // ── THE FALL: the match opens by falling into the game ──────────────────────────────────────────────────────────────
  /** The camera dives into the game board on the table, through the clouds; the world opens below; each hero drops from the sky
   *  onto their first place. Then the eye goes to the fire (the goal) and back (StS: show the destination first). */
  async fall(names: string[], ps: { seat: number; at: number }[], skip: () => boolean): Promise<void> {
    const sw = app.screen.width;
    const sh = app.screen.height;
    const table =
      this.landTex.get('scene-table') ??
      (await Assets.load<Texture>(`${ART}scene-table.webp`).catch(() => null));
    const top = new Container();
    app.stage.addChild(top);
    const clouds: Sprite[] = [];
    for (let i = 0; i < 26; i++) {
      const c = new Sprite(puff());
      c.anchor.set(0.5);
      c.tint = i % 3 ? 0xe9e2f5 : 0xcfc2e4;
      c.position.set(Math.random() * sw, Math.random() * sh);
      c.scale.set((Math.max(sw, sh) / 256) * (0.55 + Math.random() * 0.5));
      c.alpha = 0;
      clouds.push(c);
      top.addChild(c);
    }
    for (const f of this.figs.values()) f.c.visible = false;
    this.cam.snap({ x: CX, y: CY }, 0.9);
    if (table && !REDUCED) {
      const t = new Sprite(table);
      t.anchor.set(0.5);
      t.position.set(sw / 2, sh / 2);
      const s0 = Math.max(sw / table.width, sh / table.height);
      t.scale.set(s0);
      top.addChildAt(t, 0);
      this.audio.sfx('whoosh');
      const tl = gsap.timeline();
      tl.to(t.scale, { x: s0 * 9, y: s0 * 9, duration: 2.2, ease: 'expo.in' }, 0);
      tl.to(t, { rotation: 0.5, duration: 2.2, ease: 'power2.in' }, 0);
      clouds.forEach((c, i) => tl.to(c, { alpha: 0.95, duration: 0.7 }, 1.2 + i * 0.02));
      tl.to(t, { alpha: 0, duration: 0.4 }, 1.9);
      await done(tl);
      t.destroy();
    } else for (const c of clouds) c.alpha = 0.95;
    // Through the clouds: they part outward and the world opens below (feel-v8 verdict 5: clouds part, never fade).
    this.audio.sfx('portal');
    const part = gsap.timeline();
    clouds.forEach((c) => {
      const dx = c.x - sw / 2;
      const dy = c.y - sh / 2;
      const d = Math.max(1, Math.hypot(dx, dy));
      part.to(
        c,
        { x: c.x + (dx / d) * sw, y: c.y + (dy / d) * sh, alpha: 0, duration: 1.6, ease: 'power2.in' },
        Math.random() * 0.3,
      );
      part.to(c.scale, { x: c.scale.x * 2, y: c.scale.y * 2, duration: 1.6, ease: 'power1.in' }, '<');
    });
    this.cam.snap({ x: CX, y: CY }, 0.75);
    void this.cam.to({ x: CX, y: CY }, 1.05, 2.2);
    await done(part);
    top.destroy({ children: true });
    if (skip()) return this.landAll(ps);
    // The destination first: the Burning Heart.
    await this.cam.to({ x: CX, y: CY - 160 }, TIER.region, 1.4);
    this.setHeat(0.15);
    this.banner.innerHTML = `<b style="color:#ffd36b">${HEART_NAME.toUpperCase()}</b><small>Every land meets here. It throws you somewhere random</small>`;
    this.banner.classList.add('on');
    await new Promise((ok) => setTimeout(ok, 1500 / clock.speed));
    this.banner.classList.remove('on');
    // Each hero drops from the sky onto their first place.
    for (const p of ps) {
      if (skip()) break;
      await this.drop(p.seat, p.at, names[p.seat]!);
    }
    this.landAll(ps);
  }

  private landAll(ps: { seat: number; at: number }[]): void {
    for (const p of ps) {
      this.at.set(p.seat, p.at);
      const f = this.figs.get(p.seat);
      if (f) {
        gsap.killTweensOf(f.c);
        f.c.alpha = 1;
        f.body.y = 0;
        f.body.scale.set(1);
      }
    }
    this.layoutFigures(0);
    this.hideBanner();
  }

  private async drop(seat: number, at: number, name: string): Promise<void> {
    const f = this.figs.get(seat);
    if (!f) return;
    this.at.set(seat, at);
    const p = this.spot(seat, at);
    await this.cam.to({ x: p.x, y: p.y - 80 }, TIER.region, 0.8);
    f.c.visible = true;
    f.c.position.set(p.x, p.y);
    if (!REDUCED) {
      f.body.y = -900;
      f.shadow.scale.set(0.2);
      this.audio.sfx('whoosh');
      await done(
        gsap
          .timeline()
          .to(f.body, { y: 0, duration: 0.55, ease: 'power3.in' })
          .to(f.shadow.scale, { x: 1, y: 1, duration: 0.55, ease: 'power3.in' }, 0),
      );
      this.audio.sfx('slam');
      addTrauma(0.4);
      this.dust.emit(puff(), p.x, p.y, {
        n: 14,
        speed: 220,
        spread: Math.PI,
        dir: -Math.PI / 2,
        ttl: 0.9,
        size: 0.55,
        grow: 2,
        tint: 0xb59a7a,
        alpha: 0.75,
        jitter: 50,
        gravity: 40,
      });
      gsap.fromTo(
        f.body.scale,
        { x: 1.3, y: 0.7 },
        { x: 1, y: 1, duration: 0.45, ease: 'elastic.out(1, 0.45)' },
      );
    }
    const s = this.spaces[at];
    if (s) {
      this.banner.innerHTML = `<b style="color:${f.colour}">${esc(name)}</b><small>lands at ${esc(placeName(s))}</small>`;
      this.banner.classList.remove('on');
      void this.banner.offsetWidth;
      this.banner.classList.add('on');
    }
    await new Promise((ok) => setTimeout(ok, 750 / clock.speed));
  }

  // ── Life: every land breathes, out of step (feel-v8 verdict 8) ──────────────────────────────────────────────────────
  private acc = new Map<string, number>();
  private life(dt: number): void {
    this.skyTick();
    // Titles of the lands show from afar and fade as the camera comes close.
    const a = Math.max(0, Math.min(1, (1.45 - this.cam.z) / 0.35));
    this.titleLayer.alpha = a;
    // Place labels read only up close.
    const la = Math.max(0, Math.min(1, (this.cam.z - 2.5) / 0.5));
    for (const m of this.markers.values()) m.label.alpha = la;
    if (REDUCED) return;
    const every = (key: string, secs: number, fn: () => void) => {
      const v = (this.acc.get(key) ?? Math.random() * secs) + dt;
      if (v >= secs) {
        fn();
        this.acc.set(key, v - secs);
      } else this.acc.set(key, v);
    };
    this.petals.forEach((w, k) => {
      const isl = this.islands.get(w);
      if (!isl || isl.alpha < 0.5) return;
      const c = islandAt(k);
      const rx = ISLAND_W * 0.42;
      const rnd = () => ({
        x: c.x + (Math.random() - 0.5) * rx * 2,
        y: c.y + (Math.random() - 0.5) * rx * 1.1 - 40,
      });
      switch (w) {
        case 'india':
          every(`r${w}`, 0.05, () => {
            const p = rnd();
            this.lifeBack.emit(streak(), p.x, p.y - 200, {
              n: 1,
              speed: 700,
              spread: 0.05,
              dir: Math.PI / 2 + 0.15,
              ttl: 0.45,
              size: 0.9,
              tint: 0x9fc4e8,
              alpha: 0.35,
            });
          });
          break;
        case 'olympus':
          every(`m${w}`, 0.25, () => {
            const p = rnd();
            this.lifeBack.emit(softDot(), p.x, p.y, {
              n: 1,
              speed: 30,
              dir: -Math.PI / 2,
              spread: 0.6,
              ttl: 3,
              size: 0.25,
              tint: 0xffe08a,
              alpha: 0.7,
            });
          });
          every(`l${w}`, 7 + Math.random() * 4, () => {
            this.lifeBack.emit(softDot(), c.x, c.y - 120, {
              n: 1,
              speed: 0,
              ttl: 0.25,
              size: 14,
              tint: 0xdfe8ff,
              alpha: 0.55,
            });
            this.audio.sfx('thunder');
          });
          break;
        case 'cosmos':
          every(`s${w}`, 0.15, () => {
            const p = rnd();
            this.lifeBack.emit(softDot(), p.x, p.y, {
              n: 1,
              speed: 20,
              ttl: 2.2,
              size: 0.18,
              tint: [0xa77bf0, 0x7fd8ff, 0xffffff],
              alpha: 0.9,
            });
          });
          every(`c${w}`, 5, () => {
            const p = rnd();
            this.lifeBack.emit(streak(), p.x - 200, p.y - 200, {
              n: 1,
              speed: 900,
              spread: 0,
              dir: Math.PI / 4,
              ttl: 0.6,
              size: 1.6,
              tint: 0xd9c7ff,
              alpha: 0.8,
            });
          });
          break;
        case 'pirate':
          every(`p${w}`, 0.3, () => {
            const p = rnd();
            this.dust.emit(puff(), p.x, p.y + 60, {
              n: 1,
              speed: 40,
              dir: -Math.PI / 2,
              spread: 1,
              ttl: 1.4,
              size: 0.3,
              grow: 1.8,
              tint: 0xd8f2ee,
              alpha: 0.35,
            });
          });
          break;
        case 'night':
          every(`f${w}`, 0.2, () => {
            const p = rnd();
            this.lifeBack.emit(softDot(), p.x, p.y, {
              n: 1,
              speed: 25,
              ttl: 3,
              size: 0.2,
              tint: [0xe8ff9a, 0xb9c7ff],
              alpha: 0.95,
            });
          });
          break;
        case 'lost':
          every(`n${w}`, 0.08, () => {
            const p = rnd();
            this.lifeBack.emit(softDot(), p.x, p.y - 160, {
              n: 1,
              speed: 60,
              dir: Math.PI / 2,
              spread: 0.6,
              ttl: 3,
              size: 0.12,
              tint: 0xffffff,
              alpha: 0.85,
            });
          });
          break;
        case 'toon':
          every(`b${w}`, 0.35, () => {
            const p = rnd();
            this.lifeBack.emit(softDot(), p.x, p.y, {
              n: 1,
              speed: 50,
              dir: -Math.PI / 2,
              spread: 0.5,
              ttl: 2.6,
              size: 0.15,
              grow: 2.5,
              tint: [0xff96b8, 0x7fe0ff, 0xfff27f],
              alpha: 0.6,
            });
          });
          break;
        case 'wild':
          every(`w${w}`, 0.22, () => {
            const p = rnd();
            this.lifeBack.emit(softDot(), p.x, p.y, {
              n: 1,
              speed: 22,
              ttl: 2.6,
              size: 0.18,
              tint: [0x9cff7a, 0xd9ff8a],
              alpha: 0.9,
            });
          });
          break;
      }
    });
    // The Heart: embers rise, more as the clock runs.
    every('embers', Math.max(0.03, 0.12 - this.heat * 0.08), () => {
      this.fxLayer.emit(softDot(), CX + (Math.random() - 0.5) * 120, CY - 170, {
        n: 1,
        speed: 160 + this.heat * 140,
        dir: -Math.PI / 2,
        spread: 0.7,
        ttl: 1.8,
        size: 0.22,
        tint: [0xff7a2f, 0xffd36b, 0xff4d2f],
        gravity: -40,
      });
    });
    every('smoke', 0.4, () => {
      this.dust.emit(puff(), CX + (Math.random() - 0.5) * 80, CY - 230, {
        n: 1,
        speed: 50,
        dir: -Math.PI / 2,
        spread: 0.4,
        ttl: 4,
        size: 0.8,
        grow: 3,
        tint: 0x3a3036,
        alpha: 0.4,
      });
    });
    // Unseen mist drifts.
    const t = performance.now() / 1000;
    for (const [id, m] of this.markers)
      if (m.mist.visible && m.mist.alpha > 0.5) m.mist.x = Math.sin(t * 0.4 + id) * 10;
  }

  /** World units (tests, debugging). */
  static readonly size = { W, H };
}

/** A heart drawn in Pixi (two lobes and a point, a crack down the middle). */
function heartShape(colour: number): Graphics {
  const g = new Graphics();
  g.moveTo(0, 30).bezierCurveTo(-70, -10, -40, -70, 0, -34).bezierCurveTo(40, -70, 70, -10, 0, 30).fill({ color: colour });
  g.moveTo(0, 30).bezierCurveTo(-70, -10, -40, -70, 0, -34).bezierCurveTo(40, -70, 70, -10, 0, 30).stroke({ width: 5, color: 0x2a0008 });
  g.moveTo(-6, -30).lineTo(6, -6).lineTo(-4, 6).lineTo(4, 26).stroke({ width: 4, color: 0x2a0008 });
  return g;
}

/** The glyph of what a place holds (drawn, never emoji). */
function drawGlyph(g: Graphics, c: Content | 'sealed'): void {
  if (c === 'sealed') {
    // v10: every place is sealed until you stand on it: a wax seal with a question mark.
    g.circle(0, 0, 22).fill({ color: 0x2a1840, alpha: 0.9 }).stroke({ width: 4, color: 0xd1ad62 });
    g.moveTo(-7, -7).bezierCurveTo(-7, -17, 9, -17, 9, -7).bezierCurveTo(9, 0, 1, 0, 1, 7).stroke({ width: 4.5, color: 0xffd36b, cap: 'round' });
    g.circle(1, 14, 2.8).fill({ color: 0xffd36b });
    return;
  }
  const col = GLYPH_COLOUR[c];
  const st = { width: 6, color: col, cap: 'round', join: 'round' } as const;
  switch (c) {
    case 'lair':
      g.moveTo(-18, 14).lineTo(-8, -14).moveTo(0, 16).lineTo(0, -18).moveTo(18, 14).lineTo(8, -14).stroke(st);
      break;
    case 'disaster':
      g.poly([4, -22, -12, 4, 0, 4, -6, 22, 14, -6, 2, -6]).fill({ color: col });
      break;
    case 'riddle':
      g.moveTo(-14, 18).lineTo(-14, -4).arc(0, -4, 14, Math.PI, 0).lineTo(14, 18).closePath().stroke(st);
      g.circle(5, 6, 2.5).fill({ color: col });
      break;
    case 'cache':
      g.roundRect(-18, -8, 36, 22, 3)
        .stroke(st)
        .moveTo(-18, -8)
        .lineTo(-14, -18)
        .lineTo(14, -18)
        .lineTo(18, -8)
        .stroke(st);
      g.circle(0, 2, 3).fill({ color: col });
      break;
    case 'gate':
      g.moveTo(0, -30)
        .bezierCurveTo(16, -12, 22, 6, 0, 24)
        .bezierCurveTo(-22, 6, -16, -12, 0, -30)
        .fill({ color: 0xff7a2f })
        .stroke({ width: 4, color: col });
      break;
    case 'nest':
      // A nest of twigs with three eggs (the Wild Nest).
      g.ellipse(0, 8, 22, 10).stroke(st);
      g.circle(-8, 0, 6).fill({ color: col }).circle(8, 0, 6).fill({ color: col }).circle(0, -6, 6).fill({ color: col });
      break;
    case 'hilo':
      // The Oracle's Ladder: three rising rungs and an arrow.
      g.moveTo(-14, 20).lineTo(-14, -20).moveTo(14, 20).lineTo(14, -20).stroke(st);
      g.moveTo(-14, 8).lineTo(14, 8).moveTo(-14, -6).lineTo(14, -6).stroke({ ...st, width: 4 });
      break;
    case 'tame':
      // A lone beast: one paw.
      g.ellipse(0, 8, 11, 9).fill({ color: col });
      g.circle(-13, -6, 5).fill({ color: col }).circle(-4, -14, 5).fill({ color: col }).circle(6, -14, 5).fill({ color: col }).circle(14, -6, 5).fill({ color: col });
      break;
    case 'altar':
      // An altar with a flame.
      g.roundRect(-18, 4, 36, 14, 2).stroke(st);
      g.moveTo(0, -20).bezierCurveTo(10, -10, 8, 0, 0, 2).bezierCurveTo(-8, 0, -10, -10, 0, -20).fill({ color: col });
      break;
    case 'trader':
      // The Masked Trader: a mask.
      g.moveTo(-20, -8).bezierCurveTo(-18, 14, 18, 14, 20, -8).bezierCurveTo(8, -14, -8, -14, -20, -8).fill({ color: col });
      g.ellipse(-8, -2, 4, 3).fill({ color: 0x17111c }).ellipse(8, -2, 4, 3).fill({ color: 0x17111c });
      break;
    case 'empty':
      // A chance card waits here (v9: every place deals something).
      g.roundRect(-13, -18, 26, 36, 4).fill({ color: 0x2a1840, alpha: 0.9 }).stroke({ width: 4, color: col });
      g.poly([0, -9, 7, 0, 0, 9, -7, 0]).fill({ color: col });
      break;
  }
}
