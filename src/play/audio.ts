/**
 * The sound of the cursed game (owner #18 "Jumanji drums"): procedural Web Audio drums whose tempo and density ARE the tension,
 * plus synthesized stings and creature grunts. No samples, no licences. Browsers block audio until a key or tap: `unlock()`.
 * Drum moods: calm (the board) · hunt (a creature is out) · pick (accelerates with the 15 s timer) · storm · silent (the beat
 * before every reveal: silence is the loudest drum).
 */
export type Mood = 'off' | 'calm' | 'hunt' | 'pick' | 'storm' | 'silent';
export type Sfx =
  | 'card'
  | 'flip'
  | 'step'
  | 'fog'
  | 'slam'
  | 'whoosh'
  | 'tick'
  | 'count'
  | 'win'
  | 'tame'
  | 'heart'
  | 'shatter'
  | 'standoff'
  | 'item'
  | 'portal'
  | 'trap'
  | 'steal'
  | 'swap'
  | 'omen'
  | 'quake'
  | 'thunder'
  | 'crown'
  | 'ko'
  | 'choose'
  | 'reveal';
export type Grunt =
  'roar' | 'hiss' | 'chomp' | 'stomp' | 'bark' | 'coo' | 'rumble' | 'bones' | 'wave' | 'dragon' | 'suck';

/** 16-step djembe patterns: B bass (low, open palm), T tone, S slap, '.' rest. */
const PATTERN: Record<Exclude<Mood, 'off' | 'silent'>, { bpm: number; voices: string[] }> = {
  calm: { bpm: 84, voices: ['B.......B.....T.', '....S.......S...'] },
  hunt: { bpm: 104, voices: ['B..B....B..B..T.', '....S..T....S.TT', 'k.k.k.k.k.k.k.k.'] },
  pick: { bpm: 112, voices: ['B..B..B.B..B..B.', '..S...S...S..SSS', 'kkkkkkkkkkkkkkkk'] },
  storm: { bpm: 138, voices: ['B.BB..B.B.BB..BB', '..S.SS..S.S.SSTT', 'kkkkkkkkkkkkkkkk'] },
};

const Audio_ = window.Audio;
/**
 * THE ANTHEM (owner v10: "custom song… proper chaotic music"; v12: "jo gaana last mein aa raha tha wo throughout the game chalta
 * rahe"): a sung song in src/assets/anthem.*. It plays through the WHOLE match: full in the lobby, the Last Stand and the crown, and
 * as a lower bed under play (voices at the table stay audible; the procedural drums step aside so two tempos never fight).
 */
const ANTHEM = Object.values(import.meta.glob('../assets/anthem.{mp3,ogg,wav}', { query: '?url', import: 'default', eager: true }))[0] as
  | string
  | undefined;

export class Audio {
  private song: HTMLAudioElement | null = null;
  /** Fade the anthem in (drums duck) or out (drums return). `level`: 'full' (lobby, Last Stand, crown) or 'bed' (under play). */
  anthem(on: boolean, level: 'full' | 'bed' = 'full'): void {
    if (!ANTHEM) return;
    this.song ??= Object.assign(new Audio_(ANTHEM), { loop: true, volume: 0 });
    const a = this.song;
    const target = on && !this.muted ? (level === 'full' ? 0.6 : 0.34) : 0;
    if (on) void a.play().catch(() => undefined);
    if (this.drums && this.ctx) this.drums.gain.setTargetAtTime(on ? 0 : 0.55, this.ctx.currentTime, 0.4);
    const t0 = performance.now();
    const v0 = a.volume;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1500);
      a.volume = v0 + (target - v0) * k;
      if (k < 1) requestAnimationFrame(step);
      else if (!on) a.pause();
    };
    requestAnimationFrame(step);
  }
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drums: GainNode | null = null;
  private mood: Mood = 'off';
  private bpm = 84;
  private step = 0;
  private nextAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  muted = false;
  /** 0..1 extra urgency for the pick timer (tempo rises toward 170 bpm). */
  urgency = 0;

  unlock(): void {
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
      this.drums = this.ctx.createGain();
      this.drums.gain.value = 0.55;
      this.drums.connect(this.master);
      this.timer = setInterval(() => this.schedule(), 40);
    }
    void this.ctx.resume();
  }

  get blocked(): boolean {
    return !this.ctx || this.ctx.state !== 'running';
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.song) this.song.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  setMood(m: Mood): void {
    if (m === this.mood) return;
    this.mood = m;
    this.urgency = 0;
    if (m !== 'off' && m !== 'silent') this.bpm = PATTERN[m].bpm;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.mood === 'off' || this.mood === 'silent') {
      if (ctx) this.nextAt = ctx.currentTime + 0.05;
      return;
    }
    const p = PATTERN[this.mood];
    const bpm = this.mood === 'pick' ? p.bpm + (170 - p.bpm) * this.urgency : p.bpm;
    const sixteenth = 60 / bpm / 4;
    if (this.nextAt < ctx.currentTime) this.nextAt = ctx.currentTime + 0.05;
    while (this.nextAt < ctx.currentTime + 0.12) {
      const at = this.nextAt;
      for (const v of p.voices) {
        const c = v[this.step % 16];
        if (c === 'B') this.bass(at);
        else if (c === 'T') this.toneHit(at);
        else if (c === 'S') this.slap(at);
        else if (c === 'k') this.shaker(at, this.step % 4 === 0 ? 0.09 : 0.05);
      }
      this.step++;
      this.nextAt += sixteenth;
    }
  }

  // ---------- drum voices (a djembe and a shaker) ----------
  private bass(at: number): void {
    this.tone(95, at, 0.32, 0.8, 'sine', 50, this.drums);
    this.noise(at, 0.04, 0.12, 200, this.drums);
  }
  private toneHit(at: number): void {
    this.tone(210, at, 0.16, 0.38, 'sine', 170, this.drums);
    this.noise(at, 0.03, 0.12, 900, this.drums);
  }
  private slap(at: number): void {
    this.noise(at, 0.06, 0.42, 2600, this.drums);
    this.tone(420, at, 0.05, 0.1, 'triangle', 330, this.drums);
  }
  private shaker(at: number, g: number): void {
    this.noise(at, 0.035, g, 7000, this.drums);
  }

  // ---------- effects ----------
  sfx(kind: Sfx, pitch = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.01;
    const st = (n: number) => 2 ** ((n + pitch) / 12);
    switch (kind) {
      case 'card':
        this.noise(t, 0.09, 0.25, 3200);
        this.tone(520 * st(0), t + 0.04, 0.12, 0.06, 'triangle');
        break;
      case 'flip':
        this.noise(t, 0.14, 0.32, 2400);
        this.tone(300, t + 0.08, 0.35, 0.16, 'triangle', 620);
        break;
      case 'step':
        this.tone(140 * st(0), t, 0.09, 0.22, 'sine', 90);
        this.noise(t, 0.04, 0.08, 500);
        break;
      case 'fog':
        this.noise(t, 0.7, 0.12, 800);
        this.tone(660, t, 0.6, 0.03, 'sine', 990);
        break;
      case 'slam':
        this.tone(70, t, 0.4, 0.9, 'sine', 32);
        this.noise(t, 0.2, 0.5, 300);
        break;
      case 'whoosh':
        this.noise(t, 0.25, 0.2, 1800);
        break;
      case 'tick':
        this.tone(1300, t, 0.04, 0.07, 'square');
        break;
      case 'count':
        this.tone(660 * st(0), t, 0.05, 0.05, 'triangle');
        break;
      case 'reveal':
        this.tone(98, t, 0.9, 0.5, 'sine', 60);
        this.noise(t, 0.12, 0.4, 1500);
        break;
      case 'win':
        [0, 4, 7].forEach((s, i) => this.tone(523 * st(s), t + i * 0.06, 0.3, 0.12, 'triangle'));
        break;
      case 'tame':
        [0, 4, 7, 12, 16, 19].forEach((s, i) => this.tone(392 * st(s), t + i * 0.06, 0.55, 0.13, 'triangle'));
        this.tone(98, t, 0.7, 0.35, 'sine');
        break;
      case 'heart':
        this.tone(330, t, 0.25, 0.25, 'square', 120);
        break;
      case 'shatter':
        for (let i = 0; i < 9; i++) this.noise(t + i * 0.025, 0.06, 0.3, 3000 + i * 400);
        this.tone(180, t, 0.6, 0.3, 'sawtooth', 60);
        break;
      case 'standoff':
        this.tone(220, t, 0.5, 0.14, 'sawtooth', 210);
        this.tone(233, t, 0.5, 0.14, 'sawtooth', 222);
        break;
      case 'item':
        [0, 7, 12, 19].forEach((s, i) => this.tone(784 * st(s), t + i * 0.05, 0.35, 0.08, 'sine'));
        break;
      case 'portal':
        this.tone(200, t, 0.9, 0.15, 'sine', 900);
        this.noise(t, 0.9, 0.12, 1200);
        break;
      case 'trap':
        this.noise(t, 0.05, 0.6, 4000);
        this.tone(150, t, 0.3, 0.4, 'square', 60);
        break;
      case 'steal':
        this.noise(t, 0.12, 0.2, 5000);
        [12, 7].forEach((s, i) => this.tone(880 * st(s - 12), t + i * 0.08, 0.12, 0.08, 'triangle'));
        break;
      case 'swap':
        this.tone(400, t, 0.3, 0.12, 'sine', 800);
        this.tone(800, t, 0.3, 0.12, 'sine', 400);
        break;
      case 'omen':
        this.tone(55, t, 2.2, 0.4, 'sawtooth', 52);
        this.tone(82, t, 2.2, 0.2, 'sawtooth', 78);
        break;
      case 'quake':
        this.noise(t, 1.6, 0.5, 90);
        this.tone(40, t, 1.6, 0.5, 'sawtooth', 28);
        break;
      case 'thunder':
        this.noise(t, 0.08, 0.9, 4000);
        this.noise(t + 0.06, 1.6, 0.5, 160);
        this.tone(48, t + 0.05, 1.5, 0.35, 'sawtooth', 30);
        break;
      case 'crown':
        [0, 4, 7, 12, 7, 12, 16, 19, 24].forEach((s, i) =>
          this.tone(392 * st(s), t + i * 0.11, 0.55, 0.12, 'triangle'),
        );
        this.tone(98, t, 1.4, 0.4, 'sine');
        break;
      case 'ko':
        [0, -3, -6, -10].forEach((s, i) => this.tone(220 * st(s), t + i * 0.2, 0.4, 0.15, 'sawtooth'));
        this.tone(49, t + 0.8, 1.2, 0.5, 'sine', 30);
        break;
      case 'choose':
        this.tone(880 * st(0), t, 0.08, 0.1, 'triangle');
        this.tone(1320 * st(0), t + 0.05, 0.1, 0.08, 'triangle');
        break;
    }
  }

  grunt(kind: Grunt): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.01;
    switch (kind) {
      case 'roar':
        this.tone(160, t, 1.2, 0.45, 'sawtooth', 55);
        this.tone(118, t + 0.03, 1.1, 0.3, 'square', 50);
        this.noise(t, 1.0, 0.35, 380);
        break;
      case 'hiss':
        this.noise(t, 1.1, 0.28, 6000);
        break;
      case 'chomp':
        this.noise(t, 0.12, 0.7, 600);
        this.tone(70, t, 0.35, 0.6, 'sine', 30);
        this.noise(t + 0.25, 0.12, 0.6, 600);
        break;
      case 'stomp':
        [0, 0.35].forEach((d) => {
          this.tone(55, t + d, 0.3, 0.7, 'sine', 28);
          this.noise(t + d, 0.15, 0.3, 140);
        });
        break;
      case 'bark':
        this.tone(520, t, 0.09, 0.3, 'square', 300);
        this.tone(560, t + 0.16, 0.1, 0.3, 'square', 320);
        break;
      case 'coo':
        this.tone(420, t, 0.25, 0.14, 'sine', 360);
        this.tone(400, t + 0.3, 0.3, 0.14, 'sine', 330);
        break;
      case 'rumble':
        this.noise(t, 0.9, 0.3, 120);
        this.tone(45, t, 0.9, 0.3, 'sawtooth', 35);
        break;
      case 'bones':
        for (let i = 0; i < 8; i++)
          this.noise(t + i * 0.04 + Math.random() * 0.02, 0.03, 0.25, 2200 + Math.random() * 1800);
        break;
      case 'wave':
        this.noise(t, 0.9, 0.25, 500);
        this.noise(t + 0.7, 0.8, 0.45, 1400);
        break;
      case 'dragon':
        this.tone(900, t, 0.5, 0.18, 'sawtooth', 420);
        this.noise(t + 0.3, 0.6, 0.3, 1100);
        break;
      case 'suck':
        this.noise(t, 1.4, 0.3, 300);
        this.tone(220, t, 1.4, 0.18, 'sine', 30);
        break;
    }
  }

  private tone(
    freq: number,
    at: number,
    dur: number,
    gain: number,
    type: OscillatorType,
    glideTo?: number,
    out?: GainNode | null,
  ): void {
    const ctx = this.ctx;
    const dest = out ?? this.master;
    if (!ctx || !dest) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(dest);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  private noiseBuf: AudioBuffer | null = null;
  private noise(at: number, dur: number, gain: number, bandHz?: number, out?: GainNode | null): void {
    const ctx = this.ctx;
    const dest = out ?? this.master;
    if (!ctx || !dest) return;
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    if (bandHz) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = bandHz;
      bp.Q.value = 1.1;
      src.connect(bp).connect(g).connect(dest);
    } else src.connect(g).connect(dest);
    src.start(at, Math.random() * 1.5, dur + 0.05);
  }
}
