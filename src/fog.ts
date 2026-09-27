import type { KeyColor } from './assets';
import { isWall, lineOfSight, type Level } from './level';

/** What decides what a meerkat can see. */
export interface VisionOptions {
  /** keys this meerkat holds: gates of these colours do not block the view */
  keys?: ReadonlySet<KeyColor>;
  /** the gates in the level (gone ones are ignored) */
  gates?: readonly { x: number; y: number; color: KeyColor; gone?: boolean }[];
  /** star power: everything is lit */
  clear?: boolean;
}

/**
 * Fog of war: a circle of light around the meerkat. Walls do not block the light, but a gate
 * you have no key for does: the places behind it stay dark. Everything outside the circle is
 * dark; places you have seen are remembered for the map (`explored`).
 */
export class Fog {
  readonly explored: boolean[][];
  visible: number[][]; // 0 = dark, 1 = fully lit
  private canvas: HTMLCanvasElement | null = null;
  private region: Uint8Array | null = null;
  private regionKey = '';

  constructor(private level: Level, public radius = level.fogRadius ?? 5) {
    this.explored = level.tiles.map(r => r.map(() => false));
    this.visible = level.tiles.map(r => r.map(() => 0));
  }

  /**
   * Tiles you could walk to from (ox, oy) without going through a locked gate.
   * Crates, bars and red zones do not stop the view. Cached until you move to another tile
   * or your keys change.
   */
  private visionRegion(ox: number, oy: number, opts: VisionOptions): Uint8Array {
    const { level } = this;
    const locked = (opts.gates ?? []).filter(g => !g.gone && !opts.keys?.has(g.color));
    const cacheKey = `${ox},${oy}|${locked.map(g => `${g.x},${g.y}`).join(';')}`;
    if (this.region && cacheKey === this.regionKey) return this.region;
    const W = level.width, H = level.height;
    const region = new Uint8Array(W * H);
    const blocked = new Set(locked.map(g => g.y * W + g.x));
    const stack: number[] = [];
    if (!isWall(level, ox, oy)) { region[oy * W + ox] = 1; stack.push(oy * W + ox); }
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W, y = (i - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (isWall(level, nx, ny)) continue;
        const j = ny * W + nx;
        if (region[j]) continue;
        region[j] = 1;
        if (!blocked.has(j)) stack.push(j); // you can see the gate itself, not past it
      }
    }
    this.region = region;
    this.regionKey = cacheKey;
    return region;
  }

  /** Is tile (x, y) in the circle and in view? Returns 0..1 (soft edge). */
  private light(x: number, y: number, px: number, py: number, region: Uint8Array): number {
    const d = Math.hypot(x - px, y - py);
    if (d > this.radius + 0.5) return 0;
    const W = this.level.width;
    let seen = region[y * W + x] === 1;
    if (!seen && isWall(this.level, x, y)) {
      // walls show when they border a place you can see
      for (let dy = -1; dy <= 1 && !seen; dy++) for (let dx = -1; dx <= 1 && !seen; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < this.level.height && region[ny * W + nx]) seen = true;
      }
    }
    return seen ? Math.max(0, Math.min(1, (this.radius + 0.5 - d) / 1.5)) : 0;
  }

  /** Recompute what is lit around a (fractional) tile position. */
  update(px: number, py: number, opts: VisionOptions = {}) {
    const { level } = this;
    const region = opts.clear ? null : this.visionRegion(Math.round(px), Math.round(py), opts);
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        const v = region ? this.light(x, y, px, py, region) : 1;
        this.visible[y][x] = v;
        if (v > 0.2) this.explored[y][x] = true;
      }
    }
  }

  /** Mark what a friend at (px, py) can see as explored (shared map), without lighting it up for us. */
  reveal(px: number, py: number, opts: VisionOptions = {}) {
    const { level } = this;
    const saved = [this.region, this.regionKey] as const;
    const region = this.visionRegion(Math.round(px), Math.round(py), opts);
    const r = Math.ceil(this.radius);
    const ox = Math.round(px), oy = Math.round(py);
    for (let y = Math.max(0, oy - r); y <= Math.min(level.height - 1, oy + r); y++) {
      for (let x = Math.max(0, ox - r); x <= Math.min(level.width - 1, ox + r); x++) {
        if (!this.explored[y][x] && this.light(x, y, px, py, region) > 0.2) this.explored[y][x] = true;
      }
    }
    [this.region, this.regionKey] = saved; // keep our own cached region
  }

  /** True if no wall stands between the two tiles. */
  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    return lineOfSight(this.level, x0, y0, x1, y1);
  }

  /**
   * Draw the fog over the world: everything that is not lit right now is dark. The fog map is
   * 1 pixel per tile and gets stretched with smoothing on, which gives soft edges for free.
   */
  draw(ctx: CanvasRenderingContext2D, tile: number, liftY: number) {
    const W = this.level.width, H = this.level.height;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      // one extra cell of padding around the maze so the fog also covers raised border walls
      this.canvas.width = W + 2;
      this.canvas.height = H + 2;
    }
    const fctx = this.canvas.getContext('2d')!;
    const img = fctx.createImageData(W + 2, H + 2);
    for (let py = 0; py < H + 2; py++) {
      for (let px = 0; px < W + 2; px++) {
        const x = Math.min(W - 1, Math.max(0, px - 1)), y = Math.min(H - 1, Math.max(0, py - 1));
        const a = 1 - this.visible[y][x];
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
