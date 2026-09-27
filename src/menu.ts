// Title menu: play the built-in maze, your own levels, a shared level code, or open the editor.
import type { Assets } from './assets';
import { LEVEL_1, LEVEL_1_DATA } from './level';
import { blankLevel, fromCode, type LevelData } from './level-format';
import { LIFT, TILE, WorldRenderer, type Actor } from './renderer';
import { deleteLevel, listLevels } from './storage';
import { el } from './ui';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const screen = canvas.getContext('2d')!;
const buffer = document.createElement('canvas');
const world = buffer.getContext('2d')!;

export interface MenuOptions {
  play: (d: LevelData) => void;
  edit: (d: LevelData, id?: string) => void;
}

export class Menu {
  private time = 0;
  private renderer: WorldRenderer;
  private actors: Actor[];
  private things = LEVEL_1.things.map((t, id) => ({ ...t, id, gone: false }));

  constructor(private a: Assets, private opts: MenuOptions, private root: HTMLElement) {
    this.renderer = new WorldRenderer(a, LEVEL_1);
    this.actors = LEVEL_1.npcs.map(n => ({ x: n.x, y: n.y, sheet: a.meerkats[n.skin], anim: 'sentry' as const, dir: 'down' as const, t: n.x, npc: n }));
    this.actors.push({ x: 8, y: 7, sheet: a.meerkats[0], anim: 'sentry', dir: 'down', t: 0 });
    this.showMain();
  }

  dispose() { this.root.replaceChildren(); }

  private btn(label: string, cls: string, fn: () => void) {
    const b = el('button', { class: cls }, label);
    b.addEventListener('click', fn);
    return b;
  }

  private showMain() {
    const saved = listLevels();
    const card = el('div', { class: 'menu-card' },
      el('h1', {}, 'The Labyrinth'),
      el('p', { class: 'tagline' }, 'Help the meerkat find the exit!'),
      this.btn('▶  Play: Meerkat Maze', 'btn play big', () => this.opts.play(LEVEL_1_DATA)),
      this.btn(`My levels (${saved.length})`, 'btn big', () => this.showMyLevels()),
      this.btn('✎  Make a level', 'btn big', () => this.opts.edit(blankLevel())),
      this.btn('Play a level code', 'btn ghost', () => this.showCode()),
      el('p', { class: 'credits' }, 'Designed by our 8-year-old game designer. Art: Ninja Adventure by Pixel-boy (CC0).'),
    );
    this.root.replaceChildren(el('div', { class: 'menu' }, card));
    (card.querySelector('.btn.play') as HTMLButtonElement | null)?.focus();
  }

  private showMyLevels() {
    const list = listLevels();
    const items = list.length
      ? list.map(l => el('li', {},
          el('span', { class: 'lvl-name' }, l.data.name),
          el('span', { class: 'lvl-size' }, `${l.data.rows[0].length}×${l.data.rows.length}`),
          this.btn('Play', 'btn small play', () => this.opts.play(l.data)),
          this.btn('Edit', 'btn small', () => this.opts.edit(l.data, l.id)),
          this.btn('Delete', 'btn small ghost', () => { deleteLevel(l.id); this.showMyLevels(); })))
      : [el('li', { class: 'empty' }, 'No levels yet. Make one with "Make a level"!')];
    this.root.replaceChildren(el('div', { class: 'menu' }, el('div', { class: 'menu-card' },
      el('h2', {}, 'My levels'),
      el('ul', { class: 'levels' }, ...items),
      el('div', { class: 'row' },
        this.btn('← Back', 'btn ghost', () => this.showMain()),
        this.btn('Open Meerkat Maze in the editor', 'btn ghost', () => this.opts.edit(LEVEL_1_DATA))),
    )));
  }

  private showCode() {
    const box = el('textarea', { id: 'play-code', rows: '4', spellcheck: 'false', placeholder: 'MEERKAT1:...' });
    const err = el('p', { class: 'error', role: 'alert' });
    const load = (then: (d: LevelData) => void) => () => {
      try { then(fromCode(box.value)); } catch (e) { err.textContent = (e as Error).message; }
    };
    this.root.replaceChildren(el('div', { class: 'menu' }, el('div', { class: 'menu-card' },
      el('h2', {}, 'Play a level code'),
      el('p', {}, 'Paste the code a friend sent you.'),
      box, err,
      el('div', { class: 'row' },
        this.btn('▶ Play', 'btn play', load(d => this.opts.play(d))),
        this.btn('Edit', 'btn', load(d => this.opts.edit(d))),
        this.btn('← Back', 'btn ghost', () => this.showMain())),
    )));
    box.focus();
  }

  update(dt: number) {
    this.time += dt;
    for (const a of this.actors) a.t += dt;
  }

  /** Background: the first maze drifting slowly, dimmed. */
  render() {
    const dpr = devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const zoom = Math.max(2, Math.round(Math.min(W, H) / (10 * TILE)));
    const bw = Math.ceil(W / zoom), bh = Math.ceil(H / zoom);
    if (buffer.width !== bw || buffer.height !== bh) { buffer.width = bw; buffer.height = bh; }
    const mapW = LEVEL_1.width * TILE, mapH = LEVEL_1.height * TILE;
    const t = this.time * 0.05;
    const camX = Math.round((mapW - bw) / 2 + Math.sin(t) * Math.max(0, (mapW - bw) / 2 + TILE));
    const camY = Math.round((mapH - bh) / 2 + Math.cos(t * 0.7) * Math.max(0, (mapH - bh) / 2 + TILE)) - LIFT;
    world.imageSmoothingEnabled = false;
    world.fillStyle = '#1a1220';
    world.fillRect(0, 0, bw, bh);
    world.save();
    world.translate(-camX, -camY);
    const far: Actor = { x: -99, y: -99, sheet: this.a.meerkats[0], anim: 'idle', dir: 'down', t: 0 };
    this.renderer.draw(world, this.time, { things: this.things, barsOpen: false, openGates: new Set() }, this.actors, [], far);
    world.restore();
    world.fillStyle = 'rgba(26, 18, 32, 0.55)';
    world.fillRect(0, 0, bw, bh);
    screen.imageSmoothingEnabled = false;
    screen.drawImage(buffer, 0, 0, bw * zoom, bh * zoom);
  }
}
