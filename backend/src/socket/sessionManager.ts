import type { Session } from "../types/signaling.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PEERS = 2;

function randomSegment(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
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

  create(): Session {
    let id = generateSessionId();
    while (this.sessions.has(id)) {
      id = generateSessionId();
    }
    const session: Session = { id, peers: [], createdAt: Date.now() };
    this.sessions.set(id, session);
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(normalizeSessionId(sessionId));
  }

  addPeer(sessionId: string, socketId: string): { ok: true; session: Session } | { ok: false; reason: "invalid" | "full" } {
    const id = normalizeSessionId(sessionId);
    const session = this.sessions.get(id);
    if (!session) return { ok: false, reason: "invalid" };
    if (session.peers.includes(socketId)) return { ok: true, session };
    if (session.peers.length >= MAX_PEERS) return { ok: false, reason: "full" };
    session.peers.push(socketId);
    this.socketToSession.set(socketId, id);
    return { ok: true, session };
  }

  removeSocket(socketId: string): Session | undefined {
    const sessionId = this.socketToSession.get(socketId);
    if (!sessionId) return undefined;
    this.socketToSession.delete(socketId);
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    session.peers = session.peers.filter((id) => id !== socketId);
    if (session.peers.length === 0) {
      this.sessions.delete(sessionId);
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
