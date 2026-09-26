import type { Img } from './assets';

// Sprite sheet rows (see tools/make-meerkat.mjs)
export const FRAME_W = 16, FRAME_H = 24;
export type Dir = 'down' | 'up' | 'left' | 'right';
export type Anim = 'idle' | 'walk' | 'sentry';

const WALK_ROW: Record<Dir, number> = { down: 1, up: 2, left: 3, right: 4 };

/** Which frame of the sheet to show. `t` is seconds spent in the current animation. */
export function meerkatFrame(anim: Anim, dir: Dir, t: number): { row: number; col: number } {
  switch (anim) {
    case 'walk': return { row: WALK_ROW[dir], col: Math.floor(t * 10) % 4 };
    case 'sentry': {
      // look left, centre, right, centre... with a pause on each
      const seq = [0, 1, 1, 2, 1, 1];
      return { row: 5, col: seq[Math.floor(t * 2.2) % seq.length] };
    }
    default:
      // facing sideways/up while idle keeps the first walk frame; front uses the breathing loop
      if (dir !== 'down') return { row: WALK_ROW[dir], col: 1 };
      return { row: 0, col: Math.floor(t * 1.6) % 2 };
  }
}

/** Draw a meerkat with its feet at (fx, fy), in world pixels. */
export function drawMeerkat(ctx: CanvasRenderingContext2D, sheet: Img, anim: Anim, dir: Dir, t: number, fx: number, fy: number) {
  const { row, col } = meerkatFrame(anim, dir, t);
  // soft shadow
  ctx.fillStyle = 'rgba(40, 20, 10, 0.28)';
  ctx.beginPath();
  ctx.ellipse(Math.round(fx), Math.round(fy - 1), 5, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(sheet, col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H,
    Math.round(fx - FRAME_W / 2), Math.round(fy - FRAME_H), FRAME_W, FRAME_H);
}
