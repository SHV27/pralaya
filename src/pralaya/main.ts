/**
 * PRALAYA — "The world ends. One walks out." Boot, the lobby (2–6 players type their names), the luck deal of heroes, the match,
 * the crowning with the story of the match, and AGAIN in one key. Hot-seat on one laptop: every choice is a big button with its
 * key on it (mouse, touch and keyboard all work).
 * Review hooks (never on the default path): ?seed=N · ?speed=N · ?players=N (skip the lobby) · ?auto=1 (the review hand) · ?mute=1.
 */
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/800.css';
import '@fontsource/cinzel-decorative/700.css';
import '@fontsource/mukta/400.css';
import '@fontsource/mukta/700.css';
import './style.css';
import { createGame, play, type Game } from '../game/v8/rules.ts';
import { EASE, clock, el, esc, pop, reader, tween, wait } from '../play/anim.ts';
import { Audio } from '../play/audio.ts';
import { Fx } from '../play/fx.ts';
import { Director, type Result } from './director.ts';
import { ART, SEAT, art } from './look.ts';
import { auto, mountUi } from './ui.ts';

const q = new URLSearchParams(location.search);
clock.speed = Math.max(0.25, Number(q.get('speed') ?? 1));
auto.on = q.get('auto') === '1';
reader.manual = !auto.on;
const app = document.getElementById('app')!;
const fxCanvas = el('canvas', 'fx') as HTMLCanvasElement;
document.body.append(fxCanvas);
const fx = new Fx(fxCanvas);
const audio = new Audio();
const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};
let muted = q.get('mute') === '1' || store.get('pralaya-mute') === '1';
audio.setMuted(muted);
const unlock = () => audio.unlock();
addEventListener('pointerdown', unlock, { once: true });
addEventListener('keydown', unlock, { once: true });
// A tap or SPACE skips the tail of a hold (never its reading time).
addEventListener('keydown', (e) => {
  // ENTER also turns the page, unless a choice panel is up (there ENTER takes the highlighted option).
  if (e.code === 'Space' || (e.code === 'Enter' && !document.querySelector('.panel, .choose, .dock button'))) clock.skipAt = performance.now();
});
addEventListener('pointerdown', (e) => {
  if (!(e.target as HTMLElement).closest('button, .ccard, .pickable, input'))
    clock.skipAt = performance.now();
});

const muteBtn = el('button', 'mute', '♪') as HTMLButtonElement;
muteBtn.setAttribute('aria-label', 'Sound on or off');
const paintMute = () => muteBtn.classList.toggle('off', muted);
muteBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  muted = !muted;
  audio.setMuted(muted);
  store.set('pralaya-mute', muted ? '1' : '0');
  paintMute();
});
paintMute();
document.body.append(muteBtn);

/** The table: the antique board everyone is about to fall into (the lobby, the deal and the crown sit on it). */
function onTable(v: HTMLElement, scene = 'scene-table'): void {
  v.classList.add('on-table');
  v.style.setProperty('--table', `url(${ART}${scene}.webp)`);
}

const DEFAULT_NAMES = ['Arjun', 'Meera', 'Kabir', 'Zoya', 'Ravi', 'Tara'];

/** The lobby: how many, and your names (remembered for next time). */
function lobby(): Promise<string[]> {
  return new Promise((done) => {
    const saved = (store.get('pralaya-names') ?? '').split('|').filter(Boolean);
    let n = Math.max(2, Math.min(6, Number(store.get('pralaya-seats') ?? 4)));
    const v = el('section', 'lobby');
    v.innerHTML = `
      <div class="title"><h1>PRALAYA</h1><p class="tag">The world ends. One walks out.</p></div>
      <div class="lob-body">
        <div class="how">
          <h3>How to survive</h3>
          <ol>
            <li><b>The world moves first, then you roll and choose where to go.</b> Every place your roll reaches lights up. What waits there is decided the moment you step on it: nobody can know, nobody can learn it. The Burning Heart throws you somewhere random: a gamble.</li>
            <li><b>Battles are Top Trumps.</b> Pick three fighters, set the lanes, call a stat each. The other side calls too: the wild calls blind, one of its own best stats. <b>Both calls count</b>: the bigger total wins the lane. A twist of luck can fall on either side. Two creatures left? Two on two. One? One on one. None? You <b>run</b> (4 or more on a die to get away; 5 at the last fire), and you may stake a heart, or your life, on a rival's next battle.</li>
            <li><b>The world is cruel.</b> Ground falls: if it is yours, a heart goes. A beast wakes and hunts: it rolls its own die each round and fights whoever it stops on. Chance cards make you choose who suffers. Wagers, pacts, oaths and secret contracts tie your fate to theirs: watch every turn. Fall, and you may still whisper: each round one fallen hero, drawn by lot, rolls to put +2 or −2 on someone's next roll.</li>
            <li><b>The last one standing must still walk out</b>: four creatures, or two more than they had, whichever is fewer. Five turns to find them; fail, and the fallen win together.</li>
          </ol>
          <p class="circle">Your hero's power recharges every 3 turns (a few, every 2: it says so on the card). Every match deals 512 creatures new numbers and new forms: nothing to memorise.</p>
        </div>
        <div class="seats">
          <h3>Who is playing?</h3>
          <div class="count">${[2, 3, 4, 5, 6].map((k) => `<button class="seatbtn" data-n="${k}"><kbd>${k}</kbd>${k}</button>`).join('')}</div>
          <div class="names"></div>
          <button class="go big"><kbd>ENTER</kbd> Begin</button>
        </div>
      </div>`;
    onTable(v);
    app.replaceChildren(v);
    const names = v.querySelector('.names') as HTMLElement;
    const draw = () => {
      v.querySelectorAll<HTMLElement>('.seatbtn').forEach((b) =>
        b.classList.toggle('on', Number(b.dataset.n) === n),
      );
      const cur = [...names.querySelectorAll('input')].map((i) => i.value);
      names.replaceChildren(
        ...Array.from({ length: n }, (_, i) => {
          const row = el('label', 'namerow', `<i style="background:${SEAT[i]}"></i>`);
          const inp = el('input') as HTMLInputElement;
          inp.maxLength = 14;
          inp.placeholder = DEFAULT_NAMES[i]!;
          inp.value = cur[i] ?? saved[i] ?? '';
          inp.setAttribute('aria-label', `Player ${i + 1} name`);
          row.append(inp);
          return row;
        }),
      );
    };
    v.querySelectorAll<HTMLElement>('.seatbtn').forEach((b) =>
      b.addEventListener('click', () => {
        n = Number(b.dataset.n);
        draw();
      }),
    );
    const begin = () => {
      const list = [...names.querySelectorAll('input')].map(
        (inp, i) => inp.value.trim().replace(/\s+/g, ' ') || DEFAULT_NAMES[i]!,
      );
      // Two players cannot share a name (the screen names who acts).
      const seen = new Set<string>();
      const fixed = list.map((x, i) => {
        let y = x;
        let k = 2;
        while (seen.has(y.toLowerCase())) y = `${x} ${k++}`;
        seen.add(y.toLowerCase());
        return y || DEFAULT_NAMES[i]!;
      });
      store.set('pralaya-names', fixed.join('|'));
      store.set('pralaya-seats', String(n));
      removeEventListener('keydown', key);
      done(fixed);
    };
    const key = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement).tagName === 'INPUT';
      if (!inField && Number(e.key) >= 2 && Number(e.key) <= 6) {
        n = Number(e.key);
        draw();
      } else if (e.code === 'Enter') begin();
    };
    addEventListener('keydown', key);
    v.querySelector('.go')!.addEventListener('click', begin);
    draw();
    if (auto.on) setTimeout(begin, 600);
  });
}

/** The luck deal: each player's hero turns face up with its gift and its weakness. */
async function deal(g: Game): Promise<void> {
  const v = el('section', 'deal');
  v.innerHTML =
    '<h2>The heroes are dealt</h2><p class="sub">Luck chooses who you are. Read your power and your weakness: everyone else will.</p><div class="heroes"></div><button class="go"><kbd>SPACE</kbd> Into the world</button>';
  onTable(v);
  app.replaceChildren(v);
  const row = v.querySelector('.heroes') as HTMLElement;
  for (const p of g.players) {
    const c = el('div', 'herocard');
    c.style.setProperty('--seat', SEAT[p.seat]!);
    c.innerHTML = `<img src="${art(p.hero.id)}" alt=""><h3>${esc(p.name)}</h3><b class="hname">${esc(p.hero.name)}</b>
      <p class="gift"><span>POWER · every 3 turns</span> <b>${esc(p.hero.giftName)}.</b> ${esc(p.hero.giftText)}</p>
      <p class="weak"><span>WEAKNESS</span> <b>${esc(p.hero.weakName)}.</b> ${esc(p.hero.weakText)}</p>
      <p class="joke">“${esc(p.hero.joke)}”</p>`;
    row.append(c);
    audio.sfx('flip');
    await tween(
      c,
      [
        { opacity: 0, transform: 'rotateY(90deg)' },
        { opacity: 1, transform: 'rotateY(0)' },
      ],
      420,
      EASE.out,
    );
    await wait(220);
  }
  const go = v.querySelector('.go') as HTMLElement;
  go.classList.add('on');
  void pop(go);
  await new Promise<void>((ok) => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') end();
    };
    const end = () => {
      removeEventListener('keydown', key);
      ok();
    };
    addEventListener('keydown', key);
    go.addEventListener('click', end);
    if (auto.on) setTimeout(end, 900 / clock.speed);
  });
}

/** The crowning: the survivor, then the story of the match in its best lines, then AGAIN. */
async function crown(g: Game, r: Result): Promise<'again' | 'new'> {
  const w = g.players[r.winner]!;
  const fallenWin = r.why === 'world';
  const lines = [...r.story]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 7)
    .sort((a, b) => a.t - b.t);
  const v = el('section', 'crown');
  v.innerHTML = `
    ${
      fallenWin
        ? `<div class="crown-hero"><img src="${art(w.hero.id)}" alt="" style="filter:grayscale(1) brightness(.6)"><div><small>THE WORLD KEPT ${esc(w.name.toUpperCase())}</small><h1>The fallen win</h1><p>${g.players.filter((p) => p !== w).map((p) => `<b style="color:${SEAT[p.seat]}">${esc(p.name)}</b>`).join(' · ')}</p></div></div>`
        : `<div class="crown-hero"><img src="${art(w.hero.id)}" alt=""><div><small>${r.why === 'walkout' ? 'WALKED OUT OF THE WORLD' : 'THE LAST ONE STANDING'}</small><h1 style="color:${SEAT[w.seat]}">${esc(w.name)}</h1><p>${esc(w.hero.name)} · ${w.hearts} ${w.hearts === 1 ? 'heart' : 'hearts'} left · ${w.deck.length} creatures</p></div></div>`
    }
    <h3>The story of this world</h3>
    <ol class="recap">${lines.map((l) => `<li>${l.img ? `<img src="${art(l.img)}" alt="">` : ''}<span>${esc(l.text)}</span></li>`).join('')}</ol>
    <div class="again"><button class="go" data-a="again"><kbd>SPACE</kbd> Again</button><button class="ghost" data-a="new"><kbd>N</kbd> New table</button></div>`;
  onTable(v, 'scene-centre-fire');
  app.replaceChildren(v);
  fx.burst(innerWidth / 2, innerHeight * 0.3, { n: 80, color: ['#f2b53b', '#fff2c6', '#ff7a2f'] });
  return new Promise((done) => {
    const end = (x: 'again' | 'new') => {
      removeEventListener('keydown', key);
      done(x);
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') end('again');
      if (e.key.toLowerCase() === 'n') end('new');
    };
    setTimeout(() => addEventListener('keydown', key), 1200 / clock.speed);
    v.querySelectorAll<HTMLElement>('button').forEach((b) =>
      b.addEventListener('click', () => end(b.dataset.a as 'again' | 'new')),
    );
    const st = (window as unknown as { __pralaya: { screen: string; crowns: number } }).__pralaya;
    st.screen = 'crown';
    st.crowns = (st.crowns ?? 0) + 1;
    if (auto.on) setTimeout(() => end('again'), 4000 / clock.speed);
  });
}

async function main(): Promise<void> {
  document.getElementById('loading')?.remove();
  const state = { screen: 'lobby' };
  (window as unknown as { __pralaya: typeof state }).__pralaya = state;
  let names: string[] | null = null;
  const seats = Number(q.get('players') ?? 0);
  if (seats >= 2 && seats <= 6) names = DEFAULT_NAMES.slice(0, seats);
  let seed = Number(q.get('seed') ?? 0) || Math.floor(Math.random() * 1e9);
  for (;;) {
    audio.anthem(true);
    if (!names) names = await lobby();
    const g = createGame(names, seed);
    state.screen = 'deal';
    await deal(g);
    state.screen = 'match';
    audio.anthem(true, 'bed');
    (window as unknown as { __game?: typeof g }).__game = g;
    const view = el('main', 'match');
    app.replaceChildren(view);
    mountUi(view);
    const d = new Director(view, g, audio, fx);
    await d.init();
    const r = await d.run(play(g));
    audio.setMood('calm');
    audio.anthem(true);
    const next = await crown(g, r);
    seed = Math.floor(Math.random() * 1e9);
    if (next === 'new') names = null;
  }
}
void main();
