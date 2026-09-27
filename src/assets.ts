import tilesetUrl from './assets/ninja-adventure/tileset.png';
import coinUrl from './assets/ninja-adventure/coin-2.png';
import keyUrl from './assets/ninja-adventure/gold-key.png';
import fontUrl from './assets/ninja-adventure/font8x8.png';
import starOrbUrl from './assets/ninja-adventure/fx-star-orb.png';
import twinkleUrl from './assets/ninja-adventure/fx-twinkle.png';
import dustUrl from './assets/ninja-adventure/fx-dust.png';
import meerkatPlayerUrl from './assets/meerkat/meerkat-player.png';
import meerkatNpc1Url from './assets/meerkat/meerkat-npc1.png';
import meerkatNpc2Url from './assets/meerkat/meerkat-npc2.png';
import meerkatNpc3Url from './assets/meerkat/meerkat-npc3.png';
import meerkatNpc4Url from './assets/meerkat/meerkat-npc4.png';

export type KeyColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'pink';

/** Hue (degrees) for each key / gate colour. */
export const KEY_HUES: Record<KeyColor, number> = {
  red: 0, orange: 25, yellow: 45, green: 120, blue: 210, pink: 315,
};

export type Img = HTMLImageElement | HTMLCanvasElement;

export interface Assets {
  tileset: Img;
  /** tileset with the sandy cliffs recoloured purple (the marker colour of the paper maze) */
  wallset: Img;
  coin: Img;
  keys: Record<KeyColor, Img>;
  /** golden keyhole block, recoloured per gate colour */
  gates: Record<KeyColor, Img>;
  font: Img;
  starOrb: Img;
  twinkle: Img;
  dust: Img;
  meerkats: Img[]; // [player, npc1..npc4]
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load ' + url));
    img.src = url;
  });
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Copy of `img` with every coloured pixel's hue rotated by `shift` degrees (greys untouched). */
export function hueShift(img: Img, shift: number, satMul = 1, lightMul = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    if (s < 0.08) continue;
    const [r, g, b] = hslToRgb(h + shift, Math.min(1, s * satMul), Math.min(1, l * lightMul));
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

/** Cut a region out of a sheet into its own canvas. */
export function crop(img: Img, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, w, h);
  return c;
}

export async function loadAssets(): Promise<Assets> {
  const [tileset, coin, key, font, starOrb, twinkle, dust, ...meerkats] = await Promise.all([
    load(tilesetUrl), load(coinUrl), load(keyUrl), load(fontUrl), load(starOrbUrl), load(twinkleUrl), load(dustUrl),
    load(meerkatPlayerUrl), load(meerkatNpc1Url), load(meerkatNpc2Url), load(meerkatNpc3Url), load(meerkatNpc4Url),
  ]);
  const keyhole = crop(tileset, 160, 192, 16, 16); // golden keyhole block
  const keys = {} as Record<KeyColor, Img>;
  const gates = {} as Record<KeyColor, Img>;
  for (const [color, hue] of Object.entries(KEY_HUES) as [KeyColor, number][]) {
    keys[color] = hueShift(key, hue - KEY_HUES.yellow, 1.1);
    gates[color] = hueShift(keyhole, hue - KEY_HUES.yellow, 1.1);
  }
  return {
    tileset,
    wallset: hueShift(tileset, 245, 0.55, 0.88),
    coin, keys, gates, font, starOrb, twinkle, dust, meerkats,
  };
}
