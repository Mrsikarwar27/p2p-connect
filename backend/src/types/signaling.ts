export interface Session {
  id: string;
  peers: string[];
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
