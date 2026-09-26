import { isWall, type Level } from './level';

/** Fog of war: what the meerkat can see right now, and what it has seen before. */
export class Fog {
  readonly explored: boolean[][];
  visible: number[][]; // 0 = hidden, 1 = fully lit
  private canvas: HTMLCanvasElement;

  constructor(private level: Level, public radius = 5) {
    this.explored = level.tiles.map(r => r.map(() => false));
    this.visible = level.tiles.map(r => r.map(() => 0));
    this.canvas = document.createElement('canvas');
    // one extra cell of padding around the maze so the fog also covers raised border walls
    this.canvas.width = level.width + 2;
    this.canvas.height = level.height + 2;
  }

  /** Recompute visibility from a (fractional) tile position. */
  update(px: number, py: number, clear = false) {
    const { level, radius } = this;
    const ox = Math.round(px), oy = Math.round(py);
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        const d = Math.hypot(x - px, y - py);
        let v = 0;
        if (clear) v = 1;
        else if (d <= radius + 0.5 && this.lineOfSight(ox, oy, x, y)) {
          v = Math.max(0, Math.min(1, (radius + 0.5 - d) / 1.5));
        }
        this.visible[y][x] = v;
        if (v > 0.2) this.explored[y][x] = true;
      }
    }
  }

  /** Bresenham walk; walls block sight but the wall itself can be seen. */
  private lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    while (!(x === x1 && y === y1)) {
      if ((x !== x0 || y !== y0) && isWall(this.level, x, y)) return false;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    return true;
  }

  /**
   * Draw the fog over the world. The fog map is 1 pixel per tile and gets stretched
   * with smoothing on, which gives soft edges for free.
   */
  draw(ctx: CanvasRenderingContext2D, tile: number, liftY: number) {
    const fctx = this.canvas.getContext('2d')!;
    const W = this.level.width, H = this.level.height;
    const img = fctx.createImageData(W + 2, H + 2);
    for (let py = 0; py < H + 2; py++) {
      for (let px = 0; px < W + 2; px++) {
        const x = Math.min(W - 1, Math.max(0, px - 1)), y = Math.min(H - 1, Math.max(0, py - 1));
        const v = this.visible[y][x];
        const a = this.explored[y][x] ? 0.62 * (1 - v) : 1 - v;
        const i = (py * (W + 2) + px) * 4;
        img.data[i] = 16; img.data[i + 1] = 10; img.data[i + 2] = 24; img.data[i + 3] = a * 255;
      }
    }
    fctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    // Shift up a little so raised wall tops share their cell's fog.
    ctx.drawImage(this.canvas, -tile, -tile - liftY, (W + 2) * tile, (H + 2) * tile);
    ctx.restore();
  }
}
