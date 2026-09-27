import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useSocket } from "../hooks/useSocket";
import { useMediaStream } from "../hooks/useMediaStream";
import { useWebRTC } from "../hooks/useWebRTC";
import { useWatchTogether } from "../hooks/useWatchTogether";
import { CommunicationLayout } from "../components/communication/CommunicationLayout";
import { VideoPanel } from "../components/communication/VideoPanel";
import { VideoControls } from "../components/communication/VideoControls";
import { WatchTogetherPanel } from "../components/communication/WatchTogetherPanel";
import { ChatPanel } from "../components/communication/ChatPanel";
import { MessageInput } from "../components/communication/MessageInput";
import { FileTransferCard } from "../components/communication/FileTransferCard";
import { supportsWebRTC, type ConnectionState } from "../types/webrtc";
import type {
  PeerJoinedEvent,
  SessionErrorEvent,
  SessionJoinedEvent,
} from "../types/signaling";

export function Communication() {
  const { sessionId: rawId } = useParams<{ sessionId: string }>();
  const sessionId = (rawId ?? "").toUpperCase();
  const location = useLocation();
  const navigate = useNavigate();
  const socket = useSocket();
  const media = useMediaStream();

  // Get name from router state (passed from Landing page)
  const locationName = ((location.state as { name?: string } | null)?.name ?? "").trim();
  const locationInitiator = Boolean(
    (location.state as { isInitiator?: boolean } | null)?.isInitiator,
  );
  // Authoritative role comes from signaling (survives refresh / direct URL open).
  // location.state is only a fallback for the instant after create.
  const [serverInitiator, setServerInitiator] = useState<boolean | null>(null);
  const effectiveInitiator = serverInitiator ?? locationInitiator;
  const initiatorRef = useRef(effectiveInitiator);
  initiatorRef.current = effectiveInitiator;

  const [sessionError, setSessionError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [localName, setLocalName] = useState(locationName);
  const [peerName, setPeerName] = useState<string>("");
  const [isLocalMain, setIsLocalMain] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);

  const peer = useWebRTC({
    socket,
    sessionId,
    isInitiator: effectiveInitiator,
    localName,
    peerName,
  });

  const watch = useWatchTogether({
    socket,
    sessionId,
    localPeerId: socket.id ?? "",
    peerName,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendOfferRef = useRef(peer.sendOffer);
  sendOfferRef.current = peer.sendOffer;

  const swapVideos = useCallback(() => {
    setIsLocalMain((prev) => !prev);
  }, []);

  const handleSwitchCamera = useCallback(async () => {
    await media.switchCamera();
    if (media.stream) {
      const videoTrack = media.stream.getVideoTracks()[0];
      if (videoTrack) {
        await peer.replaceVideoTrack(videoTrack);
      }
    }
  }, [media, peer]);

  const handleWatchTogether = useCallback(() => {
    watch.togglePanel();
  }, [watch]);

  // Join signaling session + wire initiator offer triggers
  useEffect(() => {
    if (!sessionId) return;

    const onJoined = (payload: SessionJoinedEvent) => {
      if (payload.sessionId !== sessionId) return;
      setJoined(true);
      setSessionError(null);
      if (typeof payload.initiator === "boolean") {
        setServerInitiator(payload.initiator);
      }
      if (payload.name) setLocalName(payload.name);
      if (payload.peerName) setPeerName(payload.peerName);
      const effective = payload.initiator ?? initiatorRef.current;
      if (payload.peerCount === 2 && effective) {
        setTimeout(() => void sendOfferRef.current(), 400);
      }
    };
    const onPeerJoined = (payload: PeerJoinedEvent) => {
      if (payload.sessionId !== sessionId) return;
      peer.setConnectionState("connecting");
      if (payload.name) setPeerName(payload.name);
      if (initiatorRef.current) {
        setTimeout(() => void sendOfferRef.current(), 400);
      }
    };
    const onSessionError = (payload: SessionErrorEvent) => {
      if (payload.sessionId !== sessionId) return;
      setSessionError(payload.message);
      peer.setConnectionState("failed");
    };
    const onPeerLeft = (payload: { sessionId: string }) => {
      if (payload.sessionId !== sessionId) return;
      peer.setConnectionState("ended");
    };

    socket.on("session-joined", onJoined);
    socket.on("peer-joined", onPeerJoined);
    socket.on("session-error", onSessionError);
    socket.on("peer-left", onPeerLeft);

    socket.emit("join-session", { sessionId, name: localName });

    return () => {
      socket.off("session-joined", onJoined);
      socket.off("peer-joined", onPeerJoined);
      socket.off("session-error", onSessionError);
      socket.off("peer-left", onPeerLeft);
    };
  }, [sessionId, socket, localName]);

  // Offer retry
  useEffect(() => {
    if (!joined || !effectiveInitiator) return;
    if (peer.channelOpen) return;
    const fire = () => {
      void sendOfferRef.current();
    };
    fire();
    const id = window.setInterval(fire, 2500);
    return () => window.clearInterval(id);
  }, [joined, effectiveInitiator, peer.channelOpen, peer.connectionState, sessionId]);

  // Start local media once
  useEffect(() => {
    let cancelled = false;
    void media.start().then((stream) => {
      if (!cancelled && stream) peer.setLocalStream(stream);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // If media stream arrives late, attach to pc
  useEffect(() => {
    if (media.stream) peer.setLocalStream(media.stream);
  }, [media.stream]);

  // Cleanup on unmount / tab close.
  useEffect(() => {
    const handleBeforeUnload = () => {
      socket.emit("leave-session", { sessionId });
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      media.stop();
    };
  }, [sessionId]);

  const handleEnd = useCallback(() => {
    socket.emit("leave-session", { sessionId });
    media.stop();
    peer.managerRef.current?.cleanup("handleEnd");
    peer.setConnectionState("ended");
    navigate("/", { replace: true });
  }, [socket, sessionId, media, peer, navigate]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      for (const file of Array.from(files)) {
        void peer.sendFile(file);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [peer],
  );

  if (!supportsWebRTC()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="max-w-md rounded-2xl border border-border bg-panel p-6 text-center">
          <h2 className="font-display text-lg font-bold">Browser not supported</h2>
          <p className="mt-2 text-sm text-muted">
            This browser does not support required WebRTC features. Please use a recent version
            of Chrome, Edge, Firefox or Safari.
          </p>
          <button
            onClick={() => navigate("/")}
            className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-[#13131B]"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const status: ConnectionState = sessionError
    ? "failed"
    : !joined
      ? "connecting"
      : peer.connectionState;

  const canSwitchCamera = typeof navigator !== "undefined" && navigator.mediaDevices?.getSupportedConstraints?.()?.facingMode === true;

  return (
    <CommunicationLayout
      header={
        <header className="border-b border-border bg-panel">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-3 py-3 sm:px-4">
            <div className="flex items-center gap-2">
              <button
                onClick={handleEnd}
                title="Back"
                className="rounded-lg border border-border bg-panel3 p-2 text-muted hover:text-ink"
              >
                <ArrowLeft size={15} />
              </button>
              <h1 className="font-display text-base font-extrabold">
                P2P <span className="text-primary">Connect</span>
              </h1>
              <span className="hidden rounded-md bg-panel3 px-2 py-1 font-mono text-[11px] tracking-widest text-muted sm:inline">
                {sessionId}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {joined && peerName && (
                <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-panel3 px-3 py-1 text-xs font-medium text-muted">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  {peerName}
                </span>
              )}
              <StatusPill status={status} channelOpen={peer.channelOpen} />
            </div>
          </div>
          {sessionError && (
            <p className="mx-auto w-full max-w-7xl px-4 pb-2 text-sm text-red-300">{sessionError}</p>
          )}
          {peer.error && (
            <p className="mx-auto w-full max-w-7xl px-4 pb-2 text-sm text-amber-300">{peer.error}</p>
          )}
        </header>
      }
      video={
        <>
          <VideoPanel
            localStream={media.stream}
            remoteStream={peer.remoteStream}
            cameraOn={media.cameraOn}
            localName={localName}
            onSwapVideos={swapVideos}
          />
          <WatchTogetherPanel
            watchState={watch.watchState}
            playerReady={watch.playerReady}
            error={watch.error}
            isPanelOpen={watch.isPanelOpen}
            isMinimized={watch.isMinimized}
            panelPosition={watch.panelPosition}
            playerContainerRef={watch.playerContainerRef}
            onLoadVideo={watch.loadVideo}
            onPlay={watch.playVideo}
            onPause={watch.pauseVideo}
            onSeek={watch.seekVideo}
            onAddToPlaylist={watch.addToPlaylist}
            onRemoveFromPlaylist={watch.removeFromPlaylist}
            onPlayPlaylistItem={watch.playPlaylistItem}
            onMinimize={watch.minimizePanel}
            onRestore={watch.restorePanel}
            onClose={watch.closePanel}
            onTogglePlaylist={() => setShowPlaylist((prev) => !prev)}
            showPlaylist={showPlaylist}
            localName={localName}
            peerName={peerName}
          />
        </>
      }
      controls={
        <>
          {media.error && (
            <p className="mx-auto max-w-xl rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-200">
              {media.error}
            </p>
          )}
          <VideoControls
            micOn={media.micOn}
            cameraOn={media.cameraOn}
            onToggleMic={media.toggleMic}
            onToggleCamera={media.toggleCamera}
            onSwitchCamera={handleSwitchCamera}
            onWatchTogether={handleWatchTogether}
            canSwitchCamera={canSwitchCamera && media.cameraOn}
            onShareFile={openFilePicker}
            onEnd={handleEnd}
          />
        </>
      }
      side={
        <>
          <ChatPanel messages={peer.messages} channelOpen={peer.channelOpen} />
          {peer.transfers.length > 0 && (
            <div className="max-h-56 space-y-2 overflow-y-auto border-t border-border p-3">
              {peer.transfers.map((t) => (
                <FileTransferCard key={t.fileId} transfer={t} onCancel={peer.cancelTransfer} />
              ))}
            </div>
          )}
          <MessageInput
            onSend={peer.sendMessage}
            onAttach={openFilePicker}
            disabled={!peer.channelOpen}
          />
          <p className="border-t border-border px-4 py-1.5 font-mono text-[10px] leading-relaxed text-muted/60">
            sock={socket.connected ? "up" : "down"} joined={String(joined)} init=
            {String(effectiveInitiator)} pc={peer.connectionState} chat={peer.chatState} file=
            {peer.fileState} ch={peer.channelOpen ? "open" : "shut"}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
          />
        </>
      }
    />
  );
}

function StatusPill({ status, channelOpen }: { status: ConnectionState; channelOpen: boolean }) {
  const text =
    status === "connected" && channelOpen
      ? "● Connected directly"
      : status === "connected"
        ? "● Connecting chat..."
        : status === "connecting"
          ? "● Connecting to peer..."
          : status === "ended"
            ? "○ Connection ended"
            : status === "failed"
              ? "● Unable to establish a direct connection."
              : "○ Waiting for connection...";
  const color =
    status === "connected" && channelOpen
      ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
      : status === "connecting"
        ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
        : status === "failed"
          ? "text-red-300 border-red-500/30 bg-red-500/10"
          : "text-muted border-border bg-panel3";
  return (
    <span className={`rounded-full border px-3 py-1.5 text-xs font-medium ${color}`}>{text}</span>
  );
}