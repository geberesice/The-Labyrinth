import { loadAssets, type Assets } from './assets';
import { audio } from './audio';
import { Editor } from './editor/editor';
import type { LevelData } from './level-format';
import { CAMPAIGN } from './levels';
import { Menu } from './menu';
import type { GuestSession, HostSession } from './net/session';
import { Play } from './play';

// Screens: menu -> play, menu -> editor -> play-test -> back to editor.

interface Screen {
  update(dt: number): void;
  render(): void;
  dispose(): void;
  /** true while this screen runs the game for other players (hosting online) */
  readonly runsForOthers?: boolean;
}

const ui = document.getElementById('ui') as HTMLElement;

class App {
  private screen: Screen | null = null;
  /** the editor is kept while play-testing so you come back to it unchanged */
  private editor: Editor | null = null;

  constructor(private a: Assets) {
    this.menu();
  }

  /** Close the current screen (and the editor, unless we keep it), then open the next one. */
  private open(make: () => Screen, keepEditor = false) {
    if (this.screen && this.screen !== this.editor) this.screen.dispose();
    if (!keepEditor && this.editor) { this.editor.dispose(); this.editor = null; }
    ui.hidden = keepEditor;
    this.screen = make();
  }

  menu(notice?: string) {
    this.open(() => new Menu(this.a, {
      play: d => this.play(d),
      playCampaign: i => this.playCampaign(i),
      edit: (d, id) => this.edit(d, id),
      host: (session, d, name) => this.online(d, { role: 'host', session, name }),
      joined: (session, d, me) => this.online(d, { role: 'guest', session, me }),
      notice,
    }, ui));
  }

  /** An online game; leaving it (or losing the connection) closes the session and goes back to the menu. */
  private online(d: LevelData, net: { role: 'host'; session: HostSession; name: string } | { role: 'guest'; session: GuestSession; me: number }) {
    const leave = (notice?: string) => { net.session.close(); this.menu(notice); };
    this.open(() => new Play(this.a, d, {
      backLabel: 'LEAVE', onBack: () => leave(), net,
      onDisconnect: reason => leave(reason),
    }));
  }

  /** Level i of the 10; winning offers the next one. */
  playCampaign(i: number) {
    const level = CAMPAIGN[i];
    const hasNext = i + 1 < CAMPAIGN.length;
    this.open(() => new Play(this.a, level.data, {
      backLabel: 'MENU',
      onBack: () => this.menu(),
      campaign: { id: level.id, number: i + 1, total: CAMPAIGN.length, onNext: hasNext ? () => this.playCampaign(i + 1) : undefined },
    }));
  }

  play(d: LevelData, fromEditor = false) {
    this.open(() => new Play(this.a, d, {
      backLabel: fromEditor ? 'EDIT' : 'MENU',
      onBack: () => (fromEditor ? this.backToEditor() : this.menu()),
    }), fromEditor);
  }

  edit(d: LevelData, id?: string) {
    this.open(() => (this.editor = new Editor(this.a, d, id, { onPlay: data => this.play(data, true), onMenu: () => this.menu() }, ui)));
  }

  private backToEditor() {
    this.screen?.dispose();
    ui.hidden = false;
    this.screen = this.editor;
    audio.music('menu');
  }

  update(dt: number) { this.screen?.update(dt); }
  render() { this.screen?.render(); }
  get runsForOthers() { return this.screen?.runsForOthers === true; }
}

async function boot() {
  const assets = await loadAssets();
  const app = new App(assets);
  Object.assign(window, { app, audio }); // handy for testing in the console
  let last = performance.now();
  let lastFrame = last;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    lastFrame = now;
    app.update(dt);
    app.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Browsers stop requestAnimationFrame while the tab or window is hidden. When we host an online
  // game, friends depend on our game loop, so a worker (whose timer keeps going in the background)
  // keeps the game running until the window is visible again.
  try {
    const src = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50);'], { type: 'text/javascript' }));
    const ticker = new Worker(src);
    ticker.onmessage = () => {
      const now = performance.now();
      if (now - lastFrame < 250 || !app.runsForOthers) return; // the normal loop is running
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      app.update(dt);
    };
  } catch { /* no workers: the game only runs while visible */ }
}

boot().catch(err => {
  document.body.innerHTML = `<pre style="color:#fff;padding:1em">Could not start: ${String(err)}</pre>`;
});
