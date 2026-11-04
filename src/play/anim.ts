/**
 * Motion helpers (rassi-juice numbers): every animation is the Web Animations API on transform/opacity (GPU-composited), so the
 * whole game moves like one material. `speed` scales every hold for review runs (?speed=N); `skip` lets SPACE end a hold once its
 * reading time has passed (audience lane: skippable, never shorter than its reading time).
 */
export const EASE = {
  out: 'cubic-bezier(.16,1,.3,1)',
  pop: 'cubic-bezier(.34,1.56,.64,1)',
  in: 'cubic-bezier(.7,0,.84,0)',
  inOut: 'cubic-bezier(.65,0,.35,1)',
  back: 'cubic-bezier(.36,0,.66,-0.56)',
} as const;

export const clock = { speed: 1, skipAt: 0 };
/**
 * v10 (owner: "jab kuch likha hua aata hai toh timing ki chinta na karo, read karne ke baad player khud aage karega"): text to
 * read waits for the table. `manual` is off only for the QA review hand (?auto=1). `waiting` tells the stall watchdog that a
 * person is reading, not that a beat hung.
 */
export const reader = { manual: true, waiting: false };
let cue: HTMLElement | null = null;
/** Hold until someone taps, presses SPACE or ENTER (after a short guard so a mash never skips unread text). */
export async function readGate(guardMs = 450): Promise<void> {
  if (!reader.manual) return;
  const t0 = performance.now();
  await new Promise((ok) => setTimeout(ok, guardMs));
  reader.waiting = true;
  cue ??= Object.assign(document.createElement('div'), {
    className: 'read-cue',
    innerHTML: '<kbd>SPACE</kbd> or tap to continue',
  });
  document.body.append(cue);
  try {
    while (clock.skipAt <= t0 + guardMs) await new Promise((ok) => setTimeout(ok, 40));
  } finally {
    reader.waiting = false;
    cue.remove();
  }
}
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const REDUCED = reduced;

/**
 * QA v7 H1: a secret screen ("only you look") opens only on a DELIBERATE press: the screen has been up for 0.9 s, the key is not
 * auto-repeat, and it is not part of a mash (no other SPACE within 350 ms before it). Mashing SPACE to skip beats can never open
 * someone else's card.
 */
let lastSpace = 0;
if (typeof addEventListener === 'function')
  addEventListener(
    'keydown',
    (e) => {
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      (e as KeyboardEvent & { prevSpace?: number }).prevSpace = lastSpace;
      lastSpace = performance.now();
    },
    true,
  );
export function deliberate(e: KeyboardEvent, openedAt: number): boolean {
  const prev = (e as KeyboardEvent & { prevSpace?: number }).prevSpace ?? 0;
  const now = performance.now();
  return !e.repeat && now - openedAt > 900 / clock.speed && now - prev > 350;
}

export const wait = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms / clock.speed));

/** Reading time for a line of text: 0.7 s + 50 ms a character (about 20 characters a second), at least `min`. */
/** Reading time: ~15 characters a second (subtitle guidance for mixed-age audiences is 13–17), plus a breath. */
export const readMs = (text: string, min = 1100): number => Math.max(min, 900 + text.length * 66);

/** v12: a short line's hold that SPACE, ENTER or a tap ends at once (after a 200 ms guard against a held key). */
export async function quickHold(ms: number): Promise<void> {
  const t0 = performance.now();
  const end = t0 + ms / clock.speed;
  while (performance.now() < end) {
    if (clock.skipAt > t0 + 200) return;
    await new Promise((ok) => setTimeout(ok, 40));
  }
}
/**
 * Hold a beat: `read` ms are mandatory (the reading time); after that, up to `extra` more ms unless SPACE / a tap skips.
 */
export async function hold(read: number, extra = 0): Promise<void> {
  const t0 = performance.now();
  await wait(read);
  if (extra <= 0) return;
  const end = performance.now() + extra / clock.speed;
  while (performance.now() < end) {
    if (clock.skipAt > t0 + read / clock.speed) return;
    await new Promise((ok) => setTimeout(ok, 50));
  }
}

export function tween(
  el: Element,
  frames: Keyframe[] | PropertyIndexedKeyframes,
  ms: number,
  easing: string = EASE.out,
  delay = 0,
): Promise<void> {
  const a = el.animate(frames, {
    duration: (reduced ? Math.min(ms, 150) : ms) / clock.speed,
    easing,
    delay: delay / clock.speed,
    fill: 'forwards',
  });
  return a.finished.then(
    () => {
      try {
        a.commitStyles();
      } catch {
        /* element left the DOM */
      }
      a.cancel();
    },
    () => {},
  );
}

/** Count a number up (or down) in an element, with a tick sound callback every few steps (pitch rises: Balatro). */
export async function countUp(
  el: HTMLElement,
  from: number,
  to: number,
  ms: number,
  onTick?: (i: number) => void,
): Promise<void> {
  const steps = Math.max(1, Math.min(24, Math.abs(to - from)));
  for (let i = 1; i <= steps; i++) {
    const v = Math.round(from + ((to - from) * i) / steps);
    el.textContent = String(v);
    if (onTick && i % 2 === 0) onTick(i);
    await wait(ms / steps);
  }
  el.textContent = String(to);
}

/** The universal pop (juiceUp, 400 ms): snap small, spring back with a wobble. */
export function pop(el: Element, a = 0.4): Promise<void> {
  if (reduced) return Promise.resolve();
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * 0.4;
    const k = (1 - t / 0.4) ** 3;
    const s = i === 0 ? 1 - 0.6 * a : 1 + a * Math.sin(50.8 * t) * k * 0.6;
    const r = 0.6 * a * Math.sin(40.8 * t) * (1 - t / 0.4) ** 2 * 6;
    frames.push({ transform: `scale(${s.toFixed(3)}) rotate(${r.toFixed(2)}deg)`, offset: i / 12 });
  }
  return tween(el, frames, 400, 'linear');
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  html = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
