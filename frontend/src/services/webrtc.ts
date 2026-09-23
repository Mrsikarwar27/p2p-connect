import { getRtcConfig } from "../types/webrtc";

export const CHAT_LABEL = "chat";
export const FILE_LABEL = "file-transfer";
/** Pre-existing single-channel label — kept for interop with older builds. */
export const LEGACY_LABEL = "p2p-data";

export type DataMessageHandler = (ev: MessageEvent) => void;
export type TrackHandler = (ev: RTCTrackEvent) => void;
export type StateHandler = (state: RTCPeerConnectionState) => void;
export type ChannelHandler = (channel: RTCDataChannel) => void;
export type ChannelStateHandler = (label: string, state: RTCDataChannelState) => void;

function log(...args: unknown[]): void {
  console.log("[WebRTC]", ...args);
}

export class PeerConnectionManager {
  pc: RTCPeerConnection | null = null;
  chatChannel: RTCDataChannel | null = null;
  fileChannel: RTCDataChannel | null = null;
  private remoteCandidates: RTCIceCandidateInit[] = [];

  onIceCandidate: ((candidate: RTCIceCandidate) => void) | null = null;
  onConnectionState: StateHandler | null = null;
  onDataChannel: ChannelHandler | null = null;
  onTrack: TrackHandler | null = null;
  onChannelOpen: ((label?: string) => void) | null = null;
  onChannelState: ChannelStateHandler | null = null;

  /** Back-compat: single-channel callers used `dataChannel` (chat). */
  get dataChannel(): RTCDataChannel | null {
    return this.chatChannel;
  }

  set dataChannel(ch: RTCDataChannel | null) {
    this.chatChannel = ch;
  }

  create(isInitiator: boolean): RTCPeerConnection {
    if (this.pc || this.chatChannel || this.fileChannel) {
      console.log("[DEBUG] WEBRTC CLEANUP CALLED", {
        reason: "create-entering (replacing existing PC)",
        connectionState: this.pc?.connectionState ?? null,
        iceConnectionState: this.pc?.iceConnectionState ?? null,
      });
      this.cleanup("create-entering");
    }
    log("Creating RTCPeerConnection", `initiator=${isInitiator}`);
    this.pc = new RTCPeerConnection(getRtcConfig());
    this.remoteCandidates = [];

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        log("ICE candidate sent");
        if (this.onIceCandidate) this.onIceCandidate(ev.candidate);
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      log("Peer connection state:", this.pc.connectionState);
      log(
        "connectionState:",
        this.pc.connectionState,
        "ice:",
        this.pc.iceConnectionState,
        "signaling:",
        this.pc.signalingState,
      );
      if (this.onConnectionState) {
        this.onConnectionState(this.pc.connectionState);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      if (!this.pc) return;
      log("ICE connection state:", this.pc.iceConnectionState);
    };

    this.pc.onsignalingstatechange = () => {
      if (!this.pc) return;
      log("signalingState:", this.pc.signalingState);
    };

    this.pc.ontrack = (ev) => {
      if (this.onTrack) this.onTrack(ev);
    };

    this.pc.ondatachannel = (ev) => {
      const channel = ev.channel;
      const label = channel.label;
      log("Incoming DataChannel:", label);
      channel.binaryType = "arraybuffer";
      if (label === CHAT_LABEL || label === LEGACY_LABEL) {
        this.chatChannel = channel;
      } else if (label === FILE_LABEL) {
        this.fileChannel = channel;
      } else {
        log("Unknown DataChannel label, treating as chat:", label);
        this.chatChannel = channel;
      }
      if (this.onDataChannel) this.onDataChannel(channel);
    };

    if (isInitiator) {
      this.ensureDataChannels(true);
    } else {
      log("Waiting for remote peer");
    }

    return this.pc;
  }

  /**
   * Create chat + file channels if missing. Called at creation for the
   * initiator, and again just-in-time in sendOffer() in case the initiator
   * role was only learned from signaling after the PC was created
   * (router state is lost on refresh / direct navigation).
   */
  ensureDataChannels(isInitiator: boolean): void {
    if (!isInitiator || !this.pc) return;
    if (this.pc.signalingState === "closed") return;
    if (!this.chatChannel) {
      log("Creating chat DataChannel");
      this.chatChannel = this.pc.createDataChannel(CHAT_LABEL, { ordered: true });
      this.chatChannel.binaryType = "arraybuffer";
      if (this.onDataChannel) this.onDataChannel(this.chatChannel);
    }
    if (!this.fileChannel) {
      log("Creating file-transfer DataChannel");
      this.fileChannel = this.pc.createDataChannel(FILE_LABEL, { ordered: true });
      this.fileChannel.binaryType = "arraybuffer";
      if (this.onDataChannel) this.onDataChannel(this.fileChannel);
    }
  }

  addLocalStream(stream: MediaStream): void {
    if (!this.pc) return;
    for (const track of stream.getTracks()) {
      this.pc.addTrack(track, stream);
    }
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error("PeerConnection not created");
    log("Creating offer");
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    log("Offer sent");
    return offer;
  }

  async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error("PeerConnection not created");
    log("Offer received");
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    log("Offer applied");
    await this.flushCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    log("Answer sent");
    return answer;
  }

  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) throw new Error("PeerConnection not created");
    log("Answer received");
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    log("Answer applied");
    await this.flushCandidates();
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) return;
    if (!this.pc.remoteDescription) {
      log("Queuing ICE candidate (no remote description yet)");
      this.remoteCandidates.push(candidate);
      return;
    }
    try {
      log("ICE candidate received");
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn("Failed to add ICE candidate", err);
    }
  }

  private async flushCandidates(): Promise<void> {
    if (!this.pc?.remoteDescription) return;
    const queued = this.remoteCandidates.splice(0);
    for (const c of queued) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.warn("Failed to flush ICE candidate", err);
      }
    }
  }

  sendText(payload: string): void {
    if (!this.chatChannel || this.chatChannel.readyState !== "open") {
      throw new Error("DataChannel is not open");
    }
    this.chatChannel.send(payload);
  }

  sendFilePayload(payload: string | ArrayBuffer): void {
    if (!this.fileChannel || this.fileChannel.readyState !== "open") {
      throw new Error("File channel is not open");
    }
    this.fileChannel.send(payload as string);
  }

  connectionState(): RTCPeerConnectionState | "closed" {
    return this.pc?.connectionState ?? "closed";
  }

  isChannelOpen(): boolean {
    return this.chatChannel?.readyState === "open";
  }

  isFileChannelOpen(): boolean {
    return this.fileChannel?.readyState === "open";
  }

  cleanup(reason = "unknown"): void {
    console.log("[DEBUG] WEBRTC CLEANUP CALLED", {
      reason,
      connectionState: this.pc?.connectionState ?? null,
      iceConnectionState: this.pc?.iceConnectionState ?? null,
    });
    for (const ch of [this.chatChannel, this.fileChannel]) {
      try {
        ch?.close();
      } catch {
        /* noop */
      }
    }
    try {
      this.pc?.close();
    } catch {
      /* noop */
    }
    log("Peer disconnected (cleanup)");
    this.chatChannel = null;
    this.fileChannel = null;
    this.pc = null;
    this.remoteCandidates = [];
  }
}
