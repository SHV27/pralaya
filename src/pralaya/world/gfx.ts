/**
 * The renderer core (tech-map-v8): one PixiJS application behind the DOM HUD, ticked by GSAP so tweens and frames share one
 * clock; ?speed=N scales both. Trauma shake (shake = trauma², smooth noise, decays), real-time hit-stop, a pooled additive
 * particle system, and the procedural textures (soft dot, cloud puff, spark) every layer shares.
 */
import { Application, Container, Particle, ParticleContainer, Texture } from 'pixi.js';
import { gsap } from 'gsap';
import { REDUCED, clock } from '../../play/anim.ts';

export let app: Application;
export const fx = { trauma: 0, timeScale: 1, shakeX: 0, shakeY: 0 };

export async function initGfx(host: HTMLElement): Promise<Application> {
  if (app) {
    host.prepend(app.canvas);
    return app;
  }
  app = new Application();
  await app.init({
    resizeTo: window,
    preference: 'webgl',
    antialias: true,
    background: '#07050c',
    resolution: Math.min(devicePixelRatio || 1, 1.5),
    autoDensity: true,
    accessibilityOptions: { activateOnTab: false },
  } as never);
  app.canvas.classList.add('world-canvas');
  host.prepend(app.canvas);
  // Pixi keeps its own frame loop (GSAP's ticker sleeps when no tween runs, which would freeze the world's life).
  // The review hook ?speed=N scales every tween.
  gsap.globalTimeline.timeScale(clock.speed);
  app.ticker.add((t) => {
    fx.trauma = Math.max(0, fx.trauma - (1.4 * t.deltaMS) / 1000);
    const amp = REDUCED ? 0 : 22 * fx.trauma * fx.trauma;
    const s = performance.now() / 1000;
    fx.shakeX = amp * Math.sin(s * 47.3) * Math.cos(s * 13.1);
    fx.shakeY = amp * Math.sin(s * 39.1 + 1.7);
  });
  return app;
}

/** Feel tiers (game-feel): small 0.2 · medium 0.45 · large 0.8. Shake rides on top of the camera, never moves the world. */
export const addTrauma = (a: number): void => {
  fx.trauma = Math.min(1, fx.trauma + a);
};

/** Freeze every tween for a few REAL milliseconds (the impact frame). */
export function hitStop(ms: number): Promise<void> {
  if (REDUCED) return Promise.resolve();
  gsap.globalTimeline.timeScale(0.0001);
  fx.timeScale = 0;
  return new Promise((ok) =>
    setTimeout(() => {
      gsap.globalTimeline.timeScale(clock.speed);
      fx.timeScale = 1;
      ok();
    }, ms),
  );
}

/** Await a GSAP timeline/tween as a promise. */
export const done = (t: gsap.core.Animation): Promise<void> =>
  new Promise((ok) => {
    // A killed tween never completes: resolve on interrupt too, or whoever awaits it waits forever.
    t.eventCallback('onComplete', () => ok());
    t.eventCallback('onInterrupt', () => ok());
  });

// ── Procedural textures ──────────────────────────────────────────────────────────────────────────────────────────────
const cache = new Map<string, Texture>();
function canvasTex(
  key: string,
  size: number,
  draw: (g: CanvasRenderingContext2D, s: number) => void,
): Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = Texture.from(c);
  cache.set(key, t);
  return t;
}
/** A soft round dot (glows, motes, fireflies, light cookies). */
export const softDot = (): Texture =>
  canvasTex('dot', 64, (g, s) => {
    const r = s / 2;
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });
/** A cloud puff: several soft lobes (mist, dust, smoke). */
export const puff = (): Texture =>
  canvasTex('puff', 256, (g, s) => {
    const lobes = [
      [0.5, 0.55, 0.36],
      [0.32, 0.6, 0.26],
      [0.68, 0.6, 0.27],
      [0.42, 0.42, 0.24],
      [0.6, 0.44, 0.22],
    ];
    for (const [x, y, r] of lobes) {
      const gr = g.createRadialGradient(x! * s, y! * s, 0, x! * s, y! * s, r! * s);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)');
      gr.addColorStop(0.6, 'rgba(255,255,255,0.28)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    }
  });
/** A thin streak (rain, sparks in flight). */
export const streak = (): Texture =>
  canvasTex('streak', 64, (g, s) => {
    const gr = g.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(255,255,255,0.9)');
    g.fillStyle = gr;
    g.fillRect(s / 2 - 1.5, 0, 3, s);
  });
/** A vignette for the whole screen (multiply-dark corners, candle-warm centre). */
export const vignette = (): Texture =>
  canvasTex('vig', 512, (g, s) => {
    const r = s / 2;
    const gr = g.createRadialGradient(r, r * 0.95, r * 0.35, r, r, r * 1.05);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.7, 'rgba(0,0,0,0.25)');
    gr.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });

// ── Particles (one pooled additive system per layer) ───────────────────────────────────────────────────────────────────
interface Live {
  p: Particle;
  vx: number;
  vy: number;
  g: number;
  life: number;
  ttl: number;
  s0: number;
  s1: number;
  spin: number;
  fade: number;
}
export class Sparks {
  readonly view: ParticleContainer;
  private live: Live[] = [];
  private pool: Particle[] = [];
  constructor(blend: 'add' | 'normal' = 'add') {
    this.view = new ParticleContainer({
      dynamicProperties: { position: true, rotation: true, color: true, vertex: true },
    });
    this.view.blendMode = blend;
    app.ticker.add((t) => this.tick((t.deltaMS / 1000) * fx.timeScale));
  }
  emit(
    tex: Texture,
    x: number,
    y: number,
    o: {
      n: number;
      speed?: number;
      spread?: number;
      dir?: number;
      gravity?: number;
      ttl?: number;
      size?: number;
      grow?: number;
      tint?: number | number[];
      alpha?: number;
      spin?: number;
      jitter?: number;
    },
  ): void {
    const tints = Array.isArray(o.tint) ? o.tint : [o.tint ?? 0xffffff];
    for (let i = 0; i < o.n; i++) {
      const p = this.pool.pop() ?? new Particle(tex);
      p.texture = tex;
      p.anchorX = p.anchorY = 0.5;
      const j = o.jitter ?? 0;
      p.x = x + (Math.random() - 0.5) * j;
      p.y = y + (Math.random() - 0.5) * j;
      p.tint = tints[i % tints.length]!;
      p.alpha = o.alpha ?? 1;
      p.rotation = Math.random() * Math.PI * 2;
      const size = (o.size ?? 0.4) * (0.6 + Math.random() * 0.8);
      p.scaleX = p.scaleY = size;
      const a = (o.dir ?? 0) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
      const v = (o.speed ?? 200) * (0.35 + Math.random() * 0.65);
      this.live.push({
        p,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        g: o.gravity ?? 0,
        life: 0,
        ttl: (o.ttl ?? 0.8) * (0.6 + Math.random() * 0.6),
        s0: size,
        s1: size * (o.grow ?? 1),
        spin: (Math.random() - 0.5) * (o.spin ?? 0),
        fade: o.alpha ?? 1,
      });
      this.view.addParticle(p);
    }
  }
  private tick(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const q = this.live[i]!;
      q.life += dt;
      if (q.life >= q.ttl) {
        this.view.removeParticle(q.p);
        this.pool.push(q.p);
        this.live.splice(i, 1);
        continue;
      }
      const k = q.life / q.ttl;
      q.vy += q.g * dt;
      q.vx *= 1 - 0.8 * dt;
      q.p.x += q.vx * dt;
      q.p.y += q.vy * dt;
      q.p.rotation += q.spin * dt;
      q.p.scaleX = q.p.scaleY = q.s0 + (q.s1 - q.s0) * k;
      q.p.alpha = q.fade * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
    }
  }
}

/** A container that ignores pointer events and culls itself (decoration layers). */
export function layer(name: string): Container {
  const c = new Container();
  c.label = name;
  c.interactiveChildren = false;
  return c;
}
