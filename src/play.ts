import { KEY_HUES, type Assets, type KeyColor } from './assets';
import { Fog } from './fog';
import { createGame, playerPos, RULES, step, type Dir, type Game, type GameEvent, type LiveThing } from './game/state';
import type { Level } from './level';
import { drawMapView } from './mapview';
import type { Anim } from './meerkat';
import { drawText, GLYPH_ADVANCE } from './pixelfont';
import { drawBubble, LIFT, TILE, WorldRenderer, type Actor, type Particle } from './renderer';

const SENTRY_AFTER = 3; // seconds standing still before the meerkat stands up on lookout
const VIEW_TILES = 11; // about how many tiles fit in the short side of the screen
const params = new URLSearchParams(location.search);
const NO_FOG = params.get('fog') === '0'; // debug: ?fog=0 lights up the whole maze

const canvas = document.getElementById('game') as HTMLCanvasElement;
const screen = canvas.getContext('2d')!;
const buffer = document.createElement('canvas');
const world = buffer.getContext('2d')!;

export interface PlayOptions {
  /** label for the button that leaves the game, e.g. 'MENU' or 'EDIT' */
  backLabel: string;
  onBack: () => void;
}

const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};

/** Floating text like "+1" (world tile coords, drawn in screen space). */
interface Popup { text: string; color: string; x: number; y: number; t: number }
interface Confetti { x: number; y: number; vx: number; vy: number; color: string; t: number }

const keyColor = (c: KeyColor) => `hsl(${KEY_HUES[c]}, 85%, 60%)`;

export class Play {
  game!: Game;
  renderer: WorldRenderer;
  fog!: Fog;
  player!: Actor;
  npcs!: Actor[];
  particles: Particle[] = [];
  popups: Popup[] = [];
  confetti: Confetti[] = [];
  held: Dir[] = [];
  touchDir: Dir | null = null;
  showMap = false;
  still = 0;
  steps = 0;
  shake = 0;
  zoom = 3;
  mapButton = { x: 0, y: 0, w: 0, h: 0 };
  backButton = { x: 0, y: 0, w: 0, h: 0 };
  private listeners = new AbortController();

  constructor(private a: Assets, private level: Level, private opts: PlayOptions) {
    this.renderer = new WorldRenderer(a, level);
    this.restart();
    this.bindInput();
  }

  dispose() {
    this.listeners.abort();
  }

  restart() {
    this.game = createGame(this.level);
    this.fog = new Fog(this.level, 5);
    const s = this.level.start;
    this.player = { x: s.x, y: s.y, sheet: this.a.meerkats[0], anim: 'idle', dir: 'down', t: 0 };
    this.npcs = this.level.npcs.map(n => ({
      x: n.x, y: n.y, sheet: this.a.meerkats[n.skin], anim: 'sentry' as Anim, dir: 'down' as Dir, t: n.x * 0.7, npc: n,
    }));
    this.particles = []; this.popups = []; this.confetti = [];
    this.still = 0; this.showMap = false;
    this.fog.update(s.x, s.y, NO_FOG);
  }

  bindInput() {
    const signal = this.listeners.signal;
    addEventListener('keydown', e => {
      if (e.code === 'Escape') { e.preventDefault(); this.opts.onBack(); return; }
      if (e.code === 'KeyM' || e.code === 'Tab') { this.showMap = !this.showMap; e.preventDefault(); return; }
      if (e.code === 'KeyR' || (this.game.won && (e.code === 'Enter' || e.code === 'Space'))) { this.restart(); e.preventDefault(); return; }
      const d = KEYS[e.code];
      if (d) { e.preventDefault(); if (!this.held.includes(d)) this.held.push(d); }
    }, { signal });
    addEventListener('keyup', e => { const d = KEYS[e.code]; if (d) this.held = this.held.filter(h => h !== d); }, { signal });
    addEventListener('blur', () => { this.held = []; }, { signal });

    // touch / mouse: hold on the screen in the direction you want to walk; tap the MAP button
    const dirFrom = (e: PointerEvent): Dir => {
      const r = canvas.getBoundingClientRect();
      const dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    };
    canvas.addEventListener('pointerdown', e => {
      canvas.focus();
      const b = this.mapButton, dpr = devicePixelRatio, r = canvas.getBoundingClientRect();
      const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
      const hit = (r: { x: number; y: number; w: number; h: number }) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
      if (hit(b)) { this.showMap = !this.showMap; return; }
      if (hit(this.backButton)) { this.opts.onBack(); return; }
      if (this.game.won) { if (this.game.time - this.game.wonAt > 1.5) this.restart(); return; }
      if (this.showMap) return;
      canvas.setPointerCapture(e.pointerId);
      this.touchDir = dirFrom(e);
    }, { signal });
    canvas.addEventListener('pointermove', e => { if (this.touchDir) this.touchDir = dirFrom(e); }, { signal });
    const end = () => { this.touchDir = null; };
    canvas.addEventListener('pointerup', end, { signal });
    canvas.addEventListener('pointercancel', end, { signal });
  }

  update(dt: number) {
    const g = this.game;
    const want = this.showMap ? null : (this.held[this.held.length - 1] ?? this.touchDir);
    const events = step(g, [want], dt);
    for (const ev of events) this.onEvent(ev);

    const p = g.players[0];
    const pos = playerPos(p);
    const moving = p.stepT < 1;
    this.still = moving || want ? 0 : this.still + dt;

    // pick the meerkat's animation from what it is doing
    let anim: Anim;
    if (p.mood === 'sad') anim = 'sad';
    else if (p.mood === 'celebrate') anim = 'celebrate';
    else if (p.mood === 'pickup') anim = 'cheer';
    else if (moving) anim = p.pushing ? 'push' : p.zoneTime !== null ? 'panic' : 'walk';
    else if (this.still > SENTRY_AFTER) anim = 'sentry';
    else anim = 'idle';
    const a = this.player;
    if (a.anim !== anim) { a.anim = anim; a.t = 0; }
    a.t += dt;
    a.x = pos.x; a.y = pos.y;
    a.dir = anim === 'sentry' || anim === 'sad' || anim === 'celebrate' || anim === 'cheer' ? 'down' : p.dir;

    // star power leaves a trail of sparks; walking kicks up a little dust now and then
    if (moving && p.starLeft > 0 && Math.random() < 0.6) {
      this.particles.push({ kind: 'spark', x: pos.x + (Math.random() - 0.5) * 0.6, y: pos.y, t: 0, color: Math.random() < 0.5 ? '#ffd24a' : '#ff6a3a' });
    }
    if (moving && p.stepT === 0) { this.steps++; if (this.steps % 3 === 0) this.particles.push({ kind: 'dust', x: p.fromX, y: p.fromY, t: 0 }); }

    // NPCs look at you when you come close, otherwise keep lookout; everybody cheers at the end
    for (const n of this.npcs) {
      n.t += dt;
      const dx = pos.x - n.x, dy = pos.y - n.y;
      if (g.won) { if (n.anim !== 'celebrate') { n.anim = 'celebrate'; n.dir = 'down'; n.t = Math.random(); } }
      else if (Math.hypot(dx, dy) < 2.6) {
        n.anim = 'idle';
        n.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      } else if (n.anim !== 'sentry') { n.anim = 'sentry'; n.dir = 'down'; }
    }

    // gems twinkle every now and then
    if (Math.random() < dt * 0.8) {
      const gems = g.things.filter(t => t.kind === 'gem' && !t.gone);
      const gem = gems[Math.floor(Math.random() * gems.length)];
      if (gem) this.particles.push({ kind: 'twinkle', x: gem.x, y: gem.y - 0.3, t: 0 });
    }
    for (const pt of this.particles) pt.t += dt;
    this.particles = this.particles.filter(pt => pt.t < 1);
    for (const pp of this.popups) pp.t += dt;
    this.popups = this.popups.filter(pp => pp.t < 1.2);
    for (const c of this.confetti) { c.t += dt; c.vy += 9 * dt; c.x += c.vx * dt; c.y += c.vy * dt; }
    this.confetti = this.confetti.filter(c => c.t < 3);
    this.shake = Math.max(0, this.shake - dt);

    this.fog.update(pos.x, pos.y, NO_FOG || p.starLeft > 0);
  }

  onEvent(ev: GameEvent) {
    const pop = (text: string, color: string) => this.popups.push({ text, color, x: ev.x, y: ev.y, t: 0 });
    const twinkle = (lift = 0.3) => this.particles.push({ kind: 'twinkle', x: ev.x, y: ev.y - lift, t: 0 });
    switch (ev.type) {
      case 'coin': pop('+1', '#ffd24a'); break;
      case 'gem': pop('+5', '#7cc6ff'); twinkle(); break;
      case 'key': pop(`${ev.color!.toUpperCase()} KEY!`, keyColor(ev.color!)); twinkle(); break;
      case 'star': pop('STAR POWER!', '#ff6a3a'); twinkle(0.5); break;
      case 'push': this.particles.push({ kind: 'dust', x: ev.x, y: ev.y, t: 0 }); break;
      case 'gate': twinkle(0.4); break;
      case 'jailed': pop('JAIL!', '#ff5a4a'); this.shake = 0.4; break;
      case 'released': pop('FREE!', '#8cf07a'); break;
      case 'win':
        pop('EXIT!', '#ffd24a');
        for (let i = 0; i < 80; i++) {
          const ang = Math.random() * Math.PI * 2, v = 2 + Math.random() * 5;
          this.confetti.push({
            x: ev.x + 0.5, y: ev.y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - 4, t: Math.random() * 0.5,
            color: ['#ff4a2e', '#ffd24a', '#7cc6ff', '#8cf07a', '#b58be0', '#ff8ad8'][i % 6],
          });
        }
        break;
    }
  }

  resize() {
    const dpr = devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    this.zoom = Math.max(2, Math.round(Math.min(w, h) / (VIEW_TILES * TILE)));
    const bw = Math.ceil(w / this.zoom), bh = Math.ceil(h / this.zoom);
    if (buffer.width !== bw || buffer.height !== bh) { buffer.width = bw; buffer.height = bh; }
  }

  /** Gates next to (or under) a meerkat holding their key sink into the sand. */
  openGates(): Set<LiveThing> {
    const p = this.game.players[0];
    const open = new Set<LiveThing>();
    for (const t of this.game.things) {
      if (t.kind !== 'gate' || !p.keys.has(t.color)) continue;
      const near = Math.abs(t.x - p.cx) + Math.abs(t.y - p.cy) <= 1 || Math.abs(t.x - p.fromX) + Math.abs(t.y - p.fromY) <= 1;
      if (near) open.add(t);
    }
    return open;
  }

  render() {
    this.resize();
    const { level, game: g, player: p } = this;
    const bw = buffer.width, bh = buffer.height;
    const mapW = level.width * TILE, mapH = level.height * TILE;
    const Z = this.zoom;

    // camera follows the meerkat; if the maze is smaller than the screen, centre it
    const cam = (focus: number, view: number, size: number) =>
      size + 2 * TILE <= view ? (size - view) / 2 : Math.max(-TILE, Math.min(size - view + TILE, focus - view / 2));
    const shakeX = this.shake > 0 ? Math.round((Math.random() - 0.5) * 6 * this.shake) : 0;
    const camX = Math.round(cam(p.x * TILE + TILE / 2, bw, mapW)) + shakeX;
    const camY = Math.round(cam(p.y * TILE, bh, mapH));

    world.imageSmoothingEnabled = false;
    world.fillStyle = '#100a18';
    world.fillRect(0, 0, bw, bh);
    world.save();
    world.translate(-camX, -camY);
    const scene = { things: g.things, barsOpen: g.barsOpen, openGates: this.openGates() };
    const bubbles = this.renderer.draw(world, g.time, scene, [p, ...this.npcs], this.particles, p);
    this.fog.draw(world, TILE, LIFT / 2);
    for (const c of this.confetti) {
      world.fillStyle = c.color;
      world.fillRect(Math.round(c.x * TILE), Math.round(c.y * TILE), 2, c.t % 0.3 < 0.15 ? 2 : 1);
    }
    world.restore();

    screen.imageSmoothingEnabled = false;
    screen.drawImage(buffer, 0, 0, bw * Z, bh * Z);

    const toScreen = (tx: number, ty: number) => [(tx * TILE + TILE / 2 - camX) * Z, (ty * TILE - camY) * Z];
    const s = Math.max(1, Math.round(Z / 2));
    if (!this.showMap) {
      if (!g.won && g.players[0].mood !== 'sad') for (const b of bubbles) drawBubble(screen, this.a.font, b.text, (b.x - camX) * Z, (b.y - camY) * Z, s, g.time);
      for (const pp of this.popups) {
        const [x, y] = toScreen(pp.x, pp.y - 0.6 - pp.t * 1.2);
        screen.globalAlpha = Math.max(0, Math.min(1, (1.2 - pp.t) * 3));
        outlinedText(screen, this.a, pp.text, x - (pp.text.length * GLYPH_ADVANCE * s) / 2, y, pp.color, s);
        screen.globalAlpha = 1;
      }

      // countdowns above the meerkat's head
      const pl = g.players[0];
      const [hx, hy] = toScreen(p.x, p.y - 1.4);
      if (pl.zoneTime !== null) {
        const left = Math.max(0, RULES.zoneSeconds - pl.zoneTime);
        countdownRing(screen, this.a, hx, hy - 6 * s, left / RULES.zoneSeconds, String(Math.ceil(left)), s * 2, g.time, left < 2);
      } else if (pl.jailLeft !== null) {
        // shown under the meerkat's feet so it doesn't cover speech bubbles
        const t = `FREE IN ${Math.ceil(pl.jailLeft)}`;
        const [, fy] = toScreen(p.x, p.y + 1);
        outlinedText(screen, this.a, t, hx - (t.length * GLYPH_ADVANCE * s) / 2, fy + 2 * s, '#fff4d6', s);
      }
    }

    if (this.showMap) drawMapView(screen, level, this.fog, { x: p.x, y: p.y }, canvas.width, canvas.height, g.time, g.things);
    this.hud();
    if (g.won) this.winScreen();
  }

  hud() {
    const g = this.game, pl = g.players[0];
    const s = Math.max(2, Math.round(this.zoom * 0.75));
    const W = canvas.width, H = canvas.height;
    // coins, gems and keys
    const keys = [...pl.keys];
    const coinText = `${g.coins}`;
    const panelW = (26 + coinText.length * 7 + (g.gems ? 22 : 0) + keys.length * 14) * s;
    screen.fillStyle = 'rgba(20,12,28,0.6)';
    screen.fillRect(4 * s, 4 * s, panelW, 16 * s);
    screen.drawImage(this.a.coin, 0, 0, 10, 10, 7 * s, 7 * s, 10 * s, 10 * s);
    let x = 20 * s;
    outlinedText(screen, this.a, coinText, x, 8 * s, '#fff4d6', s);
    x += (coinText.length * 7 + 6) * s;
    if (g.gems) {
      screen.drawImage(this.a.tileset, 128, 192, 16, 16, x - 2 * s, 4 * s, 14 * s, 14 * s);
      outlinedText(screen, this.a, `${g.gems}`, x + 11 * s, 8 * s, '#7cc6ff', s);
      x += 22 * s;
    }
    for (const k of keys) { screen.drawImage(this.a.keys[k], x, 8 * s, 12 * s, 8 * s); x += 14 * s; }

    // star power bar
    if (pl.starLeft > 0) {
      const frac = pl.starLeft / RULES.starSeconds;
      const bx = 4 * s, by = 22 * s, barW = 70 * s;
      screen.fillStyle = 'rgba(20,12,28,0.6)';
      screen.fillRect(bx, by, barW, 10 * s);
      screen.fillStyle = pl.starLeft < 4 && Math.floor(g.time * 6) % 2 ? '#ff6a3a' : '#ffd24a';
      screen.fillRect(bx + 2 * s, by + 2 * s, (barW - 4 * s) * frac, 6 * s);
      drawText(screen, this.a.font, 'STAR', bx + 3 * s, by + s, '#2b1a12', s);
    }

    // map button
    const label = this.showMap ? 'BACK' : 'MAP';
    const mbw = (label.length * 7 + 10) * s, mbh = 14 * s;
    this.mapButton = { x: W - mbw - 4 * s, y: 4 * s, w: mbw, h: mbh };
    screen.fillStyle = '#6a3fb5';
    screen.fillRect(this.mapButton.x, this.mapButton.y, mbw, mbh);
    screen.fillStyle = '#4a2a85';
    screen.fillRect(this.mapButton.x, this.mapButton.y + mbh - 2 * s, mbw, 2 * s);
    drawText(screen, this.a.font, label, this.mapButton.x + 5 * s, this.mapButton.y + 3 * s, '#fff4d6', s);
    const back = this.opts.backLabel;
    const bbw = (back.length * 7 + 10) * s;
    this.backButton = { x: this.mapButton.x - bbw - 4 * s, y: 4 * s, w: bbw, h: mbh };
    screen.fillStyle = '#3a2a55';
    screen.fillRect(this.backButton.x, this.backButton.y, bbw, mbh);
    screen.fillStyle = '#261a3a';
    screen.fillRect(this.backButton.x, this.backButton.y + mbh - 2 * s, bbw, 2 * s);
    drawText(screen, this.a.font, back, this.backButton.x + 5 * s, this.backButton.y + 3 * s, '#fff4d6', s);

    if (!g.won) {
      const hint = 'ARROWS/WASD: WALK    M: MAP    R: RESTART    ESC: BACK';
      const hs = Math.max(1, Math.round(s * 0.6));
      drawText(screen, this.a.font, hint, (W - hint.length * 7 * hs) / 2, H - 12 * hs, 'rgba(255,244,214,0.75)', hs);
    }
  }

  winScreen() {
    const g = this.game;
    const W = canvas.width, H = canvas.height;
    const fade = Math.min(1, (g.time - g.wonAt) / 1.2);
    if (fade <= 0.3) return;
    const s = Math.max(2, Math.round(this.zoom * 0.7));
    const lines: [string, string, number][] = [
      ['YOU FOUND THE EXIT!', '#ffd24a', 1.5],
      [`COINS  ${g.coins}`, '#fff4d6', 1],
      [`GEMS   ${g.gems}`, '#7cc6ff', 1],
      [`TIME   ${formatTime(g.wonAt)}`, '#fff4d6', 1],
      ['PRESS ENTER OR TAP TO PLAY AGAIN', '#b58be0', 0.75],
    ];
    const widest = Math.max(...lines.map(([t, , k]) => t.length * GLYPH_ADVANCE * k)) + 24;
    const k = Math.min(s, Math.floor((W - 16) / widest)) || 1;
    const bw = widest * k, bh = 86 * k;
    const bx = (W - bw) / 2, by = (H - bh) / 2;
    screen.globalAlpha = (fade - 0.3) / 0.7;
    screen.fillStyle = 'rgba(20,12,28,0.9)';
    screen.fillRect(bx, by, bw, bh);
    screen.strokeStyle = '#6a3fb5'; screen.lineWidth = 2 * k;
    screen.strokeRect(bx, by, bw, bh);
    const ys = [10, 30, 42, 54, 72];
    lines.forEach(([t, c, sc], i) => {
      const ts = Math.max(1, Math.round(k * sc));
      outlinedText(screen, this.a, t, W / 2 - (t.length * GLYPH_ADVANCE * ts) / 2, by + ys[i] * k, c, ts);
    });
    screen.globalAlpha = 1;
  }
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Pixel text with a dark outline so it reads on any background. */
function outlinedText(ctx: CanvasRenderingContext2D, a: Assets, text: string, x: number, y: number, color: string, s: number) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawText(ctx, a.font, text, x + dx * s, y + dy * s, '#1a0f14', s);
  drawText(ctx, a.font, text, x, y, color, s);
}

/** The red-zone countdown: a shrinking ring with the seconds left. */
function countdownRing(ctx: CanvasRenderingContext2D, a: Assets, cx: number, cy: number, frac: number, label: string, s: number, time: number, urgent: boolean) {
  const r = 7 * s;
  if (urgent) cx += Math.round(Math.sin(time * 60) * s * 0.5);
  ctx.fillStyle = 'rgba(20,12,28,0.75)';
  ctx.beginPath(); ctx.arc(cx, cy, r + s, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = urgent ? '#ff3a2a' : '#ff8a4a';
  ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.arc(cx, cy, r - s / 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
  outlinedText(ctx, a, label, cx - (GLYPH_ADVANCE * s) / 2 + s / 2, cy - 4 * s, '#fff4d6', s);
}
