/**
 * v9 screens: the die, the chance card, and the timed trial (timing lives here now, never in battles: owner 2026-10-31).
 * DOM overlays on the ui layer; every one resolves on its own (auto hand, timers), so no beat can hang.
 */
import { CHANCE } from '../game/v8/cards.ts';
import { EASE, clock, el, esc, readGate, readMs, reader, tween, quickHold } from '../play/anim.ts';
import { auto } from './ui.ts';

const layerOf = () => document.querySelector('.ui-layer') ?? document.body;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms / clock.speed));

/** The pips of a d6 face (3×3 grid cells that hold a pip). */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
const face = (n: number) =>
  `<div class="die-face">${Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[n]?.includes(i) ? 'pip' : ''}"></i>`).join('')}</div>`;

/** The roll: the die (or two) tumbles through random faces, lands, and shows the final count under it. */
export async function rollDie(dice: number[], line: string, colour: string): Promise<void> {
  const o = el('div', 'dice-roll');
  o.style.setProperty('--seat', colour);
  const row = el('div', 'dice-row');
  const dies = dice.map(() => el('div', 'die', face(1)));
  row.append(...dies);
  const cap = el('p', 'dice-cap', '');
  o.append(row, cap);
  layerOf().append(o);
  void tween(o, [{ opacity: 0 }, { opacity: 1 }], 160, EASE.out);
  const spins = 9;
  for (let k = 0; k < spins; k++) {
    dies.forEach((d, i) => {
      d.innerHTML = face(k === spins - 1 ? dice[i]! : 1 + Math.floor(Math.random() * 6));
      d.style.transform = `rotate(${k === spins - 1 ? 0 : (Math.random() - 0.5) * 70}deg) translateY(${k === spins - 1 ? 0 : -Math.sin((k / spins) * Math.PI) * 40}px)`;
    });
    await sleep(55 + k * 14);
  }
  dies.forEach((d) => d.classList.add('landed'));
  cap.innerHTML = line;
  // v12: the number is the news; it holds 1.2 s and SPACE moves on at once (the glowing places come next).
  await quickHold(1200);
  await tween(o, [{ opacity: 1 }, { opacity: 0 }], 220, EASE.in);
  o.remove();
}

const KIND: Record<string, string> = {
  bet: 'A bet',
  give: 'A cruel gift',
  trial: 'A trial',
  battle: 'A battle',
  luck: 'Luck',
  chaos: 'Chaos',
};
/** A chance card turns over: its kind, its name, the verse, the rule. Held for reading time. */
export async function chanceCard(id: string, who: string, colour: string): Promise<void> {
  const c = CHANCE[id];
  if (!c) return;
  const o = el(
    'div',
    `chance-card k-${c.kind}`,
    `<small class="ck">${KIND[c.kind]} · for <b style="color:${colour}">${esc(who)}</b></small><h2>${esc(c.name)}</h2><p class="cv"><i>“${esc(c.verse)}”</i></p><p class="ct">${esc(c.text)}</p>`,
  );
  layerOf().append(o);
  await tween(
    o,
    [
      { opacity: 0, transform: 'translate(-50%, -50%) rotateY(90deg) scale(.9)' },
      { opacity: 1, transform: 'translate(-50%, -50%) rotateY(0deg) scale(1)' },
    ],
    480,
    EASE.pop,
  );
  if (reader.manual) await readGate(900);
  else await sleep(Math.min(6500, readMs(`${c.verse} ${c.text}`, 2600)));
  await tween(o, [{ opacity: 1 }, { opacity: 0 }], 260, EASE.in);
  o.remove();
}

/** THE TRIAL: a ring closes on the mark; press SPACE / ENTER or tap as they meet. Perfect ±80 ms → 2 · good ±200 ms → 1 · else 0. */
export async function trialRing(title: string, who: string, colour: string, n: number): Promise<number[]> {
  const o = el(
    'div',
    'trial',
    `<small style="color:${colour}">${esc(who)}</small><h2>${esc(title)}</h2><p class="tr-how">Press <kbd>SPACE</kbd> or tap as the white ring meets the gold.</p><div class="tr-stage"><i class="tr-mark"></i><i class="tr-ring"></i></div><p class="tr-hits"></p>`,
  );
  o.style.setProperty('--seat', colour);
  layerOf().append(o);
  void tween(o, [{ opacity: 0 }, { opacity: 1 }], 200, EASE.out);
  const ring = o.querySelector('.tr-ring') as HTMLElement;
  const hitsEl = o.querySelector('.tr-hits') as HTMLElement;
  const hits: number[] = [];
  await sleep(700);
  for (let k = 0; k < n; k++) {
    const D = 1100 / clock.speed;
    const t0 = performance.now() + 300 / clock.speed;
    const hitAt = t0 + D * (2.4 / 2.7);
    const h = await new Promise<number>((ok) => {
      let ended = false;
      let raf = 0;
      const finish = (v: number) => {
        if (ended) return;
        ended = true;
        cancelAnimationFrame(raf);
        removeEventListener('keydown', key);
        o.removeEventListener('pointerdown', tap);
        ok(v);
      };
      const judge = () => {
        if (performance.now() < t0 - 80) return;
        const dt = Math.abs(performance.now() - hitAt) * clock.speed;
        finish(dt <= 80 ? 2 : dt <= 200 ? 1 : 0);
      };
      const frame = () => {
        const q = (performance.now() - t0) / D;
        ring.style.transform = `translate(-50%, -50%) scale(${Math.max(0.3, 3 - 2.7 * Math.max(0, q))})`;
        ring.style.opacity = q < 0 ? '0.35' : '1';
        if (q >= 1) finish(0);
        else raf = requestAnimationFrame(frame);
      };
      const key = (e: KeyboardEvent) => {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          judge();
        }
      };
      const tap = (e: Event) => {
        e.preventDefault();
        judge();
      };
      addEventListener('keydown', key);
      o.addEventListener('pointerdown', tap);
      raf = requestAnimationFrame(frame);
      if (auto.on) setTimeout(judge, hitAt - performance.now() + ((Math.random() - 0.5) * 380) / clock.speed);
    });
    hits.push(h);
    const word = h === 2 ? 'PERFECT' : h === 1 ? 'GOOD' : 'MISS';
    hitsEl.insertAdjacentHTML('beforeend', `<b class="tr-${word.toLowerCase()}">${word}</b>`);
    o.classList.remove('flash-perfect', 'flash-miss');
    void o.offsetWidth;
    o.classList.add(h === 2 ? 'flash-perfect' : h === 0 ? 'flash-miss' : 'flash-good');
    await sleep(520);
  }
  await sleep(500);
  await tween(o, [{ opacity: 1 }, { opacity: 0 }], 220, EASE.in);
  o.remove();
  return hits;
}

/** v11 THE WHEEL OF PRALAYA: three reels (who · what · with whom) spin and stop one by one, left to right. */
export async function wheelReels(
  reels: { options: { html: string }[]; final: { html: string } }[],
  title: string,
  who: string,
  colour: string,
): Promise<void> {
  const o = el('div', 'wheel-reels', `<small style="color:${colour}">${esc(who)}</small><h2>${esc(title)}</h2><div class="reels"></div><p class="wr-out"></p>`);
  const row = o.querySelector('.reels') as HTMLElement;
  const cells = reels.map(() => {
    const c = el('div', 'reel', '');
    row.append(c);
    return c;
  });
  layerOf().append(o);
  void tween(o, [{ opacity: 0 }, { opacity: 1 }], 200, EASE.out);
  for (const [i, r] of reels.entries()) {
    const spins = 12 + i * 4;
    for (let k = 0; k < spins; k++) {
      const pick = k === spins - 1 ? r.final : r.options[Math.floor(Math.random() * r.options.length)]!;
      cells[i]!.innerHTML = pick.html;
      cells[i]!.classList.toggle('spin', k < spins - 1);
      await sleep(45 + k * 9);
    }
    cells[i]!.classList.add('stopped');
    await sleep(350);
  }
  if (reader.manual) await readGate(900);
  else await sleep(1800);
  await tween(o, [{ opacity: 1 }, { opacity: 0 }], 260, EASE.in);
  o.remove();
}
