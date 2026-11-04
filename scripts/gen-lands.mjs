/**
 * The PRALAYA world: eight floating islands (one per land) + the volcano of the Burning Heart, each painted alone on a plain
 * background so it can be cut out and composed by code (land can crumble into the void, islands can drift and swap).
 * AI Horde, anonymous key, zero money, 1024² upscaled ×2 → assets/land-src/<id>-<take>.webp
 *   node scripts/gen-lands.mjs [takes=2]      ONLY=india,heart to pick
 */
import fs from 'node:fs';

const OUT = 'assets/land-src';
fs.mkdirSync(OUT, { recursive: true });
const HORDE = 'https://aihorde.net/api/v2';
const H = {
  'Content-Type': 'application/json',
  apikey: '0000000000',
  'Client-Agent': 'pralaya-studio:8:shv27',
};
const STYLE =
  'a single floating island chunk of land torn from the earth, seen from above at a three-quarter angle like a miniature diorama, rocky underside with hanging roots tapering to a point, isolated and centred on a plain flat light grey background, hand-painted fantasy board game art, rich oil painting, highly detailed, warm storybook light';
const NEG =
  'text, letters, words, labels, watermark, signature, frame, border, multiple islands, sky, horizon, background scenery, clouds behind, people, modern buildings, cars, blurry';
const LANDS = {
  india:
    'covered in a monsoon jungle of banyan trees, a sunken stone temple tank with lotus flowers, carved saffron sandstone steps and pillars, peacocks, rain-wet and lush',
  olympus:
    'a white marble mountain top with a ruined Greek citadel of columns, a bronze forge glowing, golden light, storm cloud wisps around the rim, an olive grove',
  cosmos:
    'a miniature tabletop diorama on a round stone base: a grey moon crater landscape with glowing violet crystals, a small brass observatory dome with a telescope, a tiny brass rocket, little planets hanging on wires above it',
  pirate:
    'a rocky sea-cliff island with a shipwreck on a turquoise lagoon, a striped lighthouse, palm trees, wooden docks and treasure chests, green stormy surf',
  night:
    'a moonlit haunted forest of crooked bare trees, a leaning gothic bell tower, glowing lanterns in a bog, blue mist, fireflies, eerie and beautiful',
  lost: 'a frozen ice-age valley with snow, giant mammoth tusks and bones, bubbling black tar pits, amber caves, frosted pine trees, prehistoric',
  toon: 'a whimsical candy-coloured cartoon town with crooked chimneys and wobbly houses, a giant anvil, lollipop trees, bouncy bridge, playful and absurd',
  wild: 'a miniature tabletop diorama on a round mossy base: a dense emerald rainforest with a giant stone serpent idol, a small waterfall into a river, a rope bridge, an explorers tent',
  heart:
    'a great black volcano with a sacred bonfire burning on its summit, glowing lava rivers running down, an ancient stone stair spiralling up, carved stone mandala ring at its base, embers rising',
};
const takes = Number(process.argv[2] ?? 2);
const ids = process.env.ONLY ? process.env.ONLY.split(',') : Object.keys(LANDS);
const jobs = ids.flatMap((id) => Array.from({ length: takes }, (_, t) => ({ id, t })));

async function one({ id, t }, i) {
  await new Promise((ok) => setTimeout(ok, i * 4000));
  const body = {
    prompt: `${LANDS[id]}, ${STYLE} ### ${NEG}`,
    params: {
      width: 1024,
      height: 1024,
      steps: 30,
      cfg_scale: 6,
      sampler_name: 'k_dpmpp_2m',
      karras: true,
      seed: String(777 + t * 131 + id.length * 17),
      n: 1,
      post_processing: ['RealESRGAN_x2plus'],
    },
    models: [process.env.MODEL ?? 'Juggernaut XL'],
    nsfw: false,
    censor_nsfw: true,
    r2: true,
  };
  let j;
  for (let a = 0; a < 5; a++) {
    j = await (
      await fetch(`${HORDE}/generate/async`, { method: 'POST', headers: H, body: JSON.stringify(body) })
    ).json();
    if (j.id) break;
    await new Promise((ok) => setTimeout(ok, 5000 + a * 3000));
  }
  if (!j.id) throw new Error(JSON.stringify(j).slice(0, 200));
  const t0 = Date.now();
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 10000));
    const c = await (await fetch(`${HORDE}/generate/check/${j.id}`, { headers: H })).json();
    if (c.done) break;
    if (c.faulted || Date.now() - t0 > 40 * 60000) throw new Error('faulted/timeout');
  }
  const s = await (await fetch(`${HORDE}/generate/status/${j.id}`, { headers: H })).json();
  const img = s.generations?.[0]?.img;
  fs.writeFileSync(`${OUT}/${id}-${t}.webp`, Buffer.from(await (await fetch(img)).arrayBuffer()));
  console.log('ok', id, t);
}
await Promise.all(
  jobs.map((job, i) => one(job, i).catch((e) => console.log('fail', job.id, job.t, String(e).slice(0, 160)))),
);
