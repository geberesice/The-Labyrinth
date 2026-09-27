import type { Assets, Img } from './assets';
import type { LiveThing } from './game/state';
import { isWall, type Level, type Npc } from './level';
import { drawMeerkat, type Anim, type Dir } from './meerkat';
import { drawText, GLYPH_ADVANCE, LINE_HEIGHT, textWidth, wrap } from './pixelfont';

export const TILE = 16;
/** How far wall tops are raised (px) - the visible height of the cliff face. */
export const LIFT = 8;

// Tileset coordinates (Ninja Adventure tileset.png)
const FLOOR = { x: 336, y: 208 }; // plain sand
const WALL_TOP = { x: 0, y: 192 }; // 48x32 plateau top: 8px corners/edges around a middle
const WALL_FACE_Y = 224; // cliff face below the plateau
const CRATE = { x: 32, y: 96 }; // wooden crate
const EXIT = { x: 144, y: 208 };
const GEM = { x: 128, y: 192 };

export interface Actor {
  x: number; y: number; // tile coords (fractional while moving)
  sheet: Img; anim: Anim; dir: Dir; t: number;
  npc?: Npc;
}

export interface Bubble { text: string; x: number; y: number }

export interface Particle { kind: 'dust' | 'twinkle' | 'spark'; x: number; y: number; t: number; color?: string }

/** What the renderer needs to know about the live game. */
export interface Scene {
  things: LiveThing[];
  barsOpen: boolean;
  /** gates that the player may pass (they sink into the ground) */
  openGates: Set<LiveThing>;
}

export class WorldRenderer {
  constructor(private a: Assets, private level: Level) {}

  /** Draw floors, walls, things and actors depth-sorted by row. Coordinates are world pixels. */
  /** Returns speech bubbles to draw on top (in world pixels: centre x, bottom y). */
  draw(ctx: CanvasRenderingContext2D, time: number, scene: Scene, actors: Actor[], particles: Particle[], player: Actor): Bubble[] {
    const { level } = this;
    // --- floor pass ---
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        if (level.tiles[y][x] === 'wall') continue;
        this.floor(ctx, x, y);
        if (level.timed[y][x]) this.timedZone(ctx, x, y, time);
      }
    }
    // --- depth pass: row by row, walls/blocks first, then things and actors standing in that row ---
    const byRow = new Map<number, (() => void)[]>();
    const add = (row: number, fn: () => void) => { if (!byRow.has(row)) byRow.set(row, []); byRow.get(row)!.push(fn); };
    for (const th of scene.things) if (!th.gone) add(th.y, () => this.thing(ctx, th, time, scene));
    for (const ac of actors) add(Math.floor(ac.y + 0.5), () => this.actor(ctx, ac));
    for (const p of particles) add(Math.floor(p.y + 0.5), () => this.particle(ctx, p));
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) if (level.tiles[y][x] === 'wall') this.wall(ctx, x, y);
      for (const fn of byRow.get(y) ?? []) fn();
    }
    // --- speech bubbles for meerkats close to the player ---
    const bubbles: Bubble[] = [];
    for (const ac of actors) {
      if (!ac.npc) continue;
      const d = Math.hypot(ac.x - player.x, ac.y - player.y);
      if (d < 2.6) bubbles.push({ text: ac.npc.text, x: ac.x * TILE + TILE / 2, y: ac.y * TILE - 10 - (ac.npc.variant === 'spiky' ? 8 : 0) });
    }
    return bubbles;
  }

  private floor(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.drawImage(this.a.tileset, FLOOR.x, FLOOR.y, TILE, TILE, x * TILE, y * TILE, TILE, TILE);
    // sand speckles and the odd pebble, stable per tile
    let h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const rnd = () => { h = (h * 1103515245 + 12345) >>> 0; return (h >>> 16) / 65536; };
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(214, 140, 80, 0.35)' : 'rgba(255, 236, 200, 0.6)';
      ctx.fillRect(x * TILE + Math.floor(rnd() * 15), y * TILE + Math.floor(rnd() * 15), 1, 1);
    }
    if (rnd() < 0.12) {
      const px = x * TILE + 2 + Math.floor(rnd() * 11), py = y * TILE + 2 + Math.floor(rnd() * 11);
      ctx.fillStyle = '#c98a55'; ctx.fillRect(px, py, 3, 2);
      ctx.fillStyle = '#e8b27a'; ctx.fillRect(px, py, 2, 1);
    }
  }

  private timedZone(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
    const pulse = 0.3 + 0.15 * Math.sin(time * 4);
    ctx.fillStyle = `rgba(230, 40, 40, ${pulse})`;
    ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    // dotted red border on the sides that face normal floor (like the dotted lines on the paper)
    ctx.fillStyle = '#d0302a';
    const L = this.level;
    const edge = (nx: number, ny: number) => !isWall(L, nx, ny) && !L.timed[ny][nx];
    const march = Math.floor(time * 6) % 4;
    for (let i = 0; i < TILE; i += 4) {
      const o = (i + march) % TILE;
      if (edge(x, y - 1)) ctx.fillRect(x * TILE + o, y * TILE, 2, 1);
      if (edge(x, y + 1)) ctx.fillRect(x * TILE + o, y * TILE + TILE - 1, 2, 1);
      if (edge(x - 1, y)) ctx.fillRect(x * TILE, y * TILE + o, 1, 2);
      if (edge(x + 1, y)) ctx.fillRect(x * TILE + TILE - 1, y * TILE + o, 1, 2);
    }
  }

  /** Raised wall: 4 quarter-tiles picked from the plateau 9-slice, plus a cliff face if open below. */
  private wall(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const L = this.level, img = this.a.wallset;
    const W = (dx: number, dy: number) => isWall(L, x + dx, y + dy);
    const up = W(0, -1), down = W(0, 1), left = W(-1, 0), right = W(1, 0);
    const px = x * TILE, py = y * TILE - LIFT;
    const q = (sx: number, sy: number, dx: number, dy: number) =>
      ctx.drawImage(img, WALL_TOP.x + sx, WALL_TOP.y + sy, 8, 8, px + dx, py + dy, 8, 8);
    q(left ? 16 : 0, up ? 12 : 0, 0, 0);
    q(right ? 24 : 40, up ? 12 : 0, 8, 0);
    q(left ? 16 : 0, down ? 12 : 24, 0, 8);
    q(right ? 24 : 40, down ? 12 : 24, 8, 8);
    if (!down) {
      const faceL = left && !W(-1, 1), faceR = right && !W(1, 1);
      const fy = py + TILE;
      const f = (sx: number, sy: number, h: number, dx: number, dy: number) =>
        ctx.drawImage(img, sx, sy, 8, h, px + dx, fy + dy, 8, h);
      f(faceL ? 16 : 0, WALL_FACE_Y, 4, 0, 0);
      f(faceR ? 24 : 40, WALL_FACE_Y, 4, 8, 0);
      f(faceL ? 16 : 0, WALL_FACE_Y + 44, LIFT - 4, 0, 4);
      f(faceR ? 24 : 40, WALL_FACE_Y + 44, LIFT - 4, 8, 4);
    }
  }

  private thing(ctx: CanvasRenderingContext2D, th: LiveThing, time: number, scene: Scene) {
    let px = th.x * TILE, py = th.y * TILE;
    if (th.slideT !== undefined && th.slideT < 1) {
      px = Math.round((th.fromX! + (th.x - th.fromX!) * th.slideT) * TILE);
      py = Math.round((th.fromY! + (th.y - th.fromY!) * th.slideT) * TILE);
    }
    const bob = Math.round(Math.sin(time * 3 + th.x + th.y) * 1.5);
    switch (th.kind) {
      case 'coin': {
        const f = Math.floor(time * 8 + th.x) % 4;
        this.shadow(ctx, px + 8, py + 10, 3);
        ctx.drawImage(this.a.coin, f * 10, 0, 10, 10, px + 3, py + bob, 10, 10);
        break;
      }
      case 'gem':
        this.shadow(ctx, px + 8, py + 10, 5);
        ctx.drawImage(this.a.tileset, GEM.x, GEM.y, TILE, TILE, px, py - 5 + bob, TILE, TILE);
        break;
      case 'key':
        this.shadow(ctx, px + 8, py + 10, 4);
        ctx.drawImage(this.a.keys[th.color], px + 2, py + 1 + bob);
        break;
      case 'star': {
        this.shadow(ctx, px + 8, py + 10, 5);
        // glow
        const g = 0.25 + 0.15 * Math.sin(time * 5);
        ctx.fillStyle = `rgba(255, 200, 80, ${g})`;
        ctx.beginPath(); ctx.arc(px + 8, py + 1 + bob, 10, 0, Math.PI * 2); ctx.fill();
        drawStar(ctx, px + 8, py + 1 + bob, 8, time * 1.5);
        break;
      }
      case 'gate': {
        // a keyhole block, raised like a short wall; it sinks into the sand for a meerkat with the key
        const open = scene.openGates.has(th);
        ctx.fillStyle = 'rgba(40,20,10,0.3)';
        ctx.fillRect(px + 1, py + 12, 14, 4);
        if (open) {
          // you have the key: the block turns see-through and sparkles
          ctx.globalAlpha = 0.35 + 0.1 * Math.sin(time * 6);
          ctx.drawImage(this.a.gates[th.color], px, py - 4);
          ctx.globalAlpha = 1;
          if (Math.floor(time * 4) % 2) { ctx.fillStyle = '#fff4d6'; ctx.fillRect(px + 3, py - 2, 1, 1); ctx.fillRect(px + 12, py + 6, 1, 1); }
          else { ctx.fillStyle = '#fff4d6'; ctx.fillRect(px + 11, py - 1, 1, 1); ctx.fillRect(px + 4, py + 7, 1, 1); }
        } else {
          ctx.drawImage(this.a.gates[th.color], px, py - 4);
        }
        break;
      }
      case 'crate': {
        ctx.fillStyle = 'rgba(40,20,10,0.3)';
        ctx.fillRect(px + 1, py + 12, 14, 4);
        ctx.drawImage(this.a.tileset, CRATE.x, CRATE.y, TILE, TILE, px, py - 4, TILE, TILE);
        // pulsing arrows: "you can push me"
        const o = Math.floor((Math.sin(time * 5) + 1) * 1);
        ctx.fillStyle = '#fff4d6';
        for (const [ax, ay, dx, dy] of [[-4 - o, 4, -1, 0], [TILE + 3 + o, 4, 1, 0]] as const) {
          for (let i = 0; i < 3; i++) ctx.fillRect(px + ax - dx * i, py + ay - i, 1, 1 + i * 2);
          void dy;
        }
        break;
      }
      case 'bars': this.bars(ctx, px, py - (scene.barsOpen ? LIFT + 6 : 0), scene.barsOpen); break;
      case 'exit': {
        ctx.drawImage(this.a.tileset, EXIT.x, EXIT.y, TILE, TILE, px, py, TILE, TILE);
        const f = Math.floor(time * 10) % 12;
        if (f < 6) ctx.drawImage(this.a.twinkle, f * 32, 0, 32, 32, px - 8, py - 14, 32, 32);
        const label = 'EXIT';
        const w = textWidth(label);
        drawText(ctx, this.a.font, label, px + 8 - w / 2 + 1, py - 18 + bob + 1, '#2b1a12');
        drawText(ctx, this.a.font, label, px + 8 - w / 2, py - 18 + bob, '#ffe066');
        break;
      }
    }
  }

  private bars(ctx: CanvasRenderingContext2D, px: number, py: number, open: boolean) {
    const top = py - LIFT;
    ctx.globalAlpha = open ? 0.5 : 1;
    ctx.fillStyle = '#2b1a12';
    ctx.fillRect(px, top + 1, TILE, 2);
    ctx.fillRect(px, py + 7, TILE, 2);
    for (let i = 1; i < TILE; i += 4) {
      ctx.fillStyle = '#2b1a12';
      ctx.fillRect(px + i, top, 3, LIFT + TILE - 1);
      ctx.fillStyle = '#8a8fa3';
      ctx.fillRect(px + i + 1, top + 1, 1, LIFT + TILE - 3);
    }
    ctx.globalAlpha = 1;
  }

  private shadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.fillStyle = 'rgba(40, 20, 10, 0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y, r, Math.max(1, r / 2.5), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private actor(ctx: CanvasRenderingContext2D, ac: Actor) {
    const fx = ac.x * TILE + TILE / 2, fy = ac.y * TILE + TILE - 1;
    drawMeerkat(ctx, ac.sheet, ac.anim, ac.dir, ac.t, fx, fy);
    if (ac.npc?.variant === 'spiky') this.spikyBall(ctx, fx, fy - 10, ac.t);
  }

  /** The "sun" from the drawing: a meerkat sitting inside a spiky ball. */
  private spikyBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, t: number) {
    const R = 12, spikes = 12, rot = t * 0.6;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 220, 120, 0.22)';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7a3fb0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#9b59d0';
    for (let i = 0; i < spikes; i++) {
      const a = rot + (i / spikes) * Math.PI * 2, b = 0.18;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a - b) * R, cy + Math.sin(a - b) * R);
      ctx.lineTo(cx + Math.cos(a) * (R + 5), cy + Math.sin(a) * (R + 5));
      ctx.lineTo(cx + Math.cos(a + b) * R, cy + Math.sin(a + b) * R);
      ctx.fill();
    }
    ctx.restore();
  }

  private particle(ctx: CanvasRenderingContext2D, p: Particle) {
    if (p.kind === 'spark') {
      // star-power trail: little fading sparks
      ctx.globalAlpha = Math.max(0, 1 - p.t * 2);
      ctx.fillStyle = p.color ?? '#ffd24a';
      ctx.fillRect(Math.round(p.x * TILE + TILE / 2 - 1), Math.round(p.y * TILE + TILE - 8 - p.t * 10), 2, 2);
      ctx.globalAlpha = 1;
      return;
    }
    const img = p.kind === 'dust' ? this.a.dust : this.a.twinkle;
    const frames = img.width / 32;
    const f = Math.floor(p.t * 14);
    if (f >= frames) return;
    ctx.globalAlpha = p.kind === 'dust' ? 0.55 : 1;
    const s = p.kind === 'dust' ? 16 : 32;
    ctx.drawImage(img, f * 32, 0, 32, 32, p.x * TILE + TILE / 2 - s / 2, p.y * TILE + TILE - s + 2, s, s);
    ctx.globalAlpha = 1;
  }

}

/** Speech bubble drawn in screen pixels (so text stays small and crisp). `s` = pixel scale. */
export function drawBubble(ctx: CanvasRenderingContext2D, font: Img, text: string, cx: number, bottom: number, s: number, time: number) {
  const lines = wrap(text, 18);
  const w = (Math.max(...lines.map(textWidth)) + 8) * s, h = (lines.length * LINE_HEIGHT + 5) * s;
  const pop = Math.round(Math.sin(time * 3)) * s;
  cx = Math.round(cx);
  const x = Math.round(cx - w / 2), y = Math.round(bottom - h - 4 * s + pop);
  ctx.fillStyle = '#2b1a12';
  ctx.fillRect(x - s, y, w + 2 * s, h);
  ctx.fillRect(x, y - s, w, h + 2 * s);
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(x, y, w, h);
  // tail
  ctx.fillStyle = '#2b1a12';
  ctx.fillRect(cx - 2 * s, y + h, 5 * s, s); ctx.fillRect(cx - s, y + h + s, 3 * s, s); ctx.fillRect(cx, y + h + 2 * s, s, s);
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(cx - s, y + h - s, 3 * s, s); ctx.fillRect(cx, y + h, s, s);
  lines.forEach((ln, i) => drawText(ctx, font, ln, x + 4 * s + (w - 8 * s - ln.length * GLYPH_ADVANCE * s) / 2, y + 3 * s + i * LINE_HEIGHT * s, '#2b1a12', s));
}

/** A chunky 5-point star (the red star from the paper map). */
function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, spin: number) {
  const pts: [number, number][] = [];
  const squash = Math.abs(Math.cos(spin)) * 0.6 + 0.4; // fake 3D spin
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    pts.push([cx + Math.cos(a) * rr * squash, cy + Math.sin(a) * rr]);
  }
  const path = () => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  ctx.fillStyle = '#2b1a12'; path(); ctx.lineWidth = 2; ctx.strokeStyle = '#2b1a12'; ctx.stroke();
  ctx.fillStyle = '#ff4a2e'; path(); ctx.fill();
  ctx.fillStyle = '#ffd24a';
  ctx.beginPath(); ctx.arc(cx - r * 0.15 * squash, cy - r * 0.2, r * 0.22, 0, Math.PI * 2); ctx.fill();
}
