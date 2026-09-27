import { loadAssets, type Assets } from './assets';
import { Editor } from './editor/editor';
import { toLevel, type LevelData } from './level-format';
import { Menu } from './menu';
import { Play } from './play';

// Screens: menu -> play, menu -> editor -> play-test -> back to editor.

interface Screen { update(dt: number): void; render(): void; dispose(): void }

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

  menu() {
    this.open(() => new Menu(this.a, { play: d => this.play(d), edit: (d, id) => this.edit(d, id) }, ui));
  }

  play(d: LevelData, fromEditor = false) {
    this.open(() => new Play(this.a, toLevel(d), {
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
  }

  update(dt: number) { this.screen?.update(dt); }
  render() { this.screen?.render(); }
}

async function boot() {
  const assets = await loadAssets();
  const app = new App(assets);
  (window as unknown as { app: App }).app = app; // handy for testing in the console
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    app.update(dt);
    app.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch(err => {
  document.body.innerHTML = `<pre style="color:#fff;padding:1em">Could not start: ${String(err)}</pre>`;
});
