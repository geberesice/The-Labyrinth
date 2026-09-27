// Playing with friends over the internet. Uses PeerJS (WebRTC): the host's browser and the
// guests' browsers talk directly; a small public "signalling" server only introduces them.
import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { PROTOCOL, type GuestMsg, type HostMsg } from './protocol';

const ID_PREFIX = 'meerkat-labyrinth-';
// no 0/O, 1/I/L: easy to read out loud and type
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SERVER_KEY = 'meerkat-labyrinth/peer-server';

export const MAX_PLAYERS = 4;

export function makeCode(): string {
  let c = '';
  for (let i = 0; i < 6; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return c;
}

/** Tidy up what the player typed: "abc 123" -> "ABC123". */
export function cleanCode(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

/** The server saved in settings (null = the free PeerJS cloud server). */
export function savedPeerServer(): string | null {
  try { return localStorage.getItem(SERVER_KEY); } catch { return null; }
}

export function setPeerServer(server: string | null) {
  try { if (server) localStorage.setItem(SERVER_KEY, server); else localStorage.removeItem(SERVER_KEY); } catch { /* ignore */ }
}

/**
 * Turn "host:port" or "https://host:port/path" into PeerJS options. Without a scheme, the page's
 * own scheme is used (an https page can only talk to an https server).
 */
export function serverOptions(server: string): PeerOptions {
  const text = server.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `${location.protocol === 'https:' ? 'https' : 'http'}://${text}`);
  } catch {
    throw new Error('That does not look like a server address. Try something like my-computer:9000');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The server address must start with http:// or https://');
  return {
    host: url.hostname,
    port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname || '/',
    secure: url.protocol === 'https:',
    debug: 1,
  };
}

/**
 * Which signalling server to use: the free PeerJS cloud by default, or your own,
 * set with ?peer=... in the address or saved in the connection settings.
 */
export function peerOptions(): PeerOptions {
  const server = new URLSearchParams(location.search).get('peer') ?? savedPeerServer();
  if (!server) return { debug: 1 };
  try { return serverOptions(server); } catch { return { debug: 1 }; }
}

/** Try to connect to a server. Resolves null when it works, or a message saying what went wrong. */
export function testPeerServer(server: string | null, timeoutMs = 8000): Promise<string | null> {
  return new Promise(resolve => {
    let opts: PeerOptions;
    try { opts = server ? serverOptions(server) : { debug: 0 }; } catch (e) { resolve((e as Error).message); return; }
    const peer = new Peer({ ...opts, debug: 0 });
    const done = (msg: string | null) => { clearTimeout(timer); peer.destroy(); resolve(msg); };
    const timer = setTimeout(() => done('The server did not answer. Check the address and that it is running.'), timeoutMs);
    peer.on('open', () => done(null));
    peer.on('error', err => done(friendlyError(err)));
  });
}

function friendlyError(err: { type?: string; message?: string }): string {
  switch (err.type) {
    case 'peer-unavailable': return 'No game found with that code. Check the code and that your friend is still hosting.';
    case 'unavailable-id': return 'That game code is already taken. Try hosting again.';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
      return 'Could not reach the meerkat server. Check your internet connection.';
    case 'browser-incompatible': return 'This browser cannot play online. Try the desktop app, Chrome, Edge or Firefox.';
    default: return err.message || 'Something went wrong with the connection.';
  }
}

// ---------------- host ----------------

export interface Guest { peerId: string; conn: DataConnection; name: string; playerId: number | null }

export class HostSession {
  code = '';
  guests = new Map<string, Guest>();
  onReady?: (code: string) => void;
  onError?: (message: string) => void;
  onGuestJoin?: (g: Guest) => void;
  onGuestLeave?: (g: Guest) => void;
  onMessage?: (g: Guest, m: GuestMsg) => void;
  private peer: Peer | null = null;
  private tries = 0;

  start() {
    this.code = makeCode();
    const peer = new Peer(ID_PREFIX + this.code, peerOptions());
    this.peer = peer;
    peer.on('open', () => this.onReady?.(this.code));
    peer.on('error', err => {
      if (err.type === 'unavailable-id' && this.tries++ < 3) { peer.destroy(); this.start(); return; }
      this.onError?.(friendlyError(err));
    });
    peer.on('connection', conn => this.accept(conn));
  }

  private accept(conn: DataConnection) {
    conn.on('open', () => {
      if (this.guests.size >= MAX_PLAYERS - 1) {
        conn.send({ t: 'bye', reason: 'This game is full (4 meerkats).' } satisfies HostMsg);
        setTimeout(() => conn.close(), 500);
        return;
      }
      const guest: Guest = { peerId: conn.peer, conn, name: 'Friend', playerId: null };
      conn.on('data', raw => {
        const m = raw as GuestMsg;
        if (m?.t === 'hello') {
          if (m.v !== PROTOCOL) {
            conn.send({ t: 'bye', reason: 'Your game is a different version. Both players need the newest version.' } satisfies HostMsg);
            return;
          }
          guest.name = String(m.name || 'Friend').slice(0, 16);
          this.guests.set(conn.peer, guest);
          this.onGuestJoin?.(guest);
        } else if (this.guests.has(conn.peer)) {
          this.onMessage?.(guest, m);
        }
      });
      const leave = () => {
        if (this.guests.delete(conn.peer)) this.onGuestLeave?.(guest);
      };
      conn.on('close', leave);
      conn.on('error', leave);
    });
  }

  send(g: Guest, m: HostMsg) {
    if (g.conn.open) g.conn.send(m);
  }

  broadcast(m: HostMsg) {
    for (const g of this.guests.values()) this.send(g, m);
  }

  close() {
    this.broadcast({ t: 'bye', reason: 'The host left the game.' });
    const peer = this.peer;
    this.peer = null;
    setTimeout(() => peer?.destroy(), 300);
  }
}

// ---------------- guest ----------------

export class GuestSession {
  onMessage?: (m: HostMsg) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private closed = false;

  join(code: string, name: string) {
    const peer = new Peer(peerOptions());
    this.peer = peer;
    peer.on('error', err => this.onError?.(friendlyError(err)));
    peer.on('open', () => {
      const conn = peer.connect(ID_PREFIX + cleanCode(code), { reliable: true });
      this.conn = conn;
      conn.on('open', () => conn.send({ t: 'hello', v: PROTOCOL, name } satisfies GuestMsg));
      conn.on('data', raw => this.onMessage?.(raw as HostMsg));
      conn.on('close', () => { if (!this.closed) this.onClose?.(); });
      conn.on('error', () => { if (!this.closed) this.onClose?.(); });
    });
  }

  send(m: GuestMsg) {
    if (this.conn?.open) this.conn.send(m);
  }

  close() {
    this.closed = true;
    this.conn?.close();
    const peer = this.peer;
    this.peer = null;
    setTimeout(() => peer?.destroy(), 300);
  }
}
