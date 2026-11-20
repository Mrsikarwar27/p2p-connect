export interface SessionCreatedEvent {
  sessionId: string;
}

// ---- Optional accounts: presence + direct (no-code) calls ----

export interface OnlineUser {
  userId: string;
  name: string;
  username: string;
  busy: boolean;
}

export interface IncomingCallRequestEvent {
  requestId: string;
  callerUserId: string;
  name: string;
  username: string;
}

export interface CallRequestSentEvent {
  requestId: string;
  targetUserId: string;
  name: string;
}

export interface CallRequestDeclinedEvent {
  requestId: string;
  name: string;
}

export interface CallRequestTimeoutEvent {
  requestId: string;
  peerName?: string;
}

export interface CallRequestCancelledEvent {
  requestId: string;
  reason?: "cancelled" | "accepted" | "disconnected";
}

export interface CallRequestErrorEvent {
  reason: string;
  message: string;
}

export interface CallStartedEvent {
  sessionId: string;
  role: "initiator" | "joiner";
  peerUserId: string;
  peerName: string;
}

export interface SessionJoinedEvent {
  sessionId: string;
  peerId: string;
  peerCount: number;
  initiator: boolean;
  name: string;
  peerName?: string;
  /** Other seat: "connected" | "away" | "none" */
  partnerState?: "connected" | "away" | "none";
  /** My seat's connection epoch — rebuild exactly once per new value. */
  epoch?: number;
}

export interface PeerJoinedEvent {
  sessionId: string;
  peerId: string;
  peerCount: number;
  name?: string;
}

export interface SessionRoleEvent {
  sessionId: string;
  initiator: boolean;
}

/** Partner's socket dropped unexpectedly — their seat is held. */
export interface PeerAwayEvent {
  sessionId: string;
  peerId: string;
  name?: string;
}

/** Partner reclaimed their seat (refresh / reconnect / new tab, same code). */
export interface PeerRejoinedEvent {
  sessionId: string;
  peerId: string;
  name?: string;
  /** Partner seat's new connection epoch — handle exactly once. */
  epoch?: number;
}

export interface WatchSyncEvent {
  sessionId: string;
  action: "load" | "play" | "pause" | "seek" | "state" | "sync" | "playlist-add" | "playlist-remove" | "playlist-play";
  videoId?: string | null;
  currentTime?: number;
  isPlaying?: boolean;
  playlist?: WatchPlaylistItem[];
  playlistIndex?: number;
  from: string;
  timestamp: number;
}

export interface WatchState {
  videoId: string | null;
  isPlaying: boolean;
  currentTime: number;
  playlist: WatchPlaylistItem[];
  playlistIndex: number;
}

export interface WatchPlaylistItem {
  videoId: string;
  title?: string;
}

export interface PeerLeftEvent {
  sessionId: string;
  peerId: string;
}

export interface SessionErrorEvent {
  sessionId: string;
  reason: "invalid" | "full";
  message: string;
}

export interface OfferEvent {
  sessionId: string;
  offer: RTCSessionDescriptionInit;
  from: string;
}

export interface AnswerEvent {
  sessionId: string;
  answer: RTCSessionDescriptionInit;
  from: string;
}

export interface IceEvent {
  sessionId: string;
  candidate: RTCIceCandidateInit;
  from: string;
}
