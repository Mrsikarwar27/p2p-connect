export interface WatchPlaylistItem {
  videoId: string;
  title?: string;
}

export interface WatchState {
  videoId: string | null;
  isPlaying: boolean;
  currentTime: number;
  playlist: WatchPlaylistItem[];
  playlistIndex: number;
  updatedBy: string | null;
  updatedAt: number;
}

export type MemberState = "connected" | "away";

// One reserved seat in a session. The slot survives socket churn: on
// disconnect the socketId is cleared and the slot goes "away" — the
// clientId (or the code itself) lets the same/another socket reclaim it.
export interface SessionSlot {
  clientId: string;
  socketId: string | null;
  name?: string;
  state: MemberState;
  awaySince?: number;
  // Incremented ONLY when the slot's socketId actually changes (refresh,
  // reconnect, takeover). Clients rebuild their peer connection exactly once
  // per new epoch and ignore duplicate/older epochs.
  connectionEpoch: number;
}

export interface Session {
  id: string;
  // Exactly two seats; null = empty.
  slots: (SessionSlot | null)[];
  deleteTimer?: NodeJS.Timeout;
  watchState: WatchState;
  createdAt: number;
}

export type SessionErrorReason = "invalid" | "full";

export interface CreateSessionAck {
  sessionId: string;
}

export interface JoinSessionPayload {
  sessionId: string;
}

export interface SignalPayload {
  sessionId: string;
  offer?: Record<string, unknown>;
  answer?: Record<string, unknown>;
  candidate?: Record<string, unknown>;
  targetId?: string;
}

export interface PeerJoinedPayload {
  sessionId: string;
  peerId: string;
  peerCount: number;
}

export interface PeerLeftPayload {
  sessionId: string;
  peerId: string;
}

export interface SessionErrorPayload {
  sessionId: string;
  reason: SessionErrorReason;
  message: string;
}
