// The level editor: paint a maze with the real game art, then play-test it.
import { KEY_HUES, type Assets, type KeyColor } from '../assets';
import { audio } from '../audio';
import type { LiveThing } from '../game/state';
import { checkLevel, fromCode, NPC_CHARS, toCode, toLevel, type LevelData } from '../level-format';
import { drawText } from '../pixelfont';
import { LIFT, TILE, WorldRenderer, type Actor } from '../renderer';
import { saveLevel } from '../storage';
import { el } from '../ui';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const screen = canvas.getContext('2d')!;
const buffer = document.createElement('canvas');
const world = buffer.getContext('2d')!;

const MIN_SIZE = 7, MAX_SIZE = 60;
const COLORS = Object.keys(KEY_HUES) as KeyColor[];
const COLOR_CHAR: Record<KeyColor, string> = { yellow: 'y', blue: 'b', red: 'r', green: 'g', orange: 'o', pink: 'p' };

interface Tool { id: string; label: string; char: string | ((c: KeyColor) => string); hint: string }

const TOOLS: Tool[] = [
  { id: 'wall', label: 'Wall', char: '#', hint: 'Draw walls. Drag to draw long walls.' },
  { id: 'floor', label: 'Eraser', char: '.', hint: 'Rub things out (right-click also erases).' },
  { id: 'start', label: 'Start', char: 'S', hint: 'Where the meerkat begins. There is only one start.' },
  { id: 'exit', label: 'Exit', char: 'E', hint: 'Reach this to win!' },
  { id: 'coin', label: 'Coin', char: 'c', hint: 'Worth 1 coin.' },
  { id: 'gem', label: 'Gem', char: '$', hint: 'Worth 5 coins.' },
  { id: 'key', label: 'Key', char: c => COLOR_CHAR[c], hint: 'Opens gates of the same colour.' },
  { id: 'gate', label: 'Gate', char: c => COLOR_CHAR[c].toUpperCase(), hint: 'Only meerkats with the same colour key get through.' },
  { id: 'crate', label: 'Crate', char: 'm', hint: 'The meerkat can push it.' },
  { id: 'star', label: 'Star', char: '*', hint: '20 seconds of double speed and no fog.' },
  { id: 'zone', label: 'Red zone', char: 't', hint: 'Stay longer than 5 seconds and you go to jail!' },
  { id: 'jail', label: 'Jail', char: 'L', hint: 'Where caught meerkats get locked up. Put walls around it and BARS as its door.' },
  { id: 'bars', label: 'Bars', char: 'J', hint: 'The jail door. It opens after 10 seconds.' },
  { id: 'npc', label: 'Meerkat', char: 'n', hint: 'A meerkat that tells a joke. Type what it says below.' },
  { id: 'jailed', label: 'Jailed', char: 'j', hint: 'A meerkat stuck in jail.' },
  { id: 'spiky', label: 'Spiky', char: '@', hint: 'A meerkat inside a spiky ball.' },
];

export interface EditorOptions {
  onPlay: (data: LevelData) => void;
  onMenu: () => void;
}

export class Editor {
  private grid: string[][] = [];
  private texts = new Map<string, string>(); // "x,y" -> what the meerkat says
  private name = 'My Maze';
  private savedId: string | undefined;
  private undoStack: string[] = [];
  private tool: Tool = TOOLS[0];
  private color: KeyColor = 'yellow';
  private renderer!: WorldRenderer;
  private actors: Actor[] = [];
  private scene!: { things: LiveThing[]; barsOpen: boolean; openGates: Set<LiveThing> };
  private hover: { x: number; y: number } | null = null;
  private painting: 'paint' | 'erase' | null = null;
  private lastPainted = '';
  private selectedNpc: string | null = null;
  private time = 0;
  private view = { ox: 0, oy: 0, zoom: 1 };
  private listeners = new AbortController();
  private root: HTMLElement;
  private ui!: {
    tools: Map<string, HTMLButtonElement>; colors: HTMLElement; hint: HTMLElement; say: HTMLTextAreaElement;
    sayBox: HTMLElement; problems: HTMLElement; size: HTMLElement; name: HTMLInputElement; status: HTMLElement;
    dialog: HTMLElement;
  };

  constructor(private a: Assets, data: LevelData, savedId: string | undefined, private opts: EditorOptions, uiRoot: HTMLElement) {
    this.root = uiRoot;
    this.savedId = savedId;
    this.load(data);
    this.buildUi();
    this.bindInput();
    this.refresh();
    audio.music('menu');
  }

  dispose() {
    this.listeners.abort();
    this.root.replaceChildren();
  }

  // ---------- data ----------

  private load(d: LevelData) {
    this.name = d.name;
    this.grid = d.rows.map(r => [...r]);
    this.texts.clear();
    let i = 0;
    this.grid.forEach((row, y) => row.forEach((ch, x) => { if (NPC_CHARS.has(ch)) this.texts.set(`${x},${y}`, d.texts[i++] ?? '...'); }));
  }

  data(): LevelData {
    const rows = this.grid.map(r => r.join(''));
    const texts: string[] = [];
    this.grid.forEach((row, y) => row.forEach((ch, x) => { if (NPC_CHARS.has(ch)) texts.push(this.texts.get(`${x},${y}`) ?? '...'); }));
    return { version: 1, name: this.name.trim() || 'My Maze', rows, texts };
  }

  private snapshot() {
    this.undoStack.push(JSON.stringify(this.data()));
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  private undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.load(JSON.parse(s));
    this.selectedNpc = null;
    this.refresh();
  }

  get width() { return this.grid[0].length; }
  get height() { return this.grid.length; }

  private charFor(tool: Tool) {
    return typeof tool.char === 'function' ? tool.char(this.color) : tool.char;
  }

  private paint(x: number, y: number, erase: boolean) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const ch = erase ? '.' : this.charFor(this.tool);
    const k = `${x},${y}`;
    const before = this.grid[y][x];
    if (NPC_CHARS.has(ch) && NPC_CHARS.has(before) && !erase) {
      // clicking a meerkat with a meerkat tool selects it so you can change what it says
      this.selectNpc(k);
      if (before === ch) return;
    }
    if (before === ch) return;
    // only one start and one jail spot
    if (ch === 'S' || ch === 'L') this.grid.forEach(r => r.forEach((c, i) => { if (c === ch) r[i] = '.'; }));
    if (NPC_CHARS.has(before) && !NPC_CHARS.has(ch)) { this.texts.delete(k); if (this.selectedNpc === k) this.selectNpc(null); }
    if (NPC_CHARS.has(ch) && !this.texts.has(k)) {
      this.texts.set(k, this.ui.say.value.trim() || 'Hello!');
      this.selectNpc(k);
    }
    this.grid[y][x] = ch;
    this.refresh();
  }

  private selectNpc(k: string | null) {
    this.selectedNpc = k;
    if (k) this.ui.say.value = this.texts.get(k) ?? '';
  }

  private resize(dw: number, dh: number) {
    const w = this.width + dw, h = this.height + dh;
    if (w < MIN_SIZE || h < MIN_SIZE || w > MAX_SIZE || h > MAX_SIZE) return;
    this.snapshot();
    // grow/shrink just inside the right and bottom walls, keeping the border
    if (dw > 0) this.grid.forEach(r => r.splice(r.length - 1, 0, '.'));
    if (dw < 0) this.grid.forEach(r => r.splice(r.length - 2, 1));
    if (dh > 0) this.grid.splice(this.grid.length - 1, 0, this.grid[0].map((_, x) => (x === 0 || x === this.width - 1 ? '#' : '.')));
    if (dh < 0) this.grid.splice(this.grid.length - 2, 1);
    // keep texts only for meerkats that still exist
    const d = this.data();
    this.load(d);
    this.refresh();
  }

  /** Rebuild the preview after any change. */
  private refresh() {
    const d = this.data();
    const level = toLevel(d);
    this.renderer = new WorldRenderer(this.a, level);
    this.scene = { things: level.things.map((t, id) => ({ ...t, id, gone: false })), barsOpen: false, openGates: new Set() };
    this.actors = level.npcs.map(n => ({ x: n.x, y: n.y, sheet: this.a.meerkats[n.skin], anim: 'sentry' as const, dir: 'down' as const, t: n.x * 0.7 + n.y, npc: n }));
    if (this.grid.some(r => r.includes('S'))) {
      this.actors.push({ x: level.start.x, y: level.start.y, sheet: this.a.meerkats[0], anim: 'idle', dir: 'down', t: 0 });
    }
    // side panel
    for (const [id, b] of this.ui.tools) b.classList.toggle('on', id === this.tool.id);
    this.ui.colors.hidden = !(this.tool.id === 'key' || this.tool.id === 'gate');
    this.ui.colors.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.color === this.color));
    this.ui.hint.textContent = this.tool.hint;
    this.ui.sayBox.hidden = !(this.tool.id === 'npc' || this.tool.id === 'jailed' || this.tool.id === 'spiky');
    this.ui.size.textContent = `${this.width} × ${this.height}`;
    const problems = checkLevel(d);
    this.ui.problems.replaceChildren(...(problems.length
      ? problems.map(p => el('li', { class: p.level }, p.message))
      : [el('li', { class: 'ok' }, 'Looks good! Press PLAY to try it.')]));
  }

  // ---------- UI ----------

  private buildUi() {
    const tools = new Map<string, HTMLButtonElement>();
    const toolButtons = TOOLS.map(t => {
      const b = el('button', { class: 'tool', title: t.hint, 'aria-label': t.label }, this.toolIcon(t), el('span', {}, t.label));
      b.addEventListener('click', () => { this.tool = t; audio.play('click', 0.3); this.refresh(); });
      tools.set(t.id, b);
      return b;
    });
    const colors = el('div', { class: 'colors' }, ...COLORS.map(c => {
      const b = el('button', { 'data-color': c, title: c, 'aria-label': `${c} colour`, style: `--c: hsl(${KEY_HUES[c]}, 80%, 55%)` });
      b.addEventListener('click', () => { this.color = c; this.refreshIcons(); this.refresh(); });
      return b;
    }));
    const say = el('textarea', { id: 'npc-say', rows: '2', maxlength: '80', placeholder: 'What does this meerkat say?' });
    say.addEventListener('input', () => {
      if (this.selectedNpc && this.texts.has(this.selectedNpc)) { this.texts.set(this.selectedNpc, say.value); this.refreshSoon(); }
    });
    const sayBox = el('label', { class: 'say' }, el('span', {}, 'Meerkat says:'), say,
      el('small', {}, 'Click a meerkat on the map to change its words.'));
    const name = el('input', { id: 'level-name', value: this.name, maxlength: '40', 'aria-label': 'Level name' });
    name.addEventListener('input', () => { this.name = name.value; });

    const button = (label: string, cls: string, fn: () => void, title = '') => {
      const b = el('button', { class: cls, title }, label);
      b.addEventListener('click', fn);
      return b;
    };
    const status = el('p', { class: 'status', role: 'status' });
    const size = el('span', { class: 'size' });
    const problems = el('ul', { class: 'problems' });
    const dialog = el('div', { class: 'dialog', hidden: '' });

    const panel = el('aside', { class: 'editor-panel' },
      el('div', { class: 'row' },
        button('← Menu', 'btn ghost', () => this.opts.onMenu()),
        name),
      el('div', { class: 'row' },
        button('▶ Play', 'btn play', () => this.play()),
        button('Save', 'btn', () => this.save()),
        button('Undo', 'btn ghost', () => this.undo(), 'Ctrl+Z')),
      el('div', { class: 'tools' }, ...toolButtons),
      colors,
      el('p', { class: 'hint' }),
      sayBox,
      el('div', { class: 'row sizes' },
        el('span', {}, 'Size'),
        button('−', 'btn small', () => this.resize(-1, 0), 'Narrower'),
        button('+', 'btn small', () => this.resize(1, 0), 'Wider'),
        size,
        button('−', 'btn small', () => this.resize(0, -1), 'Shorter'),
        button('+', 'btn small', () => this.resize(0, 1), 'Taller')),
      problems,
      el('div', { class: 'row' },
        button('Copy level code', 'btn ghost', () => this.copyCode()),
        button('Paste level code', 'btn ghost', () => this.pasteCode())),
      status,
      dialog,
    );
    this.root.replaceChildren(panel);
    this.ui = { tools, colors, hint: panel.querySelector('.hint')!, say, sayBox, problems, size, name, status, dialog };
  }

  private refreshTimer = 0;
  private refreshSoon() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.refresh(), 150);
  }

  private refreshIcons() {
    for (const t of TOOLS) {
      if (t.id !== 'key' && t.id !== 'gate') continue;
      const b = this.ui.tools.get(t.id)!;
      b.replaceChild(this.toolIcon(t), b.firstChild!);
    }
  }

  /** Draw a tool's icon with the real game art (a 1-tile level rendered small). */
  private toolIcon(tool: Tool): HTMLCanvasElement {
    const ch = this.charFor(tool);
    const c = document.createElement('canvas');
    c.width = 24; c.height = 28;
    c.className = 'icon';
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const rows = ['...', `.${ch === 'S' || ch === 'L' ? '.' : ch}.`, '...'];
    const lvl = toLevel({ version: 1, name: '', rows, texts: ['Hi'] });
    const r = new WorldRenderer(this.a, lvl);
    const things = lvl.things.map((t, id) => ({ ...t, id, gone: false }));
    const actors: Actor[] = lvl.npcs.map(n => ({ x: n.x, y: n.y, sheet: this.a.meerkats[1], anim: 'idle', dir: 'down', t: 0, npc: n }));
    if (ch === 'S') actors.push({ x: 1, y: 1, sheet: this.a.meerkats[0], anim: 'idle', dir: 'down', t: 0 });
    const far: Actor = { x: -99, y: -99, sheet: this.a.meerkats[0], anim: 'idle', dir: 'down', t: 0 };
    ctx.translate(-TILE + 4, -TILE + 10);
    r.draw(ctx, 0.3, { things, barsOpen: false, openGates: new Set() }, actors, [], far);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (ch === 'L') this.jailMarker(ctx, 4, 10);
    return c;
  }

  private jailMarker(ctx: CanvasRenderingContext2D, px: number, py: number) {
    ctx.fillStyle = 'rgba(40, 20, 60, 0.55)';
    ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
    ctx.fillStyle = '#fff4d6';
    // little padlock
    ctx.fillRect(px + 5, py + 7, 6, 5);
    ctx.fillRect(px + 6, py + 4, 1, 3); ctx.fillRect(px + 9, py + 4, 1, 3); ctx.fillRect(px + 6, py + 3, 4, 1);
    ctx.fillStyle = '#2b1a12'; ctx.fillRect(px + 7, py + 9, 2, 2);
  }

  private say(msg: string) {
    this.ui.status.textContent = msg;
    clearTimeout(this.sayTimer);
    this.sayTimer = window.setTimeout(() => { this.ui.status.textContent = ''; }, 5000);
  }
  private sayTimer = 0;

  private play() {
    const d = this.data();
    const errors = checkLevel(d).filter(p => p.level === 'error');
    if (errors.length) { this.say(errors[0].message); return; }
    this.opts.onPlay(d);
  }

  private save() {
    const id = saveLevel(this.data(), this.savedId);
    if (id) { this.savedId = id; this.say(`Saved "${this.data().name}" to My Levels.`); }
    else this.say('This browser would not let us save. Use "Copy level code" and keep the code somewhere safe.');
  }

  get currentId() { return this.savedId; }

  private copyCode() {
    const code = toCode(this.data());
    this.showDialog('Level code', 'Send this code to a friend. They can paste it in "Play a level code".', code, true);
    navigator.clipboard?.writeText(code).then(() => this.say('Level code copied!'), () => { /* the box below lets you copy by hand */ });
  }

  private pasteCode() {
    this.showDialog('Paste a level code', 'This replaces the level you are editing (Undo brings it back).', '', false, text => {
      try {
        const d = fromCode(text);
        this.snapshot();
        this.load(d);
        this.ui.name.value = this.name;
        this.savedId = undefined;
        this.refresh();
        this.say(`Loaded "${d.name}".`);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
  }

  private showDialog(title: string, text: string, value: string, readOnly: boolean, onOk?: (v: string) => string | null) {
    const box = el('textarea', { id: 'code-box', rows: '4', spellcheck: 'false' }) as HTMLTextAreaElement;
    box.value = value;
    box.readOnly = readOnly;
    const err = el('p', { class: 'error', role: 'alert' });
    const close = () => { this.ui.dialog.hidden = true; this.ui.dialog.replaceChildren(); };
    const ok = el('button', { class: 'btn play' }, readOnly ? 'Done' : 'Load');
    ok.addEventListener('click', () => {
      if (!onOk) return close();
      const problem = onOk(box.value);
      if (problem) err.textContent = problem; else close();
    });
    const cancel = el('button', { class: 'btn ghost' }, 'Cancel');
    cancel.addEventListener('click', close);
    this.ui.dialog.replaceChildren(el('h3', {}, title), el('p', {}, text), box, err, el('div', { class: 'row' }, ok, ...(readOnly ? [] : [cancel])));
    this.ui.dialog.hidden = false;
    box.focus();
    if (readOnly) box.select();
  }

  // ---------- input ----------

  private cellAt(e: PointerEvent): { x: number; y: number } | null {
    const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const sx = (e.clientX - r.left) * dpr, sy = (e.clientY - r.top) * dpr;
    const { ox, oy, zoom } = this.view;
    const x = Math.floor((sx / zoom - ox) / TILE), y = Math.floor((sy / zoom - oy) / TILE);
    return x >= 0 && y >= 0 && x < this.width && y < this.height ? { x, y } : null;
  }

  private bindInput() {
    const signal = this.listeners.signal;
    canvas.addEventListener('contextmenu', e => e.preventDefault(), { signal });
    canvas.addEventListener('pointerdown', e => {
      const c = this.cellAt(e);
      if (!c) return;
      canvas.setPointerCapture(e.pointerId);
      this.snapshot();
      this.painting = e.button === 2 ? 'erase' : 'paint';
      this.lastPainted = `${c.x},${c.y}`;
      this.paint(c.x, c.y, this.painting === 'erase');
    }, { signal });
    canvas.addEventListener('pointermove', e => {
      const c = this.cellAt(e);
      this.hover = c;
      if (!this.painting || !c) return;
      const k = `${c.x},${c.y}`;
      if (k === this.lastPainted) return;
      this.lastPainted = k;
      // single things (start, jail, meerkats) are placed once per click, not smeared
      const smear = ['wall', 'floor', 'coin', 'zone'].includes(this.tool.id) || this.painting === 'erase';
      if (smear) this.paint(c.x, c.y, this.painting === 'erase');
    }, { signal });
    const end = () => { this.painting = null; };
    canvas.addEventListener('pointerup', end, { signal });
    canvas.addEventListener('pointercancel', end, { signal });
    canvas.addEventListener('pointerleave', () => { this.hover = null; }, { signal });
    addEventListener('keydown', e => {
      const typing = (e.target as HTMLElement)?.matches?.('input, textarea');
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !typing) { e.preventDefault(); this.undo(); }
    }, { signal });
  }

  // ---------- drawing ----------

  update(dt: number) {
    this.time += dt;
    for (const a of this.actors) a.t += dt;
  }

  render() {
    const dpr = devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

    // the map fits in the space the side panel leaves free
    const panel = this.root.querySelector('.editor-panel')?.getBoundingClientRect();
    const wide = !panel || panel.height > r.height * 0.8;
    const freeW = wide && panel ? (panel.left - r.left) * dpr : W;
    const freeH = !wide && panel ? (panel.top - r.top) * dpr : H;
    const mapW = this.width * TILE, mapH = this.height * TILE + LIFT;
    const zoom = Math.max(1, Math.floor(Math.min((freeW - 16) / mapW, (freeH - 16) / mapH)));
    const bw = Math.ceil(W / zoom), bh = Math.ceil(H / zoom);
    if (buffer.width !== bw || buffer.height !== bh) { buffer.width = bw; buffer.height = bh; }
    const ox = Math.round((freeW / zoom - mapW) / 2), oy = Math.round((freeH / zoom - mapH) / 2) + LIFT;
    this.view = { ox, oy, zoom };

    world.imageSmoothingEnabled = false;
    world.fillStyle = '#1a1220';
    world.fillRect(0, 0, bw, bh);
    world.save();
    world.translate(ox, oy);
    const far: Actor = { x: -99, y: -99, sheet: this.a.meerkats[0], anim: 'idle', dir: 'down', t: 0 };
    this.renderer.draw(world, this.time, this.scene, this.actors, [], far);

    // jail spot marker and grid
    this.grid.forEach((row, y) => row.forEach((ch, x) => { if (ch === 'L') this.jailMarker(world, x * TILE, y * TILE); }));
    world.fillStyle = 'rgba(255, 255, 255, 0.07)';
    for (let x = 0; x <= this.width; x++) world.fillRect(x * TILE, 0, 1, this.height * TILE);
    for (let y = 0; y <= this.height; y++) world.fillRect(0, y * TILE, this.width * TILE, 1);

    // selected meerkat and hovered cell
    if (this.selectedNpc && !this.ui.sayBox.hidden) {
      const [sx, sy] = this.selectedNpc.split(',').map(Number);
      world.strokeStyle = '#ffd24a'; world.lineWidth = 1;
      world.strokeRect(sx * TILE + 0.5, sy * TILE - 8.5, TILE - 1, TILE + 8);
    }
    if (this.hover) {
      const { x, y } = this.hover;
      world.strokeStyle = this.painting === 'erase' ? '#ff6a5a' : '#fff4d6';
      world.lineWidth = 1;
      world.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
    }
    world.restore();

    screen.imageSmoothingEnabled = false;
    screen.drawImage(buffer, 0, 0, bw * zoom, bh * zoom);
    const s = Math.max(1, Math.round(zoom / 2));
    drawText(screen, this.a.font, 'LEVEL EDITOR', 8 * s, 6 * s, 'rgba(255,244,214,0.7)', s);
  }
}
