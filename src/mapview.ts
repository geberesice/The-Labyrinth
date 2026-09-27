import { KEY_HUES } from './assets';
import type { Fog } from './fog';
import type { LiveThing } from './game/state';
import { isWall, type Level } from './level';

/**
 * Full top-down map, drawn to look like the original paper maze:
 * white paper, purple marker walls, orange coin dots, blue gem dots.
 * Only explored parts are drawn.
 */
export interface MapMeerkat { x: number; y: number; color: string; me: boolean; name?: string; help?: boolean }

export function drawMapView(ctx: CanvasRenderingContext2D, level: Level, fog: Fog, meerkats: MapMeerkat[],
  w: number, h: number, time: number, things: LiveThing[]) {
  ctx.fillStyle = 'rgba(20, 12, 28, 0.85)';
  ctx.fillRect(0, 0, w, h);

  const cell = Math.floor(Math.min((w - 40) / level.width, (h - 90) / level.height));
  const mw = cell * level.width, mh = cell * level.height;
  const ox = Math.round((w - mw) / 2), oy = Math.round((h - mh) / 2) + 10;

  // paper
  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(-0.006);
  ctx.fillStyle = '#00000055';
  ctx.fillRect(6, 8, mw + 16, mh + 16);
  ctx.fillStyle = '#fbf8f1';
  ctx.fillRect(-8, -8, mw + 16, mh + 16);

  const seen = (x: number, y: number) => fog.explored[y]?.[x];
  const cx = (x: number) => x * cell + cell / 2, cy = (y: number) => y * cell + cell / 2;

  // unexplored: pencil hatching
  ctx.strokeStyle = '#d9d2c3';
  ctx.lineWidth = 1;
  for (let y = 0; y < level.height; y++) for (let x = 0; x < level.width; x++) {
    if (seen(x, y)) continue;
    ctx.beginPath();
    for (let i = -cell; i < cell; i += 5) { ctx.moveTo(x * cell + i, y * cell + cell); ctx.lineTo(x * cell + i + cell, y * cell); }
    ctx.save(); ctx.beginPath(); ctx.rect(x * cell, y * cell, cell, cell); ctx.clip();
    ctx.beginPath();
    for (let i = -cell; i < cell; i += 5) { ctx.moveTo(x * cell + i, y * cell + cell); ctx.lineTo(x * cell + i + cell, y * cell); }
    ctx.stroke(); ctx.restore();
  }

  // red dotted timed zones
  ctx.fillStyle = '#e0443a';
  for (let y = 0; y < level.height; y++) for (let x = 0; x < level.width; x++) {
    if (!level.timed[y][x] || !seen(x, y)) continue;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) ctx.fillRect(x * cell + (i + 0.5) * cell / 3, y * cell + (j + 0.5) * cell / 3, 1.5, 1.5);
  }

  // purple marker walls: connect wall cells with thick round lines
  ctx.strokeStyle = '#6a3fb5';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, cell * 0.28);
  ctx.beginPath();
  for (let y = 0; y < level.height; y++) for (let x = 0; x < level.width; x++) {
    if (!isWall(level, x, y) || !seen(x, y)) continue;
    let linked = false;
    if (x + 1 < level.width && isWall(level, x + 1, y) && seen(x + 1, y)) { ctx.moveTo(cx(x), cy(y)); ctx.lineTo(cx(x + 1), cy(y)); linked = true; }
    if (y + 1 < level.height && isWall(level, x, y + 1) && seen(x, y + 1)) { ctx.moveTo(cx(x), cy(y)); ctx.lineTo(cx(x), cy(y + 1)); linked = true; }
    if (!linked) { ctx.moveTo(cx(x), cy(y)); ctx.lineTo(cx(x) + 0.1, cy(y)); }
  }
  ctx.stroke();

  const dot = (x: number, y: number, r: number, color: string) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx(x), cy(y), r, 0, Math.PI * 2); ctx.fill();
  };
  const label = (text: string, x: number, y: number, color = '#6a3fb5') => {
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.round(cell * 0.7)}px "Comic Sans MS", "Chalkboard SE", cursive`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cx(x), cy(y));
  };

  for (const th of things) {
    if (th.gone || !seen(th.x, th.y)) continue;
    switch (th.kind) {
      case 'coin': dot(th.x, th.y, cell * 0.2, '#f39a2b'); break;
      case 'gem': dot(th.x, th.y, cell * 0.22, '#1a78c2'); break;
      case 'star': label('★', th.x, th.y, '#e8433a'); break;
      case 'key': label('⚷', th.x, th.y, `hsl(${KEY_HUES[th.color]}, 80%, 45%)`); break;
      case 'gate':
        ctx.fillStyle = `hsl(${KEY_HUES[th.color]}, 80%, 45%)`;
        ctx.fillRect(th.x * cell + cell * 0.15, th.y * cell + cell * 0.35, cell * 0.7, cell * 0.3);
        break;
      case 'crate':
        ctx.fillStyle = '#222';
        ctx.fillRect(th.x * cell + cell * 0.15, th.y * cell + cell * 0.35, cell * 0.7, cell * 0.3);
        break;
      case 'bars':
        ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
        for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(th.x * cell + i * cell / 4, th.y * cell + 2); ctx.lineTo(th.x * cell + i * cell / 4, th.y * cell + cell - 2); ctx.stroke(); }
        break;
      case 'exit': label('EXIT', th.x, th.y, '#1d7a3a'); break;
    }
  }
  for (const n of level.npcs) if (seen(n.x, n.y)) label(n.variant === 'spiky' ? '☼' : '☺', n.x, n.y, '#6a3fb5');
  if (seen(level.start.x, level.start.y)) label('S', level.start.x, level.start.y);

  // all meerkats; "you are here" pulses; jailed friends shout HELP
  const pulse = 1 + Math.sin(time * 6) * 0.2;
  for (const m of [...meerkats].sort((a, b) => Number(a.me) - Number(b.me))) {
    ctx.fillStyle = m.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = m.me ? 3 : 2;
    ctx.beginPath(); ctx.arc(cx(m.x), cy(m.y), cell * (m.me ? 0.34 * pulse : 0.28), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (m.help || (!m.me && m.name)) {
      ctx.font = `bold ${Math.max(10, Math.round(cell * 0.45))}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = m.help ? (Math.floor(time * 3) % 2 ? '#e8433a' : '#8a1a12') : '#3a2a55';
      ctx.fillText(m.help ? 'HELP!' : m.name!, cx(m.x), cy(m.y) - cell * 0.4);
    }
  }
  ctx.restore();

  ctx.fillStyle = '#fff4d6';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('MAP  -  press M to go back', w / 2, oy - 18);
}
