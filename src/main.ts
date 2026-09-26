import { loadAssets, type Assets } from './assets';
import { Fog } from './fog';
import { isWall, PREVIEW_LEVEL, type Level } from './level';
import { drawMapView } from './mapview';
import type { Dir } from './meerkat';
import { drawText } from './pixelfont';
import { drawBubble, LIFT, TILE, WorldRenderer, type Actor, type Particle } from './renderer';

// Visual preview: walk around a small maze. No game rules yet (nothing can be picked up).

const STEP_TIME = 0.16; // seconds per tile
const SENTRY_AFTER = 3; // seconds standing still before the meerkat stands up on lookout
const VIEW_TILES = 11; // about how many tiles fit in the short side of the screen
const params = new URLSearchParams(location.search);
const NO_FOG = params.get('fog') === '0'; // debug: ?fog=0 lights up the whole maze

const canvas = document.getElementById('game') as HTMLCanvasElement;
const screen = canvas.getContext('2d')!;
const buffer = document.createElement('canvas');
const world = buffer.getContext('2d')!;

const DIRS: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};

class Preview {
  level: Level = PREVIEW_LEVEL;
  renderer: WorldRenderer;
  fog: Fog;
  player: Actor;
  npcs: Actor[];
  particles: Particle[] = [];
  held: Dir[] = [];
  touchDir: Dir | null = null;
  showMap = false;
  from = { x: 0, y: 0 };
  to = { x: 0, y: 0 };
  stepT = 1;
  still = 0;
  steps = 0;
  time = 0;
  zoom = 3;
  mapButton = { x: 0, y: 0, w: 0, h: 0 };

  constructor(private a: Assets) {
    this.renderer = new WorldRenderer(a, this.level);
    this.fog = new Fog(this.level, 5);
    const s = this.level.start;
    this.player = { x: s.x, y: s.y, sheet: a.meerkats[0], anim: 'idle', dir: 'down', t: 0 };
    this.from = { ...s }; this.to = { ...s };
    this.npcs = this.level.npcs.map(n => ({
      x: n.x, y: n.y, sheet: a.meerkats[n.skin], anim: 'sentry' as const, dir: 'down' as Dir, t: n.x * 0.7, npc: n,
    }));
    this.fog.update(s.x, s.y, NO_FOG);
    this.bindInput();
  }

  blocked(x: number, y: number): boolean {
    if (isWall(this.level, x, y)) return true;
    if (this.level.things.some(t => t.x === x && t.y === y && (t.kind === 'gate' || t.kind === 'crate' || t.kind === 'bars'))) return true;
    return this.level.npcs.some(n => n.x === x && n.y === y);
  }

  bindInput() {
    addEventListener('keydown', e => {
      if (e.code === 'KeyM' || e.code === 'Tab') { this.showMap = !this.showMap; e.preventDefault(); return; }
      const d = KEYS[e.code];
      if (d) { e.preventDefault(); if (!this.held.includes(d)) this.held.push(d); }
    });
    addEventListener('keyup', e => { const d = KEYS[e.code]; if (d) this.held = this.held.filter(h => h !== d); });
    addEventListener('blur', () => { this.held = []; });

    // touch / mouse: hold on the screen in the direction you want to walk; tap the MAP button
    const dirFrom = (e: PointerEvent): Dir => {
      const dx = e.clientX - innerWidth / 2, dy = e.clientY - innerHeight / 2;
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    };
    canvas.addEventListener('pointerdown', e => {
      const b = this.mapButton, dpr = devicePixelRatio;
      const px = e.clientX * dpr, py = e.clientY * dpr;
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) { this.showMap = !this.showMap; return; }
      if (this.showMap) return;
      canvas.setPointerCapture(e.pointerId);
      this.touchDir = dirFrom(e);
    });
    canvas.addEventListener('pointermove', e => { if (this.touchDir) this.touchDir = dirFrom(e); });
    const end = () => { this.touchDir = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  update(dt: number) {
    this.time += dt;
    const p = this.player;
    p.t += dt;

    if (this.stepT < 1) {
      this.stepT = Math.min(1, this.stepT + dt / STEP_TIME);
      p.x = this.from.x + (this.to.x - this.from.x) * this.stepT;
      p.y = this.from.y + (this.to.y - this.from.y) * this.stepT;
    }
    if (this.stepT >= 1) {
      const want = this.showMap ? null : (this.held[this.held.length - 1] ?? this.touchDir);
      if (want) {
        if (p.dir !== want) p.dir = want;
        const [dx, dy] = DIRS[want];
        const nx = this.to.x + dx, ny = this.to.y + dy;
        if (!this.blocked(nx, ny)) {
          this.from = { ...this.to };
          this.to = { x: nx, y: ny };
          this.stepT = 0;
          if (p.anim !== 'walk') { p.anim = 'walk'; p.t = 0; }
          if (this.steps++ % 3 === 0) this.particles.push({ kind: 'dust', x: this.from.x, y: this.from.y, t: 0 });
        } else if (p.anim === 'walk') { p.anim = 'idle'; p.t = 0; }
        this.still = 0;
      } else {
        this.still += dt;
        if (p.anim === 'walk') { p.anim = 'idle'; p.t = 0; }
        if (p.anim === 'idle' && this.still > SENTRY_AFTER) { p.anim = 'sentry'; p.dir = 'down'; p.t = 0; }
      }
    }

    // NPCs look at you when you come close, otherwise keep lookout
    for (const n of this.npcs) {
      n.t += dt;
      const dx = p.x - n.x, dy = p.y - n.y;
      if (Math.hypot(dx, dy) < 2.6) {
        n.anim = 'idle';
        n.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      } else if (n.anim !== 'sentry') { n.anim = 'sentry'; n.dir = 'down'; }
    }

    // gems twinkle every now and then
    if (Math.random() < dt * 0.8) {
      const gems = this.level.things.filter(t => t.kind === 'gem');
      const g = gems[Math.floor(Math.random() * gems.length)];
      if (g) this.particles.push({ kind: 'twinkle', x: g.x, y: g.y - 0.3, t: 0 });
    }
    for (const pt of this.particles) pt.t += dt;
    this.particles = this.particles.filter(pt => pt.t < 1);

    this.fog.update(p.x, p.y, NO_FOG);
  }

  resize() {
    const dpr = devicePixelRatio || 1;
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    this.zoom = Math.max(2, Math.round(Math.min(w, h) / (VIEW_TILES * TILE)));
    const bw = Math.ceil(w / this.zoom), bh = Math.ceil(h / this.zoom);
    if (buffer.width !== bw || buffer.height !== bh) { buffer.width = bw; buffer.height = bh; }
  }

  render() {
    this.resize();
    const { level, player: p } = this;
    const bw = buffer.width, bh = buffer.height;
    const mapW = level.width * TILE, mapH = level.height * TILE;

    // camera follows the meerkat; if the maze is smaller than the screen, centre it
    const cam = (focus: number, view: number, size: number) =>
      size + 2 * TILE <= view ? (size - view) / 2 : Math.max(-TILE, Math.min(size - view + TILE, focus - view / 2));
    const camX = Math.round(cam(p.x * TILE + TILE / 2, bw, mapW));
    const camY = Math.round(cam(p.y * TILE, bh, mapH));

    world.imageSmoothingEnabled = false;
    world.fillStyle = '#100a18';
    world.fillRect(0, 0, bw, bh);
    world.save();
    world.translate(-camX, -camY);
    const bubbles = this.renderer.draw(world, this.time, [p, ...this.npcs], this.particles, p);
    this.fog.draw(world, TILE, LIFT / 2);
    world.restore();

    screen.imageSmoothingEnabled = false;
    screen.drawImage(buffer, 0, 0, bw * this.zoom, bh * this.zoom);
    const bs = Math.max(1, Math.round(this.zoom / 2));
    for (const b of bubbles) drawBubble(screen, this.a.font, b.text, (b.x - camX) * this.zoom, (b.y - camY) * this.zoom, bs, this.time);

    if (this.showMap) drawMapView(screen, level, this.fog, { x: p.x, y: p.y }, canvas.width, canvas.height, this.time);
    this.hud();
  }

  hud() {
    const s = Math.max(2, Math.round(this.zoom * 0.75));
    const W = canvas.width, H = canvas.height;
    // coin counter (static for the preview)
    screen.fillStyle = 'rgba(20,12,28,0.6)';
    screen.fillRect(8 * s / 2, 8 * s / 2, 44 * s, 14 * s);
    screen.drawImage(this.a.coin, 0, 0, 10, 10, 7 * s, 6 * s, 10 * s, 10 * s);
    drawText(screen, this.a.font, 'X 0', 20 * s, 7 * s, '#fff4d6', s);
    // map button
    const label = this.showMap ? 'BACK' : 'MAP';
    const bw = (label.length * 7 + 10) * s, bh = 14 * s;
    this.mapButton = { x: W - bw - 4 * s, y: 4 * s, w: bw, h: bh };
    screen.fillStyle = '#6a3fb5';
    screen.fillRect(this.mapButton.x, this.mapButton.y, bw, bh);
    screen.fillStyle = '#4a2a85';
    screen.fillRect(this.mapButton.x, this.mapButton.y + bh - 2 * s, bw, 2 * s);
    drawText(screen, this.a.font, label, this.mapButton.x + 5 * s, this.mapButton.y + 3 * s, '#fff4d6', s);
    // hint
    const hint = 'ARROWS/WASD: WALK    M: MAP';
    const hs = Math.max(1, Math.round(s * 0.6));
    drawText(screen, this.a.font, hint, (W - hint.length * 7 * hs) / 2, H - 12 * hs, 'rgba(255,244,214,0.75)', hs);
  }
}

async function boot() {
  const assets = await loadAssets();
  const game = new Preview(assets);
  (window as unknown as { game: Preview }).game = game; // handy for testing in the console
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.update(dt);
    game.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch(err => {
  document.body.innerHTML = `<pre style="color:#fff;padding:1em">Could not start: ${String(err)}</pre>`;
});
