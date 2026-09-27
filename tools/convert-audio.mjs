// Converts the chosen Ninja Adventure sounds (OGG/WAV) to small mono MP3s that every browser plays
// (Safari included). Chromium decodes, lamejs encodes.
// Run: node tools/convert-audio.mjs <path to ninja-adventure folder>
// Needs a Chromium: set CHROME=/path/to/chrome (or install one with npx playwright install chromium).
import fs from 'node:fs';
import { Mp3Encoder } from '@breezystack/lamejs';
import { chromium } from 'playwright-core';

const src = process.argv[2];
if (!src) { console.error('usage: node tools/convert-audio.mjs <ninja-adventure dir>'); process.exit(1); }
const OUT = 'src/assets/sound';

// game name -> [source file, kbps, max seconds]
const PICK = {
  coin: ['sounds/gold-1.ogg', 64, 1.2],
  gem: ['sounds/gold-3.ogg', 64, 1.6],
  key: ['sounds/power-up-2.ogg', 64, 1],
  star: ['sounds/secret-1.wav', 64, 1.3],
  gate: ['sounds/magic-1.ogg', 64, 1.5],
  push: ['sounds/19.ogg', 64, 0.4],
  alert: ['sounds/alert.ogg', 64, 1.2],
  jail: ['sounds/game-over.ogg', 64, 2.4],
  free: ['sounds/succes.ogg', 64, 2.4],
  win: ['sounds/succes-3.ogg', 64, 2.4],
  click: ['sounds/menu-1.ogg', 64, 0.6],
  voice1: ['sounds/voice-1.ogg', 64, 2],
  voice2: ['sounds/voice-2.ogg', 64, 2],
  voice3: ['sounds/voice-3.ogg', 64, 2],
  'music-game': ['musics/theme-2.ogg', 96, 999],
  'music-menu': ['musics/theme-6-short.ogg', 96, 999],
};

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage();
fs.mkdirSync(OUT, { recursive: true });
for (const [name, [file, kbps, maxSec]] of Object.entries(PICK)) {
  const b64 = fs.readFileSync(`${src}/${file}`).toString('base64');
  // decode to mono 44.1 kHz, trimmed; normalise quiet sounds to a similar loudness
  const pcm = await page.evaluate(async ([b64, maxSec]) => {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const tmp = new OfflineAudioContext(1, 1, 44100);
    const buf = await tmp.decodeAudioData(bin.buffer);
    const len = Math.min(buf.length, Math.round(maxSec * 44100));
    const out = new Float32Array(len);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) out[i] += d[i] / buf.numberOfChannels;
    }
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    const gain = peak > 0 ? Math.min(4, 0.9 / peak) : 1;
    // short fade-out so trimmed sounds do not click
    const fade = Math.min(len, 2205);
    return Array.from(out, (v, i) => Math.round(Math.max(-1, Math.min(1, v * gain * (i > len - fade ? (len - i) / fade : 1))) * 32767));
  }, [b64, maxSec]);
  const enc = new Mp3Encoder(1, 44100, kbps);
  const samples = Int16Array.from(pcm);
  const chunks = [];
  for (let i = 0; i < samples.length; i += 1152) chunks.push(enc.encodeBuffer(samples.subarray(i, i + 1152)));
  chunks.push(enc.flush());
  const bytes = Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  fs.writeFileSync(`${OUT}/${name}.mp3`, bytes);
  console.log(name.padEnd(12), `${(bytes.length / 1024).toFixed(0)} KB`, `${(samples.length / 44100).toFixed(1)} s`);
}
await browser.close();
