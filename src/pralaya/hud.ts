/**
 * The HUD: player plates (name, hero, hearts, creatures, relics, the three once-per-match spices), the world's eye (mood + the
 * clock toward the Last Light), one caption line and first-time hints. One subject at a time: a new caption replaces the old.
 */
import type { Mood } from '../game/v8/rules.ts';
import { EASE, el, esc, pop, quickHold, readGate, readMs, reader, tween } from '../play/anim.ts';
import { SEAT, art } from './look.ts';
import { HINT, MOOD_TEXT } from './text.ts';

export interface PlateView {
  seat: number;
  name: string;
  heroId: string;
  heroName: string;
  hearts: number;
  creatures: number;
  relics: number;
  out: boolean;
  betUsed: boolean;
  golden: 'none' | 'held' | 'used';
  /** v9 badges (power, bomb, curse, flex, bets on this player), as HTML. */
  badges: string;
}

export class Hud {
  readonly plates: HTMLElement;
  readonly top: HTMLElement;
  private cap: HTMLElement;
  private hintEl: HTMLElement;
  private eye: HTMLElement;
  private seenHints = new Set<string>();

  constructor(parent: HTMLElement) {
    this.plates = el('aside', 'plates');
    this.top = el('div', 'worldbar');
    this.eye = el('div', 'eye', '<i class="lid"></i><b class="pupil"></b>');
    this.top.append(
      this.eye,
      el('div', 'clock', '<i></i><span class="mark ll" title="The Last Light"></span>'),
      el('span', 'moodtext'),
    );
    this.cap = el('div', 'caption');
    this.hintEl = el('div', 'hint');
    parent.append(this.plates, this.top, this.cap, this.hintEl);
  }

  /** Redraw every plate from the presented view (never the live state: the screen must not show the future). */
  update(players: readonly PlateView[], active: number | null): void {
    this.plates.replaceChildren(
      ...players.map((p) => {
        const d = el('div', `plate${p.out ? ' out' : ''}${p.seat === active ? ' active' : ''}`);
        d.style.setProperty('--seat', SEAT[p.seat]!);
        d.dataset.seat = String(p.seat);
        const hearts = Array.from({ length: 3 }, (_, i) => `<i class="h${i < p.hearts ? ' on' : ''}"></i>`).join('');
        const spice = `<span class="spice${p.golden === 'used' ? ' used' : p.golden === 'held' ? ' held' : ''}" title="Golden card">G</span>`;
        d.innerHTML = `<img src="${art(p.heroId)}" alt="">
          <div class="pl-main"><b>${esc(p.name)}</b><small>${esc(p.heroName)}</small>
          <div class="pl-row"><span class="hearts" aria-label="${p.hearts} hearts">${hearts}</span><span class="crit" title="Creatures">${p.creatures}<em>/6</em></span>${p.relics ? `<span class="rel" title="Relics">${'◆'.repeat(p.relics)}</span>` : ''}${spice}</div>${p.badges ? `<div class="pl-badges">${p.badges}</div>` : ''}</div>
          ${p.out ? '<span class="spirit">SPIRIT</span>' : ''}`;
        return d;
      }),
    );
  }
  plateOf(seat: number): HTMLElement | null {
    return this.plates.querySelector(`[data-seat="${seat}"]`);
  }

  /** The world's eye: its mood and how close the Last Light is. */
  world(mood: Mood, progress: number, lastLightAt: number): void {
    this.eye.dataset.mood = mood;
    (this.top.querySelector('.clock i') as HTMLElement).style.width = `${Math.min(100, progress * 100)}%`;
    (this.top.querySelector('.clock .ll') as HTMLElement).style.left = `${lastLightAt * 100}%`;
    (this.top.querySelector('.moodtext') as HTMLElement).textContent = MOOD_TEXT[mood];
  }
  /** This round's weather, shown on the world bar all round long. */
  weather(html: string): void {
    let w = this.top.querySelector('.weatherbar') as HTMLElement | null;
    if (!w) {
      w = el('div', 'weatherbar');
      this.top.querySelector('.moodtext')?.after(w);
    }
    w.innerHTML = html;
  }
  /** The world boss's shared health bar (null hides it). */
  boss(name: string | null, hp = 0, max = 1): void {
    let b = this.top.querySelector('.bossbar') as HTMLElement | null;
    if (!name) {
      b?.remove();
      return;
    }
    if (!b) {
      b = el('div', 'bossbar', '<b></b><span><i></i></span>');
      this.top.append(b);
    }
    (b.querySelector('b') as HTMLElement).textContent = `${name} · ${hp}/${max}`;
    (b.querySelector('i') as HTMLElement).style.width = `${(100 * hp) / Math.max(1, max)}%`;
  }
  /** v11 the Blood Moon tag on the world bar (this round every battle counts double). */
  blood(on: boolean): void {
    let b = this.top.querySelector('.bloodbar') as HTMLElement | null;
    if (!on) {
      b?.remove();
      return;
    }
    if (!b) {
      b = el('span', 'wx blood', 'BLOOD MOON');
      b.classList.add('bloodbar');
      b.title = 'Every battle this round counts double';
      this.top.querySelector('.weatherbar')?.append(b) ?? this.top.append(b);
    }
  }
  /** v10 THE LAST STAND: who, how many creatures they hold of how many, and the turns left (null hides it). */
  stand(name: string | null, have: number, need: number, left: number): void {
    let b = this.top.querySelector('.standbar') as HTMLElement | null;
    if (!name) {
      b?.remove();
      return;
    }
    if (!b) {
      b = el('div', 'standbar');
      this.top.append(b);
    }
    b.innerHTML = `<small>THE LAST STAND</small> <b>${esc(name)}</b> <span class="${have >= need ? 'ok' : ''}">${have}/${need} creatures</span> <em>${left} turn${left === 1 ? '' : 's'} left</em>`;
    void pop(b, 0.2);
  }
  stare(): void {
    void pop(this.eye, 0.5);
  }

  /** One caption, held for its reading time (skippable tail). */
  async say(
    html: string,
    plain: string,
    o: { min?: number; tail?: number; tone?: string; prompt?: boolean; quick?: boolean } = {},
  ): Promise<void> {
    this.cap.className = `caption on ${o.tone ?? ''}`;
    this.cap.innerHTML = html;
    void tween(
      this.cap,
      [
        { opacity: 0, transform: 'translate(-50%, 8px)' },
        { opacity: 1, transform: 'translate(-50%, 0)' },
      ],
      220,
      EASE.out,
    );
    // Something to read waits for the table (owner v10: "read karne ke baad player khud aage karega"); a short line moves on.
    // v12 (owner: "jo instruction ek minute mein padh sakta hai uspe itna time… jo genuinely padhne wali information hai wo nikal
    // jaati hai"): a prompt for a choice never waits (the choice is the wait); news worth reading waits for SPACE / ENTER / a tap;
    // a short line (a name, a count) moves on by itself, quickly, and SPACE skips it at once.
    if (o.prompt) return;
    const shown = this.cap.textContent ?? '';
    if (reader.manual && !o.quick && shown.length >= 34) await readGate(350);
    else await quickHold(Math.min(readMs(shown.length > plain.length ? shown : plain, Math.min(o.min ?? 900, 1300)), 1700));
  }
  clear(): void {
    // The entry tween commits opacity 1 inline when it ends: drop it, or a cleared caption would linger under the next subject.
    for (const an of this.cap.getAnimations()) an.cancel();
    this.cap.style.removeProperty('opacity');
    this.cap.className = 'caption';
  }

  /** A first-time hint (≤ 8 words), only the first time an idea appears (one new idea at a time). */
  hint(key: string): void {
    if (this.seenHints.has(key) || !HINT[key]) return;
    this.seenHints.add(key);
    this.hintEl.textContent = HINT[key]!;
    this.hintEl.classList.remove('on');
    void this.hintEl.offsetWidth;
    this.hintEl.classList.add('on');
  }
  hintOff(): void {
    this.hintEl.classList.remove('on');
  }
}
