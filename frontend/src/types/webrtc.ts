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
  const turnUrlRaw = import.meta.env.VITE_TURN_URL as string | undefined;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;
  const iceServers: RTCIceServer[] = stun
    ? [{ urls: stun }]
    : [{ urls: "stun:stun.l.google.com:19302" }];
  if (turnUrlRaw && turnUrlRaw.trim() !== "") {
    const turnUrls = turnUrlRaw.split(",").map((u) => u.trim()).filter(Boolean);
    if (turnUrls.length > 0) {
      for (const url of turnUrls) {
        iceServers.push({
          urls: url,
          username: turnUsername || undefined,
          credential: turnCredential || undefined,
        });
      }
    }
  }
  return { iceServers };
}

export function supportsWebRTC(): boolean {
  return typeof RTCPeerConnection !== "undefined";
}
