/**
 * The PRALAYA watch (a GATE, CLAUDE.md): a real browser plays a whole match with the review hand (?auto=1), saving a frame every
 * `every` seconds, the console, page errors, failed requests and the Director's stall list (a beat that held the table > 40 s).
 * Look at every frame before reporting any test count.
 *   node scripts/watch8.mjs [seconds=600] [seed=7] [speed=1] [players=4] [every=2] [w=1366] [h=768]     URL=... (default preview)
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const [secs = 600, seed = 7, speed = 1, players = 4, every = 2, w = 1366, h = 768] = process.argv
  .slice(2)
  .map(Number);
const out = `tests/artifacts/v8/watch-s${seed}-p${players}-${w}`;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const url = process.env.URL ?? 'http://localhost:4180/';
const b = await chromium.launch({ args: (process.env.GL ?? '--enable-gpu,--ignore-gpu-blocklist,--use-angle=d3d11').split(',') });
const p = await b.newPage({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
const logs = [];
p.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
p.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}`));
p.on('requestfailed', (r) => logs.push(`FAILED: ${r.url()} ${r.method()} ${r.failure()?.errorText}`));
await p.goto(`${url}?auto=1&seed=${seed}&speed=${speed}&players=${players}&mute=1`);
const t0 = Date.now();
let i = 0;
let state = {};
while ((Date.now() - t0) / 1000 < secs) {
  await p.waitForTimeout(every * 1000);
  state = await p.evaluate(() => ({
    screen: window.__pralaya?.crowns ? 'crown' : window.__pralaya?.screen,
    caption: document.querySelector('.caption.on')?.textContent?.slice(0, 80) ?? '',
    stalls: window.__stalls ?? [],
  }));
  await p.screenshot({ path: `${out}/${String(i).padStart(3, '0')}.jpg`, quality: 70, type: 'jpeg' });
  logs.push(`[${i}] t=${((Date.now() - t0) / 1000).toFixed(0)}s ${JSON.stringify(state)}`);
  i++;
  if (state.screen === 'crown' && i > 3) break;
}
fs.writeFileSync(`${out}/log.txt`, logs.join('\n'));
console.log(
  `screen=${state.screen} after ${((Date.now() - t0) / 1000).toFixed(0)}s · stalls=${JSON.stringify(state.stalls)}`,
);
console.log(
  logs
    .filter((l) => /error|FAILED|warn/i.test(l))
    .slice(0, 20)
    .join('\n') || 'no errors or warnings',
);
console.log(`${i} frames → ${out}`);
await b.close();
