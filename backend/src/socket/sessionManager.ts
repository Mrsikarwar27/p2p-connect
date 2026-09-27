import type { Session, WatchState, WatchPlaylistItem } from "../types/signaling.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PEERS = 2;

function randomSegment(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

function createDefaultWatchState(): WatchState {
  return {
    videoId: null,
    isPlaying: false,
    currentTime: 0,
    playlist: [],
    playlistIndex: 0,
    updatedBy: null,
    updatedAt: 0,
  };
}

export function generateSessionId(): string {
  return `${randomSegment(4)}-${randomSegment(4)}`;
}

export function normalizeSessionId(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private socketToSession = new Map<string, string>();
  private cleanupTimers = new Map<string, NodeJS.Timeout>();

  create(): Session {
    let id = generateSessionId();
    while (this.sessions.has(id)) {
      id = generateSessionId();
    }
    const session: Session = { id, peers: [], peerNames: new Map(), watchState: createDefaultWatchState(), createdAt: Date.now() };
    this.sessions.set(id, session);
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(normalizeSessionId(sessionId));
  }

  addPeer(sessionId: string, socketId: string, name?: string): { ok: true; session: Session } | { ok: false; reason: "invalid" | "full" } {
    const id = normalizeSessionId(sessionId);
    if (this.cleanupTimers.has(id)) {
      clearTimeout(this.cleanupTimers.get(id));
      this.cleanupTimers.delete(id);
    }
    const session = this.sessions.get(id);
    if (!session) return { ok: false, reason: "invalid" };
    if (session.peers.includes(socketId)) return { ok: true, session };
    if (session.peers.length >= MAX_PEERS) return { ok: false, reason: "full" };
    session.peers.push(socketId);
    if (name) session.peerNames.set(socketId, name);
    this.socketToSession.set(socketId, id);
    return { ok: true, session };
  }

  setPeerName(sessionId: string, socketId: string, name: string): void {
    const session = this.sessions.get(normalizeSessionId(sessionId));
    if (session) {
      session.peerNames.set(socketId, name);
    }
  }

  getPeerName(sessionId: string, socketId: string): string | undefined {
    const session = this.sessions.get(normalizeSessionId(sessionId));
    return session?.peerNames.get(socketId);
  }

  getWatchState(sessionId: string): WatchState | undefined {
    const session = this.sessions.get(normalizeSessionId(sessionId));
    return session?.watchState;
  }

  setWatchState(sessionId: string, watchState: Partial<WatchState>, updatedBy: string): WatchState | undefined {
    const session = this.sessions.get(normalizeSessionId(sessionId));
    if (!session) return undefined;
    session.watchState = { ...session.watchState, ...watchState, updatedBy, updatedAt: Date.now() };
    return session.watchState;
  }

  addToPlaylist(sessionId: string, item: WatchPlaylistItem, socketId: string): WatchPlaylistItem[] | undefined {
    const session = this.sessions.get(normalizeSessionId(sessionId));
    if (!session) return undefined;
    session.watchState.playlist.push(item);
    session.watchState.updatedBy = socketId;
    session.watchState.updatedAt = Date.now();
    return session.watchState.playlist;
  }

  removeFromPlaylist(sessionId: string, index: number): WatchPlaylistItem[] | undefined {
    const session = this.sessions.get(normalizeSessionId(sessionId));
    if (!session) return undefined;
    if (index >= 0 && index < session.watchState.playlist.length) {
      session.watchState.playlist.splice(index, 1);
      if (session.watchState.playlistIndex >= session.watchState.playlist.length) {
        session.watchState.playlistIndex = Math.max(0, session.watchState.playlist.length - 1);
      }
      session.watchState.updatedAt = Date.now();
    }
    return session.watchState.playlist;
  }

  playPlaylistItem(sessionId: string, index: number, socketId: string): { videoId: string; currentTime: number } | undefined {
    const session = this.sessions.get(normalizeSessionId(sessionId));
    if (!session) return undefined;
    if (index >= 0 && index < session.watchState.playlist.length) {
      session.watchState.playlistIndex = index;
      session.watchState.videoId = session.watchState.playlist[index].videoId;
      session.watchState.currentTime = 0;
      session.watchState.isPlaying = true;
      session.watchState.updatedBy = socketId;
      session.watchState.updatedAt = Date.now();
      return { videoId: session.watchState.videoId, currentTime: 0 };
    }
    return undefined;
  }

  removeSocket(socketId: string): Session | undefined {
    const sessionId = this.socketToSession.get(socketId);
    if (!sessionId) return undefined;
    this.socketToSession.delete(socketId);
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    session.peers = session.peers.filter((id) => id !== socketId);
    if (session.peers.length === 0) {
      if (this.cleanupTimers.has(sessionId)) {
        clearTimeout(this.cleanupTimers.get(sessionId));
      }
      const timer = setTimeout(() => {
        const s = this.sessions.get(sessionId);
        if (s && s.peers.length === 0) {
          this.sessions.delete(sessionId);
        }
        this.cleanupTimers.delete(sessionId);
      }, 30000);
      this.cleanupTimers.set(sessionId, timer);
    }
    return session;
  }

  sessionOfSocket(socketId: string): Session | undefined {
    const id = this.socketToSession.get(socketId);
    if (!id) return undefined;
    return this.sessions.get(id);
  }

  peerOf(session: Session, excludeSocketId: string): string | undefined {
    return session.peers.find((id) => id !== excludeSocketId);
  }

  size(): number {
    return this.sessions.size;
  }
}
