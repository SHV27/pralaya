// Renders the PWA icons from the game's own art (the volcano of the Burning Heart on the night of the void): node scripts/icons.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const heart = `data:image/webp;base64,${fs.readFileSync('public/art/land-heart.webp').toString('base64')}`;
const b = await chromium.launch();
for (const [size, pad, name] of [
  [192, 0.08, 'icon-192.png'],
  [512, 0.08, 'icon-512.png'],
  [512, 0.2, 'maskable-512.png'],
  [180, 0.08, 'apple-touch-icon.png'],
]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  const inner = size * (1 - 2 * pad);
  await p.setContent(`<body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;
      background:radial-gradient(circle at 50% 62%, #5a2410 0%, #1d0f22 45%, #07050c 75%)">
    <img src="${heart}" style="width:${inner}px;height:${inner}px;object-fit:contain;filter:drop-shadow(0 0 ${size / 18}px #ff7a2f)"/>
    </body>`);
  await p.waitForTimeout(200);
  await p.screenshot({ path: `public/icons/${name}` });
  await p.close();
}
await b.close();
console.log('icons written');
