/** Contact sheet of the raw art takes, labelled, for picking: node scripts/takes-sheet.mjs [from=0] [count=16] → scratch takes-N.jpg */
import fs from 'node:fs';
import sharp from 'sharp';

const [from = 0, count = 16] = process.argv.slice(2).map(Number);
const out = process.env.OUT ?? 'assets/art-src';
const files = fs
  .readdirSync('assets/art-src')
  .filter((f) => /-\d\.webp$/.test(f))
  .sort();
const only = process.env.IDS ? process.env.IDS.split(',') : null;
const ids = [...new Set(files.map((f) => f.replace(/-\d\.webp$/, '')))]
  .filter((id) => !only || only.includes(id))
  .slice(from, from + count);
const tw = 220;
const th = 293;
const cols = 8;
const tiles = [];
let k = 0;
for (const id of ids)
  for (const t of [0, 1]) {
    const f = `assets/art-src/${id}-${t}.webp`;
    const x = (k % cols) * tw;
    const y = Math.floor(k / cols) * (th + 22);
    k++;
    const label = Buffer.from(
      `<svg width="${tw}" height="22"><rect width="100%" height="100%" fill="#111"/><text x="6" y="16" font-size="14" fill="#fff" font-family="Arial">${id} ${t}</text></svg>`,
    );
    tiles.push({ input: label, left: x, top: y });
    if (fs.existsSync(f))
      tiles.push({
        input: await sharp(f)
          .resize(tw - 4, th)
          .toBuffer(),
        left: x + 2,
        top: y + 22,
      });
  }
const rows = Math.ceil(k / cols);
const file = `${out}/takes-${from}.jpg`;
await sharp({ create: { width: cols * tw, height: rows * (th + 22), channels: 3, background: '#333' } })
  .composite(tiles)
  .jpeg({ quality: 80 })
  .toFile(file);
console.log(file, ids.join(' '));
