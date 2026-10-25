import { randomInt } from "crypto";
import type { Session, SessionSlot, WatchState, WatchPlaylistItem } from "../types/signaling.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DELETE_GRACE_MS = 5 * 60 * 1000;

function randomSegment(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
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

  create(): Session {
    let id = generateSessionId();
    while (this.sessions.has(id)) {
      id = generateSessionId();
    }
    const session: Session = { id, slots: [null, null], watchState: createDefaultWatchState(), createdAt: Date.now() };
    this.sessions.set(id, session);
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(normalizeSessionId(sessionId));
  }

  // Seat the joiner per the rejoin design, in order:
  //   a. slot with the same clientId  -> returning member (REJOIN), or SAME
  //      when this exact socket re-joins (idempotent — no partner notify)
  //   b. empty slot                   -> NEW JOIN
  //   c. away slot (dead socket)      -> takeover (REJOIN)
  //   d. both slots connected         -> FULL
  assignSlot(session: Session, socketId: string, clientId: string, name?: string): "rejoin" | "new" | "same" | "full" {
    const byClient = session.slots.find((s) => s && s.clientId === clientId);
    if (byClient) {
      if (byClient.socketId === socketId) {
        // Duplicate join from the SAME live socket — idempotent: refresh
        // stored name only, no epoch change, no partner notification.
        if (name) byClient.name = name;
        return "same";
      }
      // Genuine rejoin: new socket for a known member — bump the epoch.
      byClient.socketId = socketId;
      byClient.state = "connected";
      byClient.awaySince = undefined;
      if (name) byClient.name = name;
      byClient.connectionEpoch += 1;
      return "rejoin";
    }
    const emptyIdx = session.slots.findIndex((s) => s === null);
    if (emptyIdx !== -1) {
      session.slots[emptyIdx] = { clientId, socketId, name: name || undefined, state: "connected", connectionEpoch: 1 };
      return "new";
    }
    const away = session.slots.find((s) => s && s.state === "away");
    if (away) {
      // Takeover with the code as the credential: same seat, new epoch.
      away.clientId = clientId;
      away.socketId = socketId;
      away.name = name || away.name;
      away.state = "connected";
      away.awaySince = undefined;
      away.connectionEpoch += 1;
      return "rejoin";
    }
    return "full";
  }

  slotBySocket(session: Session, socketId: string): SessionSlot | null {
    return session.slots.find((s) => s && s.socketId === socketId) ?? null;
  }

  isMember(session: Session, socketId: string): boolean {
    return !!this.slotBySocket(session, socketId);
  }

  // The other OCCUPIED slot (may be away) — the partner.
  partnerOf(session: Session, socketId: string): SessionSlot | null {
    return session.slots.find((s) => s && s.socketId !== socketId) ?? null;
  }

  markAway(session: Session, socketId: string): SessionSlot | null {
    const slot = this.slotBySocket(session, socketId);
    if (!slot) return null;
    slot.socketId = null;
    slot.state = "away";
    slot.awaySince = Date.now();
    return slot;
  }

  removeSlotBySocket(session: Session, socketId: string): boolean {
    const idx = session.slots.findIndex((s) => s && s.socketId === socketId);
    if (idx === -1) return false;
    session.slots[idx] = null;
    return true;
  }

  cancelDeleteTimer(session: Session): void {
    if (session.deleteTimer) {
      clearTimeout(session.deleteTimer);
      session.deleteTimer = undefined;
    }
  }

  // Delete the session after the grace window once nobody is connected
  // (both seats away, or every seat emptied by explicit leaves).
  scheduleDeleteIfIdle(session: Session): void {
    const anyoneConnected = session.slots.some((s) => s && s.socketId);
    if (anyoneConnected) return;
    this.cancelDeleteTimer(session);
    session.deleteTimer = setTimeout(() => {
      this.sessions.delete(session.id);
    }, DELETE_GRACE_MS);
  }

  sessionOfSocket(socketId: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (this.isMember(session, socketId)) return session;
    }
    return undefined;
  }

  setPeerName(sessionId: string, socketId: string, name: string): void {
    const session = this.get(sessionId);
    const slot = session ? this.slotBySocket(session, socketId) : null;
    if (slot) slot.name = name;
  }

  getPeerName(sessionId: string, socketId: string): string | undefined {
    const session = this.get(sessionId);
    const slot = session ? this.slotBySocket(session, socketId) : null;
    return slot?.name;
  }

  getWatchState(sessionId: string): WatchState | undefined {
    return this.get(sessionId)?.watchState;
  }

  setWatchState(sessionId: string, watchState: Partial<WatchState>, updatedBy: string): WatchState | undefined {
    const session = this.get(sessionId);
    if (!session) return undefined;
    session.watchState = { ...session.watchState, ...watchState, updatedBy, updatedAt: Date.now() };
    return session.watchState;
  }

  addToPlaylist(sessionId: string, item: WatchPlaylistItem, socketId: string): WatchPlaylistItem[] | undefined {
    const session = this.get(sessionId);
    if (!session) return undefined;
    session.watchState.playlist.push(item);
    session.watchState.updatedBy = socketId;
    session.watchState.updatedAt = Date.now();
    return session.watchState.playlist;
  }

  removeFromPlaylist(sessionId: string, index: number): WatchPlaylistItem[] | undefined {
    const session = this.get(sessionId);
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
    const session = this.get(sessionId);
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

  size(): number {
    return this.sessions.size;
  }
}
