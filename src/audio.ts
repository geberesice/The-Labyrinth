// Sound effects and music (Web Audio). Browsers only allow sound after the player clicks or
// presses a key, so everything is silent until then and starts on the first input.
import coinUrl from './assets/sound/coin.mp3';
import gemUrl from './assets/sound/gem.mp3';
import keyUrl from './assets/sound/key.mp3';
import starUrl from './assets/sound/star.mp3';
import gateUrl from './assets/sound/gate.mp3';
import pushUrl from './assets/sound/push.mp3';
import alertUrl from './assets/sound/alert.mp3';
import jailUrl from './assets/sound/jail.mp3';
import freeUrl from './assets/sound/free.mp3';
import winUrl from './assets/sound/win.mp3';
import clickUrl from './assets/sound/click.mp3';
import voice1Url from './assets/sound/voice1.mp3';
import voice2Url from './assets/sound/voice2.mp3';
import voice3Url from './assets/sound/voice3.mp3';
import musicGameUrl from './assets/sound/music-game.mp3';
import musicMenuUrl from './assets/sound/music-menu.mp3';

const SOUNDS = {
  coin: coinUrl, gem: gemUrl, key: keyUrl, star: starUrl, gate: gateUrl, push: pushUrl, alert: alertUrl,
  jail: jailUrl, free: freeUrl, win: winUrl, click: clickUrl, voice1: voice1Url, voice2: voice2Url, voice3: voice3Url,
};
const MUSIC = { game: musicGameUrl, menu: musicMenuUrl };

export type SoundName = keyof typeof SOUNDS;
export type MusicName = keyof typeof MUSIC;

/** all = music and effects, fx = effects only, off = silent */
export type SoundSetting = 'all' | 'fx' | 'off';
const SETTING_KEY = 'meerkat-labyrinth/sound';
const NEXT: Record<SoundSetting, SoundSetting> = { all: 'fx', fx: 'off', off: 'all' };

class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private musicSrc: AudioBufferSourceNode | null = null;
  private wantMusic: MusicName | null = null;
  private playingMusic: MusicName | null = null;
  setting: SoundSetting = 'all';

  constructor() {
    try {
      const s = localStorage.getItem(SETTING_KEY) as SoundSetting | null;
      if (s === 'all' || s === 'fx' || s === 'off') this.setting = s;
    } catch { /* storage blocked: keep the default */ }
    const unlock = () => this.unlock();
    addEventListener('pointerdown', unlock, { capture: true });
    addEventListener('keydown', unlock, { capture: true });
  }

  private unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.master);
      for (const name of Object.keys(SOUNDS)) void this.load(name, SOUNDS[name as SoundName]);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.syncMusic();
  }

  private load(name: string, url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return Promise.resolve(null);
    let p = this.loading.get(name);
    if (!p) {
      const ctx = this.ctx;
      p = fetch(url)
        .then(r => r.arrayBuffer())
        .then(b => new Promise<AudioBuffer>((res, rej) => ctx.decodeAudioData(b, res, rej)))
        .then(buf => { this.buffers.set(name, buf); return buf; })
        .catch(() => null);
      this.loading.set(name, p);
    }
    return p;
  }

  /** Play an effect. `rate` changes the pitch (1 = normal). */
  play(name: SoundName, volume = 0.6, rate = 1) {
    if (!this.ctx || this.setting === 'off') return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master);
    src.start();
  }

  /** A short beep (for countdowns). Higher `pitch` = more urgent. */
  beep(pitch = 1, volume = 0.18) {
    if (!this.ctx || this.setting === 'off') return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = 520 * pitch;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.13);
  }

  /** Meerkat chatter: a random voice clip at a squeaky pitch. */
  chatter() {
    const n = (['voice1', 'voice2', 'voice3'] as const)[Math.floor(Math.random() * 3)];
    this.play(n, 0.5, 1.25 + Math.random() * 0.3);
  }

  music(name: MusicName | null) {
    this.wantMusic = name;
    this.syncMusic();
  }

  private syncMusic() {
    if (!this.ctx) return;
    const want = this.setting === 'all' ? this.wantMusic : null;
    if (want === this.playingMusic) return;
    this.playingMusic = want;
    if (this.musicSrc) {
      const old = this.musicSrc, t = this.ctx.currentTime;
      const g = this.musicGain;
      g.gain.setTargetAtTime(0, t, 0.15);
      old.stop(t + 0.6);
      this.musicSrc = null;
    }
    if (!want) return;
    void this.load(want, MUSIC[want]).then(buf => {
      if (!buf || !this.ctx || this.playingMusic !== want) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      // mp3 files have a little silence at both ends; skip it so the loop is smooth
      src.loopStart = 0.03;
      src.loopEnd = buf.duration - 0.03;
      const t = this.ctx.currentTime + 0.05;
      this.musicGain.gain.cancelScheduledValues(t);
      this.musicGain.gain.setValueAtTime(0.35, t);
      src.connect(this.musicGain);
      src.start(t, 0.03);
      this.musicSrc = src;
    });
  }

  /** Cycle all -> effects only -> off. */
  toggle(): SoundSetting {
    this.setting = NEXT[this.setting];
    try { localStorage.setItem(SETTING_KEY, this.setting); } catch { /* not saved, fine */ }
    this.syncMusic();
    return this.setting;
  }

  get label(): string {
    return this.setting === 'all' ? 'SOUND ON' : this.setting === 'fx' ? 'MUSIC OFF' : 'MUTED';
  }
}

export const audio = new Audio();
