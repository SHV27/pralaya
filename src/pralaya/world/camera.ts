/**
 * The camera (camera-systems + feel-v8 verdict 1): it belongs to the hero whose turn it is. Three tiers only (overview, region,
 * close); a short follow eases at rate 12/s (95% in ~250 ms, frame-rate independent); a far move zooms out, travels and zooms in
 * (van Wijk–Nuij, so the eye never loses where it is); the view never leaves the world; shake is added last, on top.
 */
import type { Container } from 'pixi.js';
import { gsap } from 'gsap';
import { REDUCED } from '../../play/anim.ts';
import { app, fx } from './gfx.ts';
import { CX, CY, H, TIER, W, clampCentre, fitZoom, type Pt, type Tier } from './layout.ts';

export class Camera {
  x = CX;
  y = CY;
  /** Zoom as a multiple of the fit-the-world zoom. */
  z = 1;
  private follow: Container | null = null;
  private rate = 12;
  private flying: gsap.core.Animation | null = null;
  /** Whoever awaits the flight in progress (a newer flight replaces it: the old await must still end). */
  private landed: (() => void) | null = null;
  private world: Container;

  constructor(world: Container) {
    this.world = world;
    app.ticker.add((t) => this.tick(Math.min(t.deltaMS, 50) / 1000));
  }

  /** The zoom that fits the whole world (the overview). */
  get base(): number {
    return fitZoom(app.screen.width, app.screen.height, W, H, 0.98);
  }

  private tick(dt: number): void {
    if (this.follow && !this.flying) {
      const k = 1 - Math.exp(-this.rate * dt);
      // Look slightly above the figure (the hero stands in the lower third: room to see where they go).
      this.x += (this.follow.x - this.x) * k;
      this.y += (this.follow.y - 40 - this.y) * k;
    }
    this.apply();
  }

  apply(): void {
    const sw = app.screen.width;
    const sh = app.screen.height;
    const z = this.base * this.z;
    const c = clampCentre(this.x, this.y, z, sw, sh);
    this.world.scale.set(z);
    this.world.position.set(sw / 2 - c.x * z + fx.shakeX, sh / 2 - c.y * z + fx.shakeY);
  }

  /** Follow a figure at a tier (the walk). */
  track(target: Container | null, tier: Tier = 'close'): Promise<void> {
    this.follow = target;
    if (!target) return Promise.resolve();
    return this.to({ x: target.x, y: target.y - 40 }, TIER[tier], 0.7, true);
  }

  /** Fly to a point at a zoom (multiple of the fit zoom). Far trips zoom out first. */
  to(p: Pt, z: number, secs = 0.8, keepFollow = false): Promise<void> {
    if (!keepFollow) this.follow = null;
    this.flying?.kill();
    this.landed?.();
    this.landed = null;
    if (REDUCED) {
      this.x = p.x;
      this.y = p.y;
      this.z = z;
      this.flying = null;
      return Promise.resolve();
    }
    const sw = app.screen.width / (this.base * Math.min(this.z, z));
    const far = Math.hypot(p.x - this.x, p.y - this.y) > sw * 0.9;
    const tl = gsap.timeline({ onComplete: () => void (this.flying = null) });
    if (far) {
      const mid = Math.max(1, Math.min(this.z, z) * 0.55);
      tl.to(this, { z: mid, duration: secs * 0.45, ease: 'power2.inOut' })
        .to(this, { x: p.x, y: p.y, duration: secs * 0.9, ease: 'power2.inOut' }, secs * 0.15)
        .to(this, { z, duration: secs * 0.55, ease: 'expo.out' }, secs * 0.7);
    } else tl.to(this, { x: p.x, y: p.y, z, duration: secs, ease: 'expo.out' });
    this.flying = tl;
    return new Promise((ok) => {
      this.landed = ok;
      tl.eventCallback('onComplete', () => {
        this.flying = null;
        this.landed = null;
        ok();
      });
    });
  }

  /** Frame a rectangle (every choice on screen at once). */
  frame(b: { x: number; y: number; w: number; h: number }, secs = 0.8, cap = 3): Promise<void> {
    const z = Math.min(cap, fitZoom(app.screen.width, app.screen.height * 0.78, b.w, b.h, 0.92) / this.base);
    return this.to({ x: b.x, y: b.y + 30 }, Math.max(1, z), secs);
  }

  overview(secs = 1): Promise<void> {
    return this.to({ x: CX, y: CY }, 1, secs);
  }

  snap(p: Pt, z: number): void {
    this.flying?.kill();
    this.landed?.();
    this.landed = null;
    this.flying = null;
    this.x = p.x;
    this.y = p.y;
    this.z = z;
    this.apply();
  }
}
