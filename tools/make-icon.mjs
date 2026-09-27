// Draws the app icon (build/icon.png, 512x512): our meerkat on lookout on a purple tile.
// Run: node tools/make-icon.mjs   (after npm run sprites)
import fs from 'node:fs';
import { PNG } from 'pngjs';

const S = 512;
const sheet = PNG.sync.read(fs.readFileSync('src/assets/meerkat/meerkat-player.png'));
const png = new PNG({ width: S, height: S });
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const set = (x, y, [r, g, b], a = 255) => { const k = (y * S + x) * 4; png.data[k] = r; png.data[k + 1] = g; png.data[k + 2] = b; png.data[k + 3] = a; };

// rounded purple tile with a lighter top (like the maze walls)
const R = 96, border = 20;
const inRounded = (x, y, pad) => {
  const lo = pad, hi = S - 1 - pad, r = R - pad;
  const cx = Math.min(Math.max(x, lo + r), hi - r), cy = Math.min(Math.max(y, lo + r), hi - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= lo && x <= hi && y >= lo && y <= hi;
};
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  if (!inRounded(x, y, 0)) continue;
  if (!inRounded(x, y, border)) { set(x, y, hex('#2b1a12')); continue; }
  set(x, y, hex(y < S * 0.62 ? '#8a5fd0' : '#6a3fb5'));
}
// sand mound
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  if (!inRounded(x, y, border)) continue;
  const d = ((x - S / 2) / 200) ** 2 + ((y - 470) / 90) ** 2;
  if (d <= 1) set(x, y, hex(d > 0.9 ? '#2b1a12' : y < 420 ? '#ffe0b0' : '#ffcb8d'));
}
// meerkat: sentry frame (row 5, col 1), 16x24 scaled x16, feet on the mound
const FW = 16, FH = 24, K = 16, ox = (S - FW * K) / 2, oy = 440 - FH * K;
for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
  const k = ((5 * FH + y) * sheet.width + 1 * FW + x) * 4;
  if (sheet.data[k + 3] < 128) continue;
  const c = [sheet.data[k], sheet.data[k + 1], sheet.data[k + 2]];
  for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
    const X = ox + x * K + i, Y = oy + y * K + j;
    if (X >= 0 && Y >= 0 && X < S && Y < S && inRounded(X, Y, border)) set(X, Y, c);
  }
}
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/icon.png', PNG.sync.write(png));
console.log('build/icon.png written');
