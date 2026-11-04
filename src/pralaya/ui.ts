/**
 * The shared UI kit: creature cards, the choice panel (big buttons with number keys; click/tap/keys all work; ENTER takes the
 * highlighted default), the soft ember timer (timing-v8: fate 15 s, fork 8 s, team 20 s, special 10 s → a safe default), and the
 * "only you look" cover (QA v7 H1: it opens only on a deliberate press).
 */
import { STATS, epithetOf, formOf, statsOf, type Stat } from '../game/v8/stats.ts';
import type { Owned } from '../game/v8/rules.ts';
import { creature, fighter, giftsOf } from '../game/v8/rules.ts';
import type { Type } from '../game/v8/types.ts';
import { EASE, clock, deliberate, el, esc, pop, readGate, reader, tween } from '../play/anim.ts';
import { art } from './look.ts';
import { GIFT, MOVE, TYPE, WORLD } from './text.ts';

/** Type glyphs, drawn (never emoji): a spiral, a sun, claws, a mask, a crescent. */
const TYPE_PATH: Record<Type, string> = {
  COSMIC: 'M12 12m-2 0a2 2 0 1 0 4 0a4 4 0 1 0-8 0a6 6 0 1 0 12 0a8 8 0 1 0-16 0',
  MYTHIC: 'M12 7a5 5 0 1 0 0.01 0M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2',
  WILD: 'M6 3l3 18M12 2l1 19M18 3l-2 18',
  TRICKSTER: 'M3 8c3-3 15-3 18 0c0 8-5 12-9 12S3 16 3 8zM8 11l2 1M16 11l-2 1M9 16c2 1 4 1 6 0',
  SHADOW: 'M15 3a9 9 0 1 0 6 15a7 7 0 0 1-6-15z',
};
export const typeIcon = (t: Type, size = 18): string =>
  `<svg class="ticon" viewBox="0 0 24 24" width="${size}" height="${size}" style="color:${TYPE[t].colour}" aria-label="${TYPE[t].name}"><path d="${TYPE_PATH[t]}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** A creature card (owned or wild). `hide`: Forever Night shows only the type glow. */
export function cardEl(
  cid: string,
  o: { owned?: Owned; hide?: boolean; small?: boolean; tag?: string; call?: Stat } = {},
): HTMLElement {
  const c = creature(cid);
  const f = o.owned ? fighter(o.owned) : null;
  const types = f?.types ?? [c.type];
  const d = el(
    'div',
    `ccard r-${c.rarity}${o.small ? ' small' : ''}${o.hide ? ' dark' : ''}${o.owned?.ascended ? ' ascended' : ''}`,
  );
  d.style.setProperty('--wc', WORLD[c.world].colour);
  const form = formOf(cid);
  if (form.name) d.classList.add(`form-${form.key}`);
  d.style.setProperty('--tc', TYPE[types[0]!].colour);
  if (o.hide) {
    d.innerHTML = `<div class="cc-art dark"></div><b class="cc-name">?</b>`;
    return d;
  }
  const st = f?.stats ?? statsOf(c);
  const fused = o.owned?.fused ? creature(o.owned.fused) : null;
  const gifts = o.owned ? giftsOf(o.owned) : c.gift ? [c.gift] : [];
  d.innerHTML = `
    <div class="cc-art"><img src="${art(c.id)}" alt="" loading="lazy">${fused ? `<img class="fused" src="${art(fused.id)}" alt="">` : ''}</div>
    <b class="cc-name">${esc(fused ? `${c.name.split(',')[0]} × ${fused.name.split(',')[0]}` : c.name)}</b>
    <dl class="cc-stats">${STATS.map((s) => `<div data-stat="${s}"${o.call === s ? ' class="on"' : ''}><dt>${s}</dt><dd>${st[s]}</dd></div>`).join('')}</dl>
    ${gifts.length ? `<div class="cc-foot"><span class="cc-gift" title="${esc(gifts.map((g) => GIFT[g].rule).join(' '))}">${gifts.map((g) => GIFT[g].name).join(' · ')}</span></div>` : ''}
    ${o.owned?.mod ? `<span class="cc-mod ${o.owned.mod > 0 ? 'up' : 'down'}" title="${esc(o.owned.modName ?? '')}">${esc(o.owned.modName ?? '')} ${o.owned.mod > 0 ? '+' : ''}${o.owned.mod}</span>` : ''}
    ${form.name || epithetOf(cid).name ? `<span class="cc-form">${esc([form.name, epithetOf(cid).name].filter(Boolean).join(' · '))}</span>` : ''}
    ${o.owned?.ascended ? `<span class="cc-rank${o.owned.exalted ? ' exalted' : ''}" title="Won ${o.owned.wins} lanes for you. The proud fall first.">${o.owned.exalted ? 'FABLED' : 'ASCENDED'}</span>` : ''}
    ${o.tag ? `<span class="cc-tag">${esc(o.tag)}</span>` : ''}`;
  return d;
}

export interface Option {
  html: string;
  /** Plain words for screen readers and the auto hand. */
  label: string;
  cls?: string;
  disabled?: boolean;
}
export interface PanelOpts {
  title: string;
  sub?: string;
  /** Index taken on ENTER and when the soft timer runs out. */
  def?: number;
  /** Soft timer in seconds (0 = none). */
  timer?: number;
  cls?: string;
  /** Extra element shown above the options (cards, verses). */
  body?: HTMLElement;
}

let layer: HTMLElement;
export function mountUi(parent: HTMLElement): void {
  layer = el('div', 'ui-layer');
  parent.append(layer);
}

/** The auto review hand answers panels itself (?auto=1 only). */
export const auto = {
  on: false,
  pick: (n: number, def: number): number => (Math.random() < 0.7 ? def : Math.floor(Math.random() * n)),
};

/** Show a choice panel and resolve with the chosen index. */
export function choose(options: Option[], o: PanelOpts): Promise<number> {
  return new Promise((done) => {
    const panel = el('section', `panel ${o.cls ?? ''}`);
    panel.setAttribute('role', 'dialog');
    panel.innerHTML = `<h2>${o.title}</h2>${o.sub ? `<p class="sub">${o.sub}</p>` : ''}`;
    if (o.body) panel.append(o.body);
    const row = el('div', 'opts');
    let def = Math.max(0, Math.min(options.length - 1, o.def ?? 0));
    while (options[def]?.disabled && def < options.length - 1) def++;
    const btns = options.map((op, i) => {
      const b = el(
        'button',
        `opt ${op.cls ?? ''}${i === def ? ' def' : ''}`,
        `<kbd>${i + 1}</kbd>${op.html}`,
      ) as HTMLButtonElement;
      b.disabled = !!op.disabled;
      b.setAttribute('aria-label', op.label);
      b.addEventListener('click', () => finish(i));
      row.append(b);
      return b;
    });
    panel.append(row);
    let timerEl: HTMLElement | null = null;
    let t: ReturnType<typeof setTimeout> | null = null;
    if (o.timer) {
      timerEl = el('div', 'ember', '<i></i>');
      panel.append(timerEl);
      const bar = timerEl.firstElementChild as HTMLElement;
      bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], {
        duration: (o.timer * 1000) / clock.speed,
        fill: 'forwards',
        easing: 'linear',
      });
      t = setTimeout(() => finish(def), (o.timer * 1000) / clock.speed);
    }
    layer.append(panel);
    void tween(
      panel,
      [
        { opacity: 0, transform: 'translate(-50%, -46%) scale(.96)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
      ],
      260,
      EASE.out,
    );
    const opened = performance.now();
    const key = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= options.length && !options[n - 1]!.disabled) {
        e.preventDefault();
        finish(n - 1);
      } else if (
        (e.code === 'Enter' || e.code === 'NumpadEnter') &&
        performance.now() - opened > 400 / clock.speed
      ) {
        e.preventDefault();
        finish(def);
      }
    };
    addEventListener('keydown', key);
    let ended = false;
    function finish(i: number) {
      if (ended || options[i]?.disabled) return;
      ended = true;
      if (t) clearTimeout(t);
      removeEventListener('keydown', key);
      btns[i]?.classList.add('picked');
      void pop(btns[i]!, 0.3);
      setTimeout(() => {
        void tween(panel, [{ opacity: 1 }, { opacity: 0 }], 180, EASE.in).then(() => panel.remove());
        done(i);
      }, 160 / clock.speed);
    }
    if (auto.on)
      setTimeout(() => {
        const i = auto.pick(options.length, def);
        finish(options[i]?.disabled ? def : i);
      }, 700 / clock.speed);
  });
}

/** "Only you look": a cover that opens only on a deliberate press, then resolves (and closes on `close()`). */
export function cover(name: string, colour: string, why: string): Promise<() => void> {
  return new Promise((done) => {
    const c = el(
      'section',
      'cover',
      `<div class="handoff"><small>Pass the laptop to</small><h1 style="color:${colour}">${esc(name)}</h1><p>${esc(why)}</p><p class="look">Only you look.</p><button class="go"><kbd>SPACE</kbd> I am ${esc(name)}. Show me.</button></div>`,
    );
    layer.append(c);
    const opened = performance.now();
    const open = () => {
      removeEventListener('keydown', key);
      c.querySelector('.handoff')?.remove();
      c.classList.add('open');
      done(() => c.remove());
    };
    const key = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.code === 'Enter') && deliberate(e, opened)) {
        e.preventDefault();
        open();
      }
    };
    addEventListener('keydown', key);
    c.querySelector('.go')!.addEventListener(
      'click',
      () => performance.now() - opened > 900 / clock.speed && open(),
    );
    if (auto.on) setTimeout(open, 1100 / clock.speed);
  });
}

/** A big moment card over everything (verses, flips, the Last Light): holds, then fades. */
export async function bigCard(html: string, ms: number, cls = ''): Promise<void> {
  const o = el('div', `bigcard ${cls}`, html);
  layer.append(o);
  await tween(
    o,
    [
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.9)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
    ],
    420,
    EASE.pop,
  );
  // A big card is read, then dismissed by the table (the timer only runs for the QA review hand).
  if (reader.manual) await readGate(700);
  else await new Promise((r) => setTimeout(r, ms / clock.speed));
  await tween(o, [{ opacity: 1 }, { opacity: 0 }], 320, EASE.in);
  o.remove();
}
