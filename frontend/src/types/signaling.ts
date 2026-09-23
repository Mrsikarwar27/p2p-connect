export interface SessionCreatedEvent {
  sessionId: string;
}

export interface SessionJoinedEvent {
  sessionId: string;
  peerId: string;
  peerCount: number;
  initiator: boolean;
}

export interface PeerJoinedEvent {
  sessionId: string;
  peerId: string;
  peerCount: number;
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
