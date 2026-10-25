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

function log(..._args: unknown[]): void {
  // Inspect console noise removed — intentionally no-op.
}

export class PeerConnectionManager {
  pc: RTCPeerConnection | null = null;
  chatChannel: RTCDataChannel | null = null;
  fileChannel: RTCDataChannel | null = null;
  private remoteCandidates: RTCIceCandidateInit[] = [];
  private makingOffer = false;
  private ignoreOffer = false;
  private isInitiator = false;

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
    this.isInitiator = isInitiator;
    if (this.pc || this.chatChannel || this.fileChannel) {
      this.cleanup("create-entering");
    }
    log();
    const pc = new RTCPeerConnection(getRtcConfig());
    this.pc = pc;
    this.remoteCandidates = [];

    // Guard every handler against the pc it belongs to: after a teardown+
    // rebuild the OLD pc still fires close/state events — they must never
    // overwrite the state of the CURRENT connection.
    pc.onicecandidate = (ev) => {
      if (this.pc !== pc) return;
      if (ev.candidate) {
        log("ICE candidate sent");
        if (this.onIceCandidate) this.onIceCandidate(ev.candidate);
      }
    };

    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      log("Peer connection state:", pc.connectionState);
      log(
        "connectionState:",
        pc.connectionState,
        "ice:",
        pc.iceConnectionState,
        "signaling:",
        pc.signalingState,
      );
      if (this.onConnectionState) {
        this.onConnectionState(pc.connectionState);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (this.pc !== pc) return;
      log("ICE connection state:", pc.iceConnectionState);
    };

    pc.onsignalingstatechange = () => {
      if (this.pc !== pc) return;
      log("signalingState:", pc.signalingState);
    };

    pc.ontrack = (ev) => {
      if (this.pc !== pc) return;
      if (this.onTrack) this.onTrack(ev);
    };

    pc.ondatachannel = (ev) => {
      if (this.pc !== pc) return;
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

  async createOffer(options?: { iceRestart?: boolean }): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error("PeerConnection not created");
    if (this.makingOffer || this.pc.signalingState !== "stable") {
      log("Skipping offer creation: makingOffer or signalingState not stable");
      return Promise.reject(new Error("Offer creation skipped (collision or unstable state)"));
    }
    this.makingOffer = true;
    log("Creating offer (perfect negotiation)", options);
    try {
      this.ensureDataChannels(this.isInitiator);
      const offer = await this.pc.createOffer(options);
      await this.pc.setLocalDescription(offer);
      log("Offer sent");
      return offer;
    } finally {
      this.makingOffer = false;
    }
  }

  async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error("PeerConnection not created");
    log("Offer received");
    const offerCollision = this.makingOffer || this.pc.signalingState !== "stable";
    if (offerCollision) {
      // Perfect negotiation: polite peer (non-initiator) rolls back; impolite (initiator) ignores
      if (this.isInitiator) {
        this.ignoreOffer = true;
        log("Impolite peer (initiator): ignoring colliding offer");
      } else {
        log("Polite peer (non-initiator): rolling back for offer collision");
        try {
          await this.pc.setLocalDescription({ type: "rollback" });
        } catch (err) {
          console.warn("Rollback failed", err);
        }
      }
    }
    if (this.ignoreOffer) {
      this.ignoreOffer = false;
      throw new Error("Colliding offer ignored (impolite peer)");
    }
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
    // Ignore stale/duplicate answers arriving when already stable
    if (this.pc.signalingState === "stable") {
      log("Ignoring stale/duplicate answer (already stable)");
      return;
    }
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

  cleanup(_reason = "unknown"): void {
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
    // Reset ALL negotiation state — leftover flags from a dead connection
    // are the top cause of "rejoined but no video".
    this.makingOffer = false;
    this.ignoreOffer = false;
  }
}
