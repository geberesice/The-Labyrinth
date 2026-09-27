import { KEY_HUES, type Assets, type KeyColor } from './assets';
import { audio } from './audio';
import { Fog } from './fog';
import {
  addPlayer, createGame, nearBars, playerPos, removePlayer, RULES, step,
  type Dir, type Game, type GameEvent, type LiveThing, type Player,
} from './game/state';
import type { Level } from './level';
import { toLevel, type LevelData } from './level-format';
import { drawMapView } from './mapview';
import type { Anim } from './meerkat';
import { applySnapshot, snapshot, type HostMsg } from './net/protocol';
import type { GuestSession, HostSession } from './net/session';
import { drawText, GLYPH_ADVANCE } from './pixelfont';
import { drawBubble, LIFT, TILE, WorldRenderer, type Actor, type Particle } from './renderer';

const SENTRY_AFTER = 3; // seconds standing still before the meerkat stands up on lookout
const VIEW_TILES = 11; // about how many tiles fit in the short side of the screen
const SNAP_EVERY = 0.05; // host sends the game state 20 times a second
const params = new URLSearchParams(location.search);
const NO_FOG = params.get('fog') === '0'; // debug: ?fog=0 lights up the whole maze

/** Scarf colours of the meerkat sprites (tools/make-meerkat.mjs), for the map and name tags. */
export const SKIN_COLORS = ['#e8433a', '#3a8fe8', '#57b847', '#b457e8', '#f0b429'];

const canvas = document.getElementById('game') as HTMLCanvasElement;
const screen = canvas.getContext('2d')!;
const buffer = document.createElement('canvas');
const world = buffer.getContext('2d')!;

export type NetMode =
  | { role: 'solo' }
  | { role: 'host'; session: HostSession; name: string }
  | { role: 'guest'; session: GuestSession; me: number };

export interface PlayOptions {
  /** label for the button that leaves the game, e.g. 'MENU' or 'EDIT' */
  backLabel: string;
  onBack: () => void;
  net?: NetMode;
  /** a friend's game ended (host left, connection lost) */
  onDisconnect?: (reason: string) => void;
}

const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};

/** Floating text like "+1" (world tile coords, drawn in screen space). */
interface Popup { text: string; color: string; x: number; y: number; t: number }
interface Confetti { x: number; y: number; vx: number; vy: number; color: string; t: number }
interface Rect { x: number; y: number; w: number; h: number }

const keyColor = (c: KeyColor) => `hsl(${KEY_HUES[c]}, 85%, 60%)`;
const NO_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

export class Play {
  game!: Game;
  level: Level;
  renderer: WorldRenderer;
  fog!: Fog;
  /** our own player id */
  me = 0;
  /** one animated sprite per player */
  meerkats = new Map<number, { actor: Actor; still: number }>();
  npcs!: Actor[];
  particles: Particle[] = [];
  popups: Popup[] = [];
  confetti: Confetti[] = [];
  held: Dir[] = [];
  touchDir: Dir | null = null;
  showMap = false;
  steps = 0;
  shake = 0;
  zoom = 3;
  buttons = { map: NO_RECT, back: NO_RECT, sound: NO_RECT, bail: NO_RECT };
  private chatting = new Set<Actor>();
  private lastZoneSecond = -1;
  private listeners = new AbortController();
  private net: NetMode;
  // host
  private guestInputs = new Map<number, Dir | null>();
  private actions = new Set<number>();
  private pendingEvents: GameEvent[] = [];
  private snapTimer = 0;
  // guest
  private sentDir: Dir | null = null;
  private sendTimer = 0;
  private lastSnapTime = 0;

  constructor(private a: Assets, private data: LevelData, private opts: PlayOptions) {
    this.level = toLevel(data);
    this.renderer = new WorldRenderer(a, this.level);
    this.net = opts.net ?? { role: 'solo' };
    if (this.net.role === 'guest') this.me = this.net.me;
    this.restart();
    this.bindInput();
    this.bindNet();
  }

  get multiplayer() { return this.net.role !== 'solo'; }
  get meP(): Player | undefined { return this.game.players.find(p => p.id === this.me); }

  dispose() {
    this.listeners.abort();
    if (this.net.role === 'host') { this.net.session.onGuestJoin = this.net.session.onGuestLeave = this.net.session.onMessage = undefined; }
    if (this.net.role === 'guest') { this.net.session.onMessage = this.net.session.onClose = undefined; }
  }

  restart() {
    const old = this.game?.players ?? [];
    this.game = createGame(this.level, 0);
    if (this.net.role === 'solo') {
      addPlayer(this.game, 'You');
    } else if (this.net.role === 'host') {
      if (old.length) {
        // play again: same meerkats, same ids
        for (const o of old) Object.assign(addPlayer(this.game, o.name), { id: o.id, skin: o.skin });
      } else {
        addPlayer(this.game, this.net.name);
        for (const guest of this.net.session.guests.values()) this.welcome(guest.peerId);
      }
    }
    this.fog = new Fog(this.level, 5);
    this.meerkats.clear();
    this.npcs = this.level.npcs.map(n => ({
      x: n.x, y: n.y, sheet: this.a.meerkats[n.skin], anim: 'sentry' as Anim, dir: 'down' as Dir, t: n.x * 0.7, npc: n,
    }));
    this.particles = []; this.popups = []; this.confetti = [];
    this.showMap = false;
    this.fog.update(this.level.start.x, this.level.start.y, NO_FOG);
    this.chatting.clear();
    audio.music('game');
  }

  // ---------------- networking ----------------

  /** Host: give a (new) friend a meerkat and send them the level. */
  private welcome(peerId: string) {
    if (this.net.role !== 'host') return;
    const guest = this.net.session.guests.get(peerId);
    if (!guest) return;
    if (guest.playerId === null || !this.game.players.some(p => p.id === guest.playerId)) {
      guest.playerId = addPlayer(this.game, guest.name).id;
    }
    this.net.session.send(guest, { t: 'start', level: this.data, you: guest.playerId });
  }

  private bindNet() {
    const net = this.net;
    if (net.role === 'host') {
      const s = net.session;
      s.onGuestJoin = g => { this.welcome(g.peerId); this.say(`${g.name} JOINED`, '#8cf07a'); };
      s.onGuestLeave = g => {
        if (g.playerId !== null) { removePlayer(this.game, g.playerId); this.meerkats.delete(g.playerId); this.guestInputs.delete(g.playerId); }
        this.say(`${g.name} LEFT`, '#c9b8dd');
      };
      s.onMessage = (g, m) => {
        if (g.playerId === null) return;
        if (m.t === 'input') this.guestInputs.set(g.playerId, m.dir);
        else if (m.t === 'action') this.actions.add(g.playerId);
      };
    } else if (net.role === 'guest') {
      const s = net.session;
      s.onMessage = (m: HostMsg) => {
        if (m.t === 'snap') {
          if (m.s.time < this.lastSnapTime - 0.5) this.restart(); // the host started a new round
          this.lastSnapTime = m.s.time;
          applySnapshot(this.game, m.s);
          for (const ev of m.s.events) this.onEvent(ev);
        } else if (m.t === 'start') {
          // host switched level or re-sent it: start over with it
          this.data = m.level;
          this.level = toLevel(m.level);
          this.renderer = new WorldRenderer(this.a, this.level);
          this.me = m.you;
          this.lastSnapTime = 0;
          this.restart();
        } else if (m.t === 'bye') {
          this.opts.onDisconnect?.(m.reason);
        }
      };
      s.onClose = () => this.opts.onDisconnect?.('Lost the connection to the host.');
    }
  }

  // ---------------- input ----------------

  private action() {
    if (this.net.role === 'guest') this.net.session.send({ t: 'action' });
    else this.actions.add(this.me);
  }

  private canRestart() { return this.net.role !== 'guest'; }

  bindInput() {
    const signal = this.listeners.signal;
    addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.matches?.('input, textarea')) return;
      if (e.code === 'Escape') { e.preventDefault(); this.opts.onBack(); return; }
      if (e.code === 'KeyM' || e.code === 'Tab') { this.showMap = !this.showMap; e.preventDefault(); return; }
      if (e.code === 'KeyN') { audio.toggle(); return; }
      if (this.game.won) {
        if (this.canRestart() && (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyR')) { this.restart(); e.preventDefault(); }
        return;
      }
      if (e.code === 'KeyR' && this.canRestart()) { this.restart(); e.preventDefault(); return; }
      if ((e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') && !e.repeat) { this.action(); e.preventDefault(); return; }
      const d = KEYS[e.code];
      if (d) { e.preventDefault(); if (!this.held.includes(d)) this.held.push(d); }
    }, { signal });
    addEventListener('keyup', e => { const d = KEYS[e.code]; if (d) this.held = this.held.filter(h => h !== d); }, { signal });
    addEventListener('blur', () => { this.held = []; }, { signal });

    // touch / mouse: hold on the screen in the direction you want to walk; tap the buttons
    const dirFrom = (e: PointerEvent): Dir => {
      const r = canvas.getBoundingClientRect();
      const dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    };
    canvas.addEventListener('pointerdown', e => {
      canvas.focus();
      const dpr = devicePixelRatio, r = canvas.getBoundingClientRect();
      const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
      const hit = (b: Rect) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
      const b = this.buttons;
      if (hit(b.map)) { this.showMap = !this.showMap; return; }
      if (hit(b.back)) { this.opts.onBack(); return; }
      if (hit(b.sound)) { audio.toggle(); return; }
      if (hit(b.bail)) { this.action(); return; }
      if (this.game.won) { if (this.canRestart() && this.game.time - this.game.wonAt > 1.5) this.restart(); return; }
      if (this.showMap) return;
      canvas.setPointerCapture(e.pointerId);
      this.touchDir = dirFrom(e);
    }, { signal });
    canvas.addEventListener('pointermove', e => { if (this.touchDir) this.touchDir = dirFrom(e); }, { signal });
    const end = () => { this.touchDir = null; };
    canvas.addEventListener('pointerup', end, { signal });
    canvas.addEventListener('pointercancel', end, { signal });
  }

  // ---------------- update ----------------

  update(dt: number) {
    const g = this.game;
    const want = this.showMap ? null : (this.held[this.held.length - 1] ?? this.touchDir);

    if (this.net.role === 'guest') {
      // send our input when it changes (and now and then, in case a message got lost)
      this.sendTimer -= dt;
      if (want !== this.sentDir || this.sendTimer <= 0) {
        this.net.session.send({ t: 'input', dir: want });
        this.sentDir = want; this.sendTimer = 0.5;
      }
      // between snapshots, keep walking smoothly
      for (const p of g.players) if (p.stepT < 1) p.stepT = Math.min(1, p.stepT + (dt * (p.starLeft > 0 ? 2 : 1)) / RULES.stepTime);
      for (const t of g.things) if (t.slideT !== undefined && t.slideT < 1) t.slideT = Math.min(1, t.slideT + dt / RULES.stepTime);
    } else {
      const inputs: (Dir | null)[] = [];
      inputs[this.me] = want;
      for (const [id, d] of this.guestInputs) inputs[id] = d;
      const events = step(g, inputs, dt, this.actions);
      this.actions.clear();
      for (const ev of events) this.onEvent(ev);
      if (this.net.role === 'host') {
        this.pendingEvents.push(...events);
        this.snapTimer -= dt;
        if (this.snapTimer <= 0) {
          this.net.session.broadcast({ t: 'snap', s: snapshot(g, this.pendingEvents) });
          this.pendingEvents = [];
          this.snapTimer = SNAP_EVERY;
        }
      }
    }

    // animate every meerkat from what it is doing
    for (const p of g.players) {
      let m = this.meerkats.get(p.id);
      if (!m) {
        m = { actor: { x: p.cx, y: p.cy, sheet: this.a.meerkats[p.skin % this.a.meerkats.length], anim: 'idle', dir: 'down', t: 0 }, still: 0 };
        this.meerkats.set(p.id, m);
      }
      const pos = playerPos(p);
      const moving = p.stepT < 1;
      const pressing = p.id === this.me ? !!want : moving;
      m.still = moving || pressing ? 0 : m.still + dt;
      let anim: Anim;
      if (p.mood === 'sad') anim = 'sad';
      else if (p.mood === 'celebrate') anim = 'celebrate';
      else if (p.mood === 'pickup') anim = 'cheer';
      else if (moving) anim = p.pushing ? 'push' : p.zoneTime !== null ? 'panic' : 'walk';
      else if (m.still > SENTRY_AFTER) anim = 'sentry';
      else anim = 'idle';
      const a = m.actor;
      if (a.anim !== anim) { a.anim = anim; a.t = 0; }
      a.t += dt;
      a.x = pos.x; a.y = pos.y;
      a.dir = anim === 'sentry' || anim === 'sad' || anim === 'celebrate' || anim === 'cheer' ? 'down' : p.dir;

      // star power leaves a trail of sparks; walking kicks up a little dust now and then
      if (moving && p.starLeft > 0 && Math.random() < 0.6) {
        this.particles.push({ kind: 'spark', x: pos.x + (Math.random() - 0.5) * 0.6, y: pos.y, t: 0, color: Math.random() < 0.5 ? '#ffd24a' : '#ff6a3a' });
      }
      if (moving && p.stepT === 0 && p.id === this.me) { this.steps++; if (this.steps % 3 === 0) this.particles.push({ kind: 'dust', x: p.fromX, y: p.fromY, t: 0 }); }
    }

    const me = this.meP;
    const mePos = me ? playerPos(me) : this.level.start;

    // NPCs look at you when you come close, otherwise keep lookout; everybody cheers at the end
    for (const n of this.npcs) {
      n.t += dt;
      const dx = mePos.x - n.x, dy = mePos.y - n.y;
      if (g.won) { if (n.anim !== 'celebrate') { n.anim = 'celebrate'; n.dir = 'down'; n.t = Math.random(); } }
      else if (Math.hypot(dx, dy) < 2.6) {
        n.anim = 'idle';
        n.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        if (!this.chatting.has(n)) { this.chatting.add(n); audio.chatter(); }
      } else {
        this.chatting.delete(n);
        if (n.anim !== 'sentry') { n.anim = 'sentry'; n.dir = 'down'; }
      }
    }

    // red zone countdown beeps once a second, higher as time runs out
    if (me?.zoneTime != null) {
      const sec = Math.floor(me.zoneTime);
      if (sec !== this.lastZoneSecond) { this.lastZoneSecond = sec; if (sec > 0) audio.beep(1 + sec * 0.15); }
    } else this.lastZoneSecond = -1;

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

    // fog: what we see, plus what friends have explored
    this.fog.update(mePos.x, mePos.y, NO_FOG || (me?.starLeft ?? 0) > 0);
    for (const p of g.players) if (p.id !== this.me) { const q = playerPos(p); this.fog.reveal(q.x, q.y); }
  }

  /** A message in the middle of the screen area near our meerkat (joins, leaves). */
  private say(text: string, color: string) {
    const p = this.meP;
    this.popups.push({ text, color, x: p?.cx ?? this.level.start.x, y: (p?.cy ?? this.level.start.y) - 1, t: -0.8 });
  }

  onEvent(ev: GameEvent) {
    const mine = ev.player === this.me;
    const me = this.meP;
    const near = mine || (me && Math.hypot(ev.x - me.cx, ev.y - me.cy) < 6);
    const sfx = (fn: () => void) => { if (near) fn(); };
    const pop = (text: string, color: string, x = ev.x, y = ev.y) => this.popups.push({ text, color, x, y, t: 0 });
    const twinkle = (lift = 0.3) => this.particles.push({ kind: 'twinkle', x: ev.x, y: ev.y - lift, t: 0 });
    const who = this.game.players.find(p => p.id === ev.player)?.name ?? 'Someone';
    switch (ev.type) {
      case 'coin': pop('+1', '#ffd24a'); sfx(() => audio.play('coin', 0.5, 0.95 + Math.random() * 0.1)); break;
      case 'gem': pop('+5', '#7cc6ff'); twinkle(); sfx(() => audio.play('gem', 0.6)); break;
      case 'key': pop(`${ev.color!.toUpperCase()} KEY!`, keyColor(ev.color!)); twinkle(); sfx(() => audio.play('key', 0.6)); break;
      case 'star': pop('STAR POWER!', '#ff6a3a'); twinkle(0.5); sfx(() => audio.play('star', 0.6)); break;
      case 'push': this.particles.push({ kind: 'dust', x: ev.x, y: ev.y, t: 0 }); sfx(() => audio.play('push', 0.5, 0.9 + Math.random() * 0.2)); break;
      case 'gate': twinkle(0.4); sfx(() => audio.play('gate', 0.45)); break;
      case 'zone-enter': if (mine) audio.play('alert', 0.35); break;
      case 'jailed':
        pop(mine || !this.multiplayer ? 'JAIL!' : `${who} IN JAIL!`, '#ff5a4a');
        if (mine) { this.shake = 0.4; audio.play('jail', 0.6); } else audio.play('alert', 0.4);
        break;
      case 'released': pop('FREE!', '#8cf07a'); sfx(() => audio.play('free', 0.55)); break;
      case 'bailed': {
        pop(mine ? 'HERO!' : `${who} TO THE RESCUE!`, '#8cf07a');
        for (const id of ev.freed) {
          const q = this.game.players.find(p => p.id === id);
          if (q) pop('FREE!', '#8cf07a', q.cx, q.cy);
        }
        audio.play('free', 0.55);
        break;
      }
      case 'win':
        audio.music(null);
        audio.play('win', 0.7);
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

  // ---------------- drawing ----------------

  resize() {
    const dpr = devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    this.zoom = Math.max(2, Math.round(Math.min(w, h) / (VIEW_TILES * TILE)));
    const bw = Math.ceil(w / this.zoom), bh = Math.ceil(h / this.zoom);
    if (buffer.width !== bw || buffer.height !== bh) { buffer.width = bw; buffer.height = bh; }
  }

  /** Gates next to (or under) our meerkat holding their key turn see-through. */
  openGates(): Set<LiveThing> {
    const p = this.meP;
    const open = new Set<LiveThing>();
    if (!p) return open;
    for (const t of this.game.things) {
      if (t.kind !== 'gate' || !p.keys.has(t.color)) continue;
      const near = Math.abs(t.x - p.cx) + Math.abs(t.y - p.cy) <= 1 || Math.abs(t.x - p.fromX) + Math.abs(t.y - p.fromY) <= 1;
      if (near) open.add(t);
    }
    return open;
  }

  render() {
    this.resize();
    const { level, game: g } = this;
    const bw = buffer.width, bh = buffer.height;
    const mapW = level.width * TILE, mapH = level.height * TILE;
    const Z = this.zoom;
    const me = this.meP;
    const meActor = this.meerkats.get(this.me)?.actor ?? { x: level.start.x, y: level.start.y, sheet: this.a.meerkats[0], anim: 'idle' as Anim, dir: 'down' as Dir, t: 0 };
    const others = [...this.meerkats.entries()].filter(([id]) => id !== this.me && g.players.some(p => p.id === id));

    // camera follows our meerkat; if the maze is smaller than the screen, centre it
    const cam = (focus: number, view: number, size: number) =>
      size + 2 * TILE <= view ? (size - view) / 2 : Math.max(-TILE, Math.min(size - view + TILE, focus - view / 2));
    const shakeX = this.shake > 0 ? Math.round((Math.random() - 0.5) * 6 * this.shake) : 0;
    const camX = Math.round(cam(meActor.x * TILE + TILE / 2, bw, mapW)) + shakeX;
    const camY = Math.round(cam(meActor.y * TILE, bh, mapH));

    world.imageSmoothingEnabled = false;
    world.fillStyle = '#100a18';
    world.fillRect(0, 0, bw, bh);
    world.save();
    world.translate(-camX, -camY);
    const scene = { things: g.things, barsOpen: g.barsOpen, openGates: this.openGates() };
    // friends stay visible through the fog, so they are drawn after it
    const visibleFriends = others.filter(([, m]) => (this.fog.visible[Math.round(m.actor.y)]?.[Math.round(m.actor.x)] ?? 0) > 0.3);
    const bubbles = this.renderer.draw(world, g.time, scene, [meActor, ...visibleFriends.map(([, m]) => m.actor), ...this.npcs], this.particles, meActor);
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
      // a friend's name tag would cover the bubble of a meerkat they stand next to
      const crowded = (b: { x: number; y: number }) => others.some(([, m]) => Math.hypot(m.actor.x * TILE + TILE / 2 - b.x, m.actor.y * TILE - b.y) < TILE * 1.6);
      if (!g.won && me?.mood !== 'sad') for (const b of bubbles) if (!crowded(b)) drawBubble(screen, this.a.font, b.text, (b.x - camX) * Z, (b.y - camY) * Z, s, g.time);

      // friends: name tags, or an arrow at the screen edge when they are out of view
      for (const [id, m] of others) {
        const p = g.players.find(q => q.id === id)!;
        const [x, y] = toScreen(m.actor.x, m.actor.y - 1.3);
        const color = SKIN_COLORS[p.skin % SKIN_COLORS.length];
        const label = p.jailLeft !== null ? `${p.name} HELP!` : p.name;
        if (x > 0 && y > 0 && x < canvas.width && y < canvas.height) {
          outlinedText(screen, this.a, label, x - (label.length * GLYPH_ADVANCE * s) / 2, y - 6 * s, color, s);
        } else {
          edgeArrow(screen, this.a, x, y, color, label, s);
        }
      }

      for (const pp of this.popups) {
        if (pp.t < 0) continue;
        const [x, y] = toScreen(pp.x, pp.y - 0.6 - pp.t * 1.2);
        screen.globalAlpha = Math.max(0, Math.min(1, (1.2 - pp.t) * 3));
        outlinedText(screen, this.a, pp.text, x - (pp.text.length * GLYPH_ADVANCE * s) / 2, y, pp.color, s);
        screen.globalAlpha = 1;
      }

      // countdowns above our meerkat's head
      if (me) {
        const [hx, hy] = toScreen(meActor.x, meActor.y - 1.4);
        if (me.zoneTime !== null) {
          const left = Math.max(0, RULES.zoneSeconds - me.zoneTime);
          countdownRing(screen, this.a, hx, hy - 6 * s, left / RULES.zoneSeconds, String(Math.ceil(left)), s * 2, g.time, left < 2);
        } else if (me.jailLeft !== null) {
          // shown under the meerkat's feet so it doesn't cover speech bubbles
          const t = g.players.length > 1 ? `WAIT FOR A FRIEND (${Math.ceil(me.jailLeft)})` : `FREE IN ${Math.ceil(me.jailLeft)}`;
          const [, fy] = toScreen(meActor.x, meActor.y + 1);
          outlinedText(screen, this.a, t, hx - (t.length * GLYPH_ADVANCE * s) / 2, fy + 2 * s, '#fff4d6', s);
        }
      }
    }

    if (this.showMap) {
      const dots = g.players.map(p => {
        const pos = playerPos(p);
        return { x: pos.x, y: pos.y, color: SKIN_COLORS[p.skin % SKIN_COLORS.length], me: p.id === this.me, name: this.multiplayer ? p.name : undefined, help: p.jailLeft !== null && p.id !== this.me };
      });
      drawMapView(screen, level, this.fog, dots, canvas.width, canvas.height, g.time, g.things);
    }
    this.hud();
    if (g.won) this.winScreen();
  }

  private button(label: string, x: number, s: number, color: string, shade: string, textColor = '#fff4d6'): Rect {
    const w = (label.length * 7 + 10) * s, h = 14 * s;
    const r = { x: x - w, y: 4 * s, w, h };
    screen.fillStyle = color;
    screen.fillRect(r.x, r.y, w, h);
    screen.fillStyle = shade;
    screen.fillRect(r.x, r.y + h - 2 * s, w, 2 * s);
    drawText(screen, this.a.font, label, r.x + 5 * s, r.y + 3 * s, textColor, s);
    return r;
  }

  hud() {
    const g = this.game, pl = this.meP;
    const s = Math.max(2, Math.round(this.zoom * 0.75));
    const W = canvas.width, H = canvas.height;
    // coins, gems and keys
    const keys = pl ? [...pl.keys] : [];
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

    let y = 22 * s;
    // star power bar
    if (pl && pl.starLeft > 0) {
      const frac = pl.starLeft / RULES.starSeconds;
      const bx = 4 * s, barW = 70 * s;
      screen.fillStyle = 'rgba(20,12,28,0.6)';
      screen.fillRect(bx, y, barW, 10 * s);
      screen.fillStyle = pl.starLeft < 4 && Math.floor(g.time * 6) % 2 ? '#ff6a3a' : '#ffd24a';
      screen.fillRect(bx + 2 * s, y + 2 * s, (barW - 4 * s) * frac, 6 * s);
      drawText(screen, this.a.font, 'STAR', bx + 3 * s, y + s, '#2b1a12', s);
      y += 12 * s;
    }
    // host: the game code, so more friends can join
    if (this.net.role === 'host') {
      const t = `CODE ${this.net.session.code}  (${g.players.length}/4)`;
      outlinedText(screen, this.a, t, 6 * s, y + 2 * s, '#ffd24a', Math.max(1, Math.round(s * 0.75)));
    }

    // buttons, right to left
    this.buttons.map = this.button(this.showMap ? 'BACK' : 'MAP', W - 4 * s, s, '#6a3fb5', '#4a2a85');
    this.buttons.back = this.button(this.opts.backLabel, this.buttons.map.x - 4 * s, s, '#3a2a55', '#261a3a');
    this.buttons.sound = this.button(audio.label, this.buttons.back.x - 4 * s, s, '#3a2a55', '#261a3a', audio.setting === 'off' ? '#c9b8dd' : '#fff4d6');

    // bail out a friend
    this.buttons.bail = NO_RECT;
    const someoneJailed = g.players.some(p => p.jailLeft !== null && p.id !== this.me);
    if (pl && !g.won && someoneJailed && pl.jailLeft === null && nearBars(g, pl)) {
      const t = 'SPACE: BAIL OUT YOUR FRIEND!';
      const bs = Math.max(2, s);
      const w = (t.length * 7 + 12) * bs, h = 16 * bs;
      const r = { x: (W - w) / 2, y: H - h - 22 * bs, w, h };
      screen.fillStyle = Math.floor(g.time * 3) % 2 ? '#2f9e57' : '#237a43';
      screen.fillRect(r.x, r.y, w, h);
      drawText(screen, this.a.font, t, r.x + 6 * bs, r.y + 4 * bs, '#fff4d6', bs);
      this.buttons.bail = r;
    }

    if (!g.won) {
      const hint = this.multiplayer
        ? 'WASD: WALK   SPACE: HELP FRIEND   M: MAP   N: SOUND   ESC: LEAVE'
        : 'ARROWS/WASD: WALK    M: MAP    N: SOUND    R: RESTART    ESC: BACK';
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
    const winner = g.players.find(p => p.mood === 'celebrate');
    const title = !this.multiplayer || winner?.id === this.me ? 'YOU FOUND THE EXIT!' : `${winner?.name ?? 'A FRIEND'} FOUND THE EXIT!`;
    const again = this.canRestart() ? 'PRESS ENTER OR TAP TO PLAY AGAIN' : 'WAITING FOR THE HOST TO PLAY AGAIN';
    const lines: [string, string, number][] = [
      [title.toUpperCase(), '#ffd24a', 1.5],
      [`COINS  ${g.coins}`, '#fff4d6', 1],
      [`GEMS   ${g.gems}`, '#7cc6ff', 1],
      [`TIME   ${formatTime(g.wonAt)}`, '#fff4d6', 1],
      [again, '#b58be0', 0.75],
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

/** An arrow at the edge of the screen pointing to a friend who is out of view. */
function edgeArrow(ctx: CanvasRenderingContext2D, a: Assets, x: number, y: number, color: string, label: string, s: number) {
  const W = ctx.canvas.width, H = ctx.canvas.height, m = 26 * s;
  const cx = W / 2, cy = H / 2;
  const ang = Math.atan2(y - cy, x - cx);
  const t = Math.min((W / 2 - m) / Math.abs(Math.cos(ang) || 1e-6), (H / 2 - m) / Math.abs(Math.sin(ang) || 1e-6));
  const ax = cx + Math.cos(ang) * t, ay = cy + Math.sin(ang) * t;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(ang);
  ctx.fillStyle = '#1a0f14';
  ctx.beginPath(); ctx.moveTo(10 * s, 0); ctx.lineTo(-6 * s, -8 * s); ctx.lineTo(-6 * s, 8 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(8 * s, 0); ctx.lineTo(-4 * s, -6 * s); ctx.lineTo(-4 * s, 6 * s); ctx.closePath(); ctx.fill();
  ctx.restore();
  const tx = Math.max(4 * s, Math.min(W - label.length * GLYPH_ADVANCE * s - 4 * s, ax - (label.length * GLYPH_ADVANCE * s) / 2));
  outlinedText(ctx, a, label, tx, ay + (ay > cy ? -20 : 12) * s, color, s);
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
