/**
 * The particle layer: one full-screen canvas above the board and below the HUD — dust from slams, embers from the storm, gold
 * motes from a tame, glass from a shattered heart, the curse's green sparks. ≤ 300 particles; render only while something lives.
 * Plus trauma shake (rassi-juice #3) applied to the board only, never the text.
 */
import { REDUCED } from './anim.ts';

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  g: number;
  drag: number;
  kind: 'dot' | 'shard' | 'glow';
  rot: number;
  vr: number;
}

export class Fx {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly ps: P[] = [];
  private raf = 0;
  private last = 0;
  private trauma = 0;
  private shakeTarget: HTMLElement | null = null;
  /** Ambient embers (the storm) per second. */
  ambient = 0;
  ambientColor = '#ff7a3d';

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    const fit = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    addEventListener('resize', fit);
  }

  shakeOn(el: HTMLElement): void {
    this.shakeTarget = el;
  }

  shake(amount: number): void {
    if (REDUCED) return;
    this.trauma = Math.min(1, this.trauma + amount);
    this.kick();
  }

  burst(
    x: number,
    y: number,
    opts: {
      n?: number;
      color?: string | string[];
      speed?: number;
      up?: number;
      g?: number;
      size?: number;
      life?: number;
      kind?: P['kind'];
      spread?: number;
    } = {},
  ): void {
    const n = Math.min(opts.n ?? 24, 300 - this.ps.length);
    const colors = Array.isArray(opts.color) ? opts.color : [opts.color ?? '#f2e6cc'];
    for (let i = 0; i < n; i++) {
      const a =
        Math.random() * Math.PI * 2 * (opts.spread ?? 1) - (opts.spread ? Math.PI * (opts.spread - 0.5) : 0);
      const v = (opts.speed ?? 260) * (0.35 + Math.random() * 0.75);
      const life = (opts.life ?? 0.8) * (0.6 + Math.random() * 0.6);
      this.ps.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - (opts.up ?? 0),
        life,
        max: life,
        size: (opts.size ?? 4) * (0.6 + Math.random() * 0.8),
        color: colors[i % colors.length]!,
        g: opts.g ?? 420,
        drag: 0.9,
        kind: opts.kind ?? 'dot',
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 12,
      });
    }
    this.kick();
  }

  private kick(): void {
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
  }

  setAmbient(perSec: number, color = '#ff7a3d'): void {
    this.ambient = REDUCED ? 0 : perSec;
    this.ambientColor = color;
    if (perSec) this.kick();
  }

  private frame(t: number): void {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const c = this.ctx;
    c.clearRect(0, 0, innerWidth, innerHeight);
    if (this.ambient && Math.random() < this.ambient * dt && this.ps.length < 200) {
      this.burst(Math.random() * innerWidth, innerHeight + 10, {
        n: 1,
        color: [this.ambientColor, '#ffd27a'],
        speed: 30,
        up: 120,
        g: -20,
        size: 3,
        life: 3.5,
        kind: 'glow',
      });
    }
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.ps.splice(i, 1);
        continue;
      }
      p.vx *= p.drag ** (dt * 10);
      p.vy = p.vy * p.drag ** (dt * 10) + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const k = p.life / p.max;
      c.globalAlpha = Math.min(1, k * 1.6);
      c.fillStyle = p.color;
      if (p.kind === 'glow') {
        c.shadowColor = p.color;
        c.shadowBlur = 12;
        c.beginPath();
        c.arc(p.x, p.y, p.size * k, 0, Math.PI * 2);
        c.fill();
        c.shadowBlur = 0;
      } else if (p.kind === 'shard') {
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.beginPath();
        c.moveTo(0, -p.size * 1.6);
        c.lineTo(p.size, p.size);
        c.lineTo(-p.size, p.size * 0.6);
        c.closePath();
        c.fill();
        c.restore();
      } else {
        c.beginPath();
        c.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;
    // Trauma shake: offset = trauma², decays linearly; only the board moves.
    if (this.shakeTarget) {
      if (this.trauma > 0) {
        this.trauma = Math.max(0, this.trauma - 1.3 * dt);
        const s = this.trauma * this.trauma;
        const max = innerWidth < 700 ? 12 : 22;
        this.shakeTarget.style.translate = `${((Math.random() * 2 - 1) * max * s).toFixed(1)}px ${((Math.random() * 2 - 1) * max * s).toFixed(1)}px`;
        this.shakeTarget.style.rotate = `${((Math.random() * 2 - 1) * 2.5 * s).toFixed(2)}deg`;
      } else {
        this.shakeTarget.style.translate = '';
        this.shakeTarget.style.rotate = '';
      }
    }
    if (this.ps.length || this.trauma > 0 || this.ambient)
      this.raf = requestAnimationFrame((tt) => this.frame(tt));
    else {
      this.raf = 0;
      c.clearRect(0, 0, innerWidth, innerHeight);
    }
  }
}
