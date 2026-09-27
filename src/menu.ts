// Title menu: play the built-in maze, your own levels, a shared level code, play with friends,
// or open the editor.
import type { Assets } from './assets';
import { audio } from './audio';
import { LEVEL_1, LEVEL_1_DATA } from './level';
import { desktop } from './desktop';
import { blankLevel, fromCode, fromFileText, type LevelData } from './level-format';
import { LIFT, TILE, WorldRenderer, type Actor } from './renderer';
import { cleanCode, GuestSession, HostSession, MAX_PLAYERS, savedPeerServer, serverOptions, setPeerServer, testPeerServer } from './net/session';
import type { HostMsg } from './net/protocol';
import { BUILTIN_LEVELS, CAMPAIGN } from './levels';
import { isUnlocked, loadProgress } from './progress';
import { deleteLevel, listLevels } from './storage';
import { el } from './ui';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const screen = canvas.getContext('2d')!;
const buffer = document.createElement('canvas');
const world = buffer.getContext('2d')!;

export interface MenuOptions {
  play: (d: LevelData) => void;
  /** level i of the 10 */
  playCampaign: (i: number) => void;
  edit: (d: LevelData, id?: string) => void;
  /** start an online game as the host */
  host: (session: HostSession, d: LevelData, name: string) => void;
  /** the host started the game we joined */
  joined: (session: GuestSession, d: LevelData, me: number) => void;
  /** shown once on the main menu (e.g. why an online game ended) */
  notice?: string;
}

const NAME_KEY = 'meerkat-labyrinth/name';
function savedName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
function saveName(n: string) {
  try { localStorage.setItem(NAME_KEY, n); } catch { /* fine */ }
}

export class Menu {
  private time = 0;
  private renderer: WorldRenderer;
  private actors: Actor[];
  private things = LEVEL_1.things.map((t, id) => ({ ...t, id, gone: false }));

  constructor(a: Assets, private opts: MenuOptions, private root: HTMLElement) {
    this.renderer = new WorldRenderer(a, LEVEL_1);
    this.actors = LEVEL_1.npcs.map(n => ({ x: n.x, y: n.y, sheet: a.meerkats[n.skin], anim: 'sentry' as const, dir: 'down' as const, t: n.x, npc: n }));
    this.actors.push({ x: 8, y: 7, sheet: a.meerkats[0], anim: 'sentry', dir: 'down', t: 0 });
    this.showMain();
    audio.music('menu');
  }

  /** an online session that is still in the lobby (closed if we leave the menu without starting) */
  private session: HostSession | GuestSession | null = null;

  dispose() {
    this.root.replaceChildren();
    this.session?.close();
  }

  private leaveLobby() {
    this.session?.close();
    this.session = null;
  }

  private btn(label: string, cls: string, fn: () => void) {
    const b = el('button', { class: cls }, label);
    b.addEventListener('click', () => { audio.play('click', 0.4); fn(); });
    return b;
  }

  private showMain() {
    this.leaveLobby();
    const saved = listLevels();
    const card = el('div', { class: 'menu-card' },
      el('h1', {}, 'The Labyrinth'),
      el('p', { class: 'tagline' }, 'Help the meerkat find the exit!'),
      ...(this.opts.notice ? [el('p', { class: 'notice', role: 'status' }, this.opts.notice)] : []),
      this.btn('▶  Play', 'btn play big', () => this.showLevels()),
      this.btn(`My levels (${saved.length})`, 'btn big', () => this.showMyLevels()),
      this.btn('✎  Make a level', 'btn big', () => this.opts.edit(blankLevel())),
      this.btn('👥  Play with friends', 'btn big', () => this.showFriends()),
      this.btn('Play a level code', 'btn ghost', () => this.showCode()),
      this.soundButton(),
      el('p', { class: 'credits' }, 'Designed by our 8-year-old game designer. Art: Ninja Adventure by Pixel-boy (CC0).'),
    );
    this.root.replaceChildren(el('div', { class: 'menu' }, card));
    (card.querySelector('.btn.play') as HTMLButtonElement | null)?.focus();
  }

  // ---------------- play with friends ----------------

  private showFriends() {
    this.leaveLobby();
    const name = el('input', { id: 'player-name', maxlength: '16', value: savedName(), placeholder: 'Your name', 'aria-label': 'Your name' });
    const ids = CAMPAIGN.map(l => l.id), progress = loadProgress();
    const levels = [
      ...BUILTIN_LEVELS.filter((_, i) => isUnlocked(ids, i, progress)).map(l => ({ id: l.id, data: l.data })),
      ...listLevels().map(l => ({ id: l.id, data: l.data })),
    ];
    const pick = el('select', { id: 'host-level', 'aria-label': 'Level' },
      ...levels.map(l => el('option', l.id === 'meerkat-maze' ? { value: l.id, selected: '' } : { value: l.id }, l.data.name)));
    const code = el('input', { id: 'join-code', maxlength: '8', placeholder: 'ABC123', autocomplete: 'off', 'aria-label': 'Game code' });
    code.addEventListener('input', () => { code.value = cleanCode(code.value); });
    const err = el('p', { class: 'error', role: 'alert' });
    const myName = () => {
      const n = name.value.trim().slice(0, 16);
      if (!n) { err.textContent = 'Type your name first.'; name.focus(); return null; }
      saveName(n);
      return n;
    };
    this.root.replaceChildren(el('div', { class: 'menu' }, el('div', { class: 'menu-card' },
      el('h2', {}, 'Play with friends'),
      el('p', { class: 'muted' }, `Up to ${MAX_PLAYERS} meerkats. Find the exit together, share the coins, and bail each other out of jail!`),
      el('label', { class: 'field' }, el('span', {}, 'Your name'), name),
      el('div', { class: 'split' },
        el('div', { class: 'col' },
          el('h3', {}, 'Host a game'),
          el('label', { class: 'field' }, el('span', {}, 'Level'), pick),
          this.btn('Host', 'btn play', () => {
            const n = myName();
            if (n) this.showHostLobby(levels.find(l => l.id === pick.value)!.data, n);
          })),
        el('div', { class: 'col' },
          el('h3', {}, 'Join a game'),
          el('label', { class: 'field' }, el('span', {}, 'Game code'), code),
          this.btn('Join', 'btn play', () => {
            const n = myName();
            if (!n) return;
            if (code.value.length !== 6) { err.textContent = 'The game code has 6 letters and numbers.'; code.focus(); return; }
            this.showJoining(code.value, n);
          }))),
      err,
      this.connectionSettings(),
      this.btn('← Back', 'btn ghost', () => this.showMain()),
    )));
    (name.value ? code : name).focus();
  }

  /** Which server helps players find each other (the free PeerJS one, or your own). */
  private connectionSettings() {
    const saved = savedPeerServer();
    const fromAddress = new URLSearchParams(location.search).get('peer');
    const input = el('input', { id: 'peer-server', value: saved ?? '', placeholder: 'Empty = the free public server', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Server address' });
    const status = el('p', { class: 'muted', role: 'status' },
      fromAddress ? `Using ${fromAddress} (from the page address).` : saved ? `Using your server: ${saved}` : 'Using the free public server.');
    const say = (text: string, cls = 'muted') => { status.textContent = text; status.className = cls; };
    const value = () => input.value.trim() || null;
    const test = this.btn('Test', 'btn small ghost', async () => {
      const server = value();
      if (server) { try { serverOptions(server); } catch (e) { say((e as Error).message, 'error'); return; } }
      say(`Testing ${server ?? 'the free server'}…`);
      test.setAttribute('disabled', '');
      const problem = await testPeerServer(server);
      test.removeAttribute('disabled');
      say(problem ? problem : `${server ?? 'The free server'} works!`, problem ? 'error' : 'ok');
    });
    const save = this.btn('Save', 'btn small', () => {
      const server = value();
      if (server) { try { serverOptions(server); } catch (e) { say((e as Error).message, 'error'); return; } }
      setPeerServer(server);
      say(server ? `Saved. Online games now use ${server}.` : 'Saved. Online games use the free public server.', 'ok');
    });
    const reset = this.btn('Use the free server', 'btn small ghost', () => {
      input.value = '';
      setPeerServer(null);
      say('Online games use the free public server.', 'ok');
    });
    const box = el('details', { class: 'settings' },
      el('summary', {}, 'Connection settings'),
      el('p', { class: 'muted' }, 'Online games use a free public server to find each other. If joining does not work, one of you can run your own server (npm run peer-server) and type its address here, like my-computer:9000. Everybody playing together needs the same server.'),
      el('label', { class: 'field' }, el('span', {}, 'Server'), input),
      el('div', { class: 'row' }, test, save, reset),
      status);
    if (saved) box.setAttribute('open', '');
    return box;
  }

  private lobbyCard(...children: (Node | string)[]) {
    this.root.replaceChildren(el('div', { class: 'menu' }, el('div', { class: 'menu-card' }, ...children)));
  }

  private showHostLobby(level: LevelData, name: string) {
    const session = new HostSession();
    this.session = session;
    const codeEl = el('p', { class: 'big-code', 'aria-live': 'polite' }, '······');
    const status = el('p', { class: 'muted', role: 'status' }, 'Getting a game code…');
    const list = el('ul', { class: 'players' });
    const start = this.btn('▶ Start', 'btn play big', () => {
      this.session = null; // the game takes over the session
      this.opts.host(session, level, name);
    });
    start.setAttribute('disabled', '');
    const refresh = () => {
      const names = [name, ...[...session.guests.values()].map(g => g.name)];
      list.replaceChildren(...names.map((n, i) => el('li', {}, el('span', { class: 'dot', style: `background:${['#e8433a', '#3a8fe8', '#57b847', '#b457e8'][i]}` }), n)));
      const lobby: HostMsg = { t: 'lobby', players: names.map((n, i) => ({ id: i, name: n, skin: i })) };
      session.broadcast(lobby);
    };
    session.onReady = code => {
      codeEl.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
      status.textContent = `Tell your friends this code. They choose "Play with friends", then "Join". You can start now; friends can join later too.`;
      start.removeAttribute('disabled');
      refresh();
    };
    session.onError = msg => { status.textContent = msg; status.className = 'error'; };
    session.onGuestJoin = () => { audio.chatter(); refresh(); };
    session.onGuestLeave = refresh;
    session.start();
    this.lobbyCard(
      el('h2', {}, `Hosting: ${level.name}`),
      el('p', { class: 'muted' }, 'Game code'),
      codeEl, status,
      el('h3', {}, 'Meerkats'), list,
      el('div', { class: 'row' }, start, this.btn('Cancel', 'btn ghost', () => this.showFriends())),
    );
  }

  private showJoining(code: string, name: string) {
    const session = new GuestSession();
    this.session = session;
    const status = el('p', { class: 'muted', role: 'status' }, `Looking for game ${code}…`);
    const list = el('ul', { class: 'players' });
    session.onError = msg => { status.textContent = msg; status.className = 'error'; };
    session.onClose = () => { status.textContent = 'The connection closed.'; status.className = 'error'; };
    session.onMessage = m => {
      if (m.t === 'lobby') {
        status.textContent = 'You are in! Waiting for the host to start…';
        list.replaceChildren(...m.players.map(p => el('li', {}, el('span', { class: 'dot', style: `background:${['#e8433a', '#3a8fe8', '#57b847', '#b457e8'][p.skin % 4]}` }), p.name)));
      } else if (m.t === 'start') {
        this.session = null; // the game takes over the session
        this.opts.joined(session, m.level, m.you);
      } else if (m.t === 'bye') {
        status.textContent = m.reason; status.className = 'error';
      }
    };
    session.join(code, name);
    this.lobbyCard(
      el('h2', {}, 'Joining a game'),
      status,
      el('h3', {}, 'Meerkats'), list,
      this.btn('Cancel', 'btn ghost', () => this.showFriends()),
    );
  }

  private soundButton() {
    const text = () => ({ all: '♪ Sound: on', fx: '♪ Music: off', off: '♪ Sound: off' })[audio.setting];
    const b = el('button', { class: 'btn ghost' }, text());
    b.addEventListener('click', () => { audio.toggle(); b.textContent = text(); audio.play('click', 0.4); });
    return b;
  }

  /** The 10 levels, easiest first; finishing one opens the next. */
  private showLevels() {
    this.leaveLobby();
    const progress = loadProgress();
    const ids = CAMPAIGN.map(l => l.id);
    const time = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const items = CAMPAIGN.map((l, i) => {
      const open = isUnlocked(ids, i, progress);
      const best = progress?.[l.id];
      const dots = el('span', { class: 'lvl-dots', 'aria-label': `difficulty ${l.difficulty} of 5` }, '●'.repeat(l.difficulty) + '○'.repeat(5 - l.difficulty));
      const status = best ? el('span', { class: 'lvl-best' }, `✓ ${time(best.time)} · ${best.coins} coins`)
        : open ? el('span', { class: 'lvl-best' }, '') : el('span', { class: 'lvl-lock' }, '🔒 finish the level before');
      return el('li', { class: open ? '' : 'locked' },
        el('span', { class: 'lvl-num' }, String(i + 1)),
        el('span', { class: 'lvl-text' },
          el('span', { class: 'lvl-name' }, l.data.name, ' ', dots),
          el('span', { class: 'lvl-blurb' }, l.blurb),
          status),
        ...(open ? [
          this.btn('Play', 'btn small play', () => this.opts.playCampaign(i)),
          this.btn('Edit', 'btn small ghost', () => this.opts.edit({ ...l.data, name: `${l.data.name} (my copy)` })),
        ] : []));
    });
    const done = CAMPAIGN.filter(l => progress?.[l.id]).length;
    this.root.replaceChildren(el('div', { class: 'menu' }, el('div', { class: 'menu-card wide' },
      el('h2', {}, `Play · ${done}/${CAMPAIGN.length} levels done`),
      el('ul', { class: 'levels' }, ...items),
      el('div', { class: 'row' },
        this.btn('← Back', 'btn ghost', () => this.showMain()),
        this.btn(`My levels (${listLevels().length})`, 'btn ghost', () => this.showMyLevels())),
    )));
    // start on the first level that is open but not finished yet
    const next = CAMPAIGN.findIndex((l, i) => isUnlocked(ids, i, progress) && !progress?.[l.id]);
    const buttons = this.root.querySelectorAll<HTMLButtonElement>('.levels .btn.play');
    (buttons[next >= 0 ? next : 0] ?? buttons[0])?.focus();
    buttons[next >= 0 ? next : 0]?.scrollIntoView({ block: 'nearest' });
  }

  private showMyLevels() {
    this.leaveLobby();
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
      ...(desktop ? [this.openFileRow()] : []),
      el('div', { class: 'row' },
        this.btn('← Back', 'btn ghost', () => this.showMain()),
        this.btn('Open Meerkat Maze in the editor', 'btn ghost', () => this.opts.edit(LEVEL_1_DATA))),
      el('p', { class: 'muted' }, 'Tip: any level from the Play list can be opened in the editor too.'),
    )));
  }

  /** Desktop app: play or edit a level file (.meerkat). */
  private openFileRow() {
    const err = el('p', { class: 'error', role: 'alert' });
    const open = (then: (d: LevelData) => void) => async () => {
      try {
        const file = await desktop!.openLevelFile();
        if (file) then(fromFileText(file.text));
      } catch (e) { err.textContent = (e as Error).message; }
    };
    return el('div', { class: 'col' },
      el('div', { class: 'row' },
        this.btn('▶ Play a level file…', 'btn', open(d => this.opts.play(d))),
        this.btn('✎ Edit a level file…', 'btn ghost', open(d => this.opts.edit(d)))),
      err);
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
    this.renderer.draw(world, this.time, { things: this.things, barsOpen: false, openGates: new Set() }, this.actors, []);
    world.restore();
    world.fillStyle = 'rgba(26, 18, 32, 0.55)';
    world.fillRect(0, 0, bw, bh);
    screen.imageSmoothingEnabled = false;
    screen.drawImage(buffer, 0, 0, bw * zoom, bh * zoom);
  }
}
