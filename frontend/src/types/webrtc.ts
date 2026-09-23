export type ConnectionState =
  | "idle"
  | "waiting"
  | "connecting"
  | "connected"
  | "failed"
  | "ended";

export interface RtcConfig {
  iceServers: RTCIceServer[];
}

export function getRtcConfig(): RTCConfiguration {
  const stun = import.meta.env.VITE_STUN_SERVER as string | undefined;
  const iceServers: RTCIceServer[] = stun
    ? [{ urls: stun }]
    : [{ urls: "stun:stun.l.google.com:19302" }];
  return { iceServers };
}

export function supportsWebRTC(): boolean {
  return typeof RTCPeerConnection !== "undefined";
}
