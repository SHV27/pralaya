/**
 * PRALAYA art: every creature in src/game/v8/creatures.ts without a painting in public/art gets TAKES raw takes in
 * assets/art-src/<id>-<take>.webp. FLUX.1 [schnell] (Apache-2.0) on a public HF Space first (the owner's HF login if HF_TOKEN is
 * set in the shell — never printed or stored), the AI Horde (anonymous key, Juggernaut XL) as the fallback. Zero money.
 *   HF_TOKEN="$(cat ~/.cache/huggingface/token)" node scripts/gen-art8.mjs [id ...]
 * Then pick takes in assets/art-src/picks.json, `python scripts/cut-art.py`, `node scripts/art-licenses.mjs`.
 */
import fs from 'node:fs';

const { CREATURES } = await import('../src/game/v8/creatures.ts');
const { HEROES } = await import('../src/game/v8/cards.ts');
/** Heroes are cut out like creatures; scenes (the world petals, the centre fire, the cosmic table) are kept whole. */
const HERO_JOBS = HEROES.map((h) => ({ id: h.id, art: `${h.art}, warm painted adventure portrait` }));
const SCENE_STYLE = 'epic fantasy landscape painting, rich oil painting texture, cinematic light, highly detailed, no text, no people, no creatures, no border';
const SCENES = {
  'world-india': 'a monsoon-lit ancient stone temple tank and banyan forest at dusk, saffron and temple gold light, deep indigo sky, carved pillars half swallowed by roots',
  'world-olympus': 'a marble mountain citadel above storm clouds, burnished gold light, lightning in a deep blue sky, broken columns and a rainbow bridge',
  'world-cosmos': 'a swirling black hole with a blazing accretion disc in a violet and teal nebula, floating asteroids and starlight silver',
  'world-pirate': 'a stormy sea of sea green and rum amber with a wrecked galleon, a lighthouse on black rocks and churning waves',
  'world-night': 'a moonlit haunted forest of midnight blue and silver, candle-lit lanterns in twisted trees, mist and a crooked bell tower',
  'world-lost': 'a primeval ice-age valley of glacier blue and fossil amber, tar pits, giant ferns and bones of ancient beasts',
  'world-toon': 'a whimsical storybook town of candy pastels and bold ink outlines, crooked chimneys, a giant anvil hanging from a crane, cream paper sky',
  'world-wild': 'a dense emerald jungle with wet bark, hanging vines, torch-gold light through the canopy and a crumbling stone idol of a snake',
  'centre-fire': 'a sacred cosmic bonfire burning in a ring of ancient carved stones seen from above, embers spiralling up into darkness, gold and crimson',
  'table': 'an antique dark wooden game table seen from directly above, carved brass inlays, candlelight, scattered star charts, very dark vignette edges',
};

const SRC = 'assets/art-src';
const TAKES = Number(process.env.TAKES ?? 2);
const STYLE =
  'epic fantasy creature card art, rich oil painting texture, dramatic rim light, highly detailed, cinematic, isolated on a plain flat light grey background, whole body visible, centered, no text, no frame, no border';
const FLUX = process.env.FLUX ?? 'https://evalstate-flux1-schnell.hf.space';
const FH = {
  'Content-Type': 'application/json',
  ...(process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {}),
};
const HORDE = 'https://aihorde.net/api/v2';
const HH = {
  'Content-Type': 'application/json',
  apikey: '0000000000',
  'Client-Agent': 'pralaya-studio:8:shv27',
};
const NEG =
  'text, watermark, signature, frame, border, blurry, deformed, extra limbs, extra heads, cropped, nsfw';

const prompt = (c) => `${c.art.replace(/,?\s*plain dark background/gi, '').replace(/\.$/, '')}, ${STYLE}`;

async function flux(p, seed) {
  const r = await fetch(`${FLUX}/gradio_api/call/infer`, {
    method: 'POST',
    headers: FH,
    body: JSON.stringify({ data: [p, seed, false, 768, 1024, 4] }),
  });
  const { event_id } = await r.json();
  const t = await (await fetch(`${FLUX}/gradio_api/call/infer/${event_id}`, { headers: FH })).text();
  const u = t.match(/"url": "([^"]+)"/)?.[1];
  if (!u) throw new Error(`flux: ${t.slice(0, 140)}`);
  return Buffer.from(await (await fetch(u, { headers: FH })).arrayBuffer());
}
/** The Horde allows two submissions a second: every painter in this process queues through one gate (1.2 s apart). */
let gate = Promise.resolve();
const throttle = () => (gate = gate.then(() => new Promise((ok) => setTimeout(ok, 1200 + Math.random() * 800))));
async function horde(p, seed, tries = 0) {
  await throttle();
  const r = await fetch(`${HORDE}/generate/async`, {
    method: 'POST',
    headers: HH,
    body: JSON.stringify({
      prompt: `${p} ### ${NEG}`,
      params: {
        width: 768,
        height: 1024,
        // FLUX.1 [schnell] on the Horde (MODEL='Flux.1-Schnell fp8 (Compact)'): 4 steps, cfg 1, euler. SDXL: 28 steps, cfg 6.
        steps: Number(process.env.STEPS ?? 28),
        cfg_scale: Number(process.env.CFG ?? 6),
        sampler_name: process.env.SAMPLER ?? 'k_dpmpp_2m',
        karras: !process.env.SAMPLER,
        seed: String(seed),
        n: 1,
      },
      models: [process.env.MODEL ?? 'Juggernaut XL'],
      nsfw: false,
      censor_nsfw: true,
      r2: true,
    }),
  });
  const j = await r.json();
  if (!j.id && /per 1 second/.test(JSON.stringify(j)) && tries < 20) return horde(p, seed, tries + 1);
  if (!j.id) throw new Error(`horde: ${JSON.stringify(j).slice(0, 140)}`);
  const t0 = Date.now();
  for (;;) {
    await new Promise((res) => setTimeout(res, 8000));
    const c = await (await fetch(`${HORDE}/generate/check/${j.id}`, { headers: HH })).json();
    if (c.done) break;
    if (c.faulted || Date.now() - t0 > 20 * 60000) throw new Error('horde faulted/timeout');
  }
  const s = await (await fetch(`${HORDE}/generate/status/${j.id}`, { headers: HH })).json();
  const img = s.generations?.[0]?.img;
  if (!img) throw new Error('horde: no image');
  return Buffer.from(await (await fetch(img)).arrayBuffer());
}
async function take(c, t) {
  const file = `${SRC}/${c.id}-${t}.webp`;
  if (fs.existsSync(file)) return;
  const seed = 8000 + t * 101 + [...c.id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  let buf;
  for (let i = 0; i < 3 && !buf; i++) {
    try {
      buf = process.env.BACKEND === 'horde' ? await horde(prompt(c), seed) : await flux(prompt(c), seed);
    } catch (e) {
      console.log('retry', c.id, t, String(e).slice(0, 120));
      if (i === 1 && process.env.BACKEND !== 'horde')
        try {
          buf = await horde(prompt(c), seed);
        } catch (e2) {
          console.log('horde failed', c.id, String(e2).slice(0, 100));
        }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  if (!buf) return console.log('FAILED', c.id, t);
  fs.writeFileSync(file, buf);
  console.log('ok', c.id, t);
}

const only = new Set(process.argv.slice(2));
if (process.env.KIND === 'heroes' || process.env.KIND === 'scenes') {
  const jobs =
    process.env.KIND === 'heroes'
      ? HERO_JOBS.map((h) => ({ ...h, prompt: `${h.art}, ${STYLE}` }))
      : Object.entries(SCENES).map(([id, d]) => ({ id, art: d, prompt: `${d}, ${SCENE_STYLE}` }));
  const q2 = jobs.filter((j) => !only.size || only.has(j.id)).flatMap((j) => Array.from({ length: TAKES }, (_, t) => [j, t]));
  await Promise.all(
    Array.from({ length: Number(process.env.JOBS ?? 3) }, async () => {
      while (q2.length) {
        const [j, t] = q2.shift();
        const file = `${SRC}/${j.id}-${t}.webp`;
        if (fs.existsSync(file)) continue;
        for (let i = 0; i < 3; i++)
          try {
            fs.writeFileSync(file, await (process.env.BACKEND === 'horde' ? horde : flux)(j.prompt, 9100 + t * 101 + i));
            console.log('ok', j.id, t);
            break;
          } catch (e) {
            console.log('retry', j.id, t, String(e).slice(0, 80));
            await new Promise((r) => setTimeout(r, 5000));
          }
      }
    }),
  );
  process.exit(0);
}
const todo = CREATURES.filter((c) =>
  only.size ? only.has(c.id) : !fs.existsSync(`public/art/${c.id}.webp`),
);
console.log(`${todo.length} creatures to paint, ${TAKES} takes each`);
const queue = todo.flatMap((c) => Array.from({ length: TAKES }, (_, t) => [c, t]));
// REVERSE=1: a second painter works from the other end of the list (two backends at once never paint the same one twice).
if (process.env.REVERSE) queue.reverse();
// MID=1: a third painter starts in the middle and works outwards.
if (process.env.MID) queue.push(...queue.splice(0, Math.floor(queue.length / 2)));
const N = Number(process.env.JOBS ?? 3);
await Promise.all(
  Array.from({ length: N }, async () => {
    while (queue.length) {
      const [c, t] = queue.shift();
      await take(c, t);
    }
  }),
);
console.log('done');
