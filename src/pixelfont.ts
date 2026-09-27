import type { Img } from './assets';

// font8x8.png: 15 glyphs per row, 8x8 each, ASCII starting at space (32).
const COLS = 15, CELL = 8;
export const GLYPH_ADVANCE = 7;
export const LINE_HEIGHT = 9;

const tinted = new Map<string, HTMLCanvasElement>();

function fontIn(font: Img, color: string): HTMLCanvasElement {
  let c = tinted.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = font.width; c.height = font.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(font, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    tinted.set(color, c);
  }
  return c;
}

export function textWidth(text: string): number {
  return text.length * GLYPH_ADVANCE;
}

export function drawText(ctx: CanvasRenderingContext2D, font: Img, text: string, x: number, y: number, color = '#2b1a12', scale = 1) {
  const src = fontIn(font, color);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) - 32;
    if (code <= 0 || code >= COLS * 8) continue;
    const sx = (code % COLS) * CELL, sy = Math.floor(code / COLS) * CELL;
    ctx.drawImage(src, sx, sy, CELL, CELL, Math.round(x + i * GLYPH_ADVANCE * scale), Math.round(y), CELL * scale, CELL * scale);
  }
}

/** Greedy word wrap to at most `maxChars` characters per line. */
export function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > maxChars) { lines.push(line); line = word; }
    else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  return lines;
}
