import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Minimize, MessageCircle } from "lucide-react";
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
  SessionRoleEvent,
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
  // Focus mode: pure layout state — never touches media/peer/senders.
  const [focusMode, setFocusMode] = useState(false);
  const [focusControlsVisible, setFocusControlsVisible] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const sessionRootRef = useRef<HTMLDivElement>(null);
  // Screen sharing
  const canScreenShare =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
  const [isSharing, setIsSharing] = useState(false);
  const [remoteSharing, setRemoteSharing] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const savedCameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const savedMicTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioReplacedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sharingActiveRef = useRef(false);

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
    const newTrack = await media.switchCamera();
    if (newTrack) {
      await peer.replaceVideoTrack(newTrack);
    }
  }, [media, peer]);

  // ---- Screen sharing (no renegotiation: sender.replaceTrack only) ----

  const stopScreenShare = useCallback(async () => {
    if (!sharingActiveRef.current) return; // idempotent
    sharingActiveRef.current = false;
    // Restore the saved camera track (kept alive during sharing). If the
    // camera was off before sharing, the same disabled track comes back.
    const cam = savedCameraTrackRef.current;
    await peer.replaceVideoTrack(cam && cam.readyState === "live" ? cam : null);
    if (audioReplacedRef.current) {
      const mic = savedMicTrackRef.current;
      await peer.replaceAudioTrack(mic && mic.readyState === "live" ? mic : null);
      audioReplacedRef.current = false;
    }
    if (audioCtxRef.current) {
      await audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    screenStreamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* noop */
      }
    });
    screenStreamRef.current = null;
    savedCameraTrackRef.current = null;
    savedMicTrackRef.current = null;
    setIsSharing(false);
    socket.emit("screen-share-state", { sessionId, active: false });
  }, [peer, socket, sessionId]);
  const stopScreenShareRef = useRef(stopScreenShare);
  stopScreenShareRef.current = stopScreenShare;

  const startScreenShare = useCallback(async () => {
    if (sharingActiveRef.current || !canScreenShare) return;
    setShareNotice(null);
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: true,
      });
    } catch (err) {
      const name = (err as DOMException | null)?.name;
      if (name === "NotAllowedError" || name === "AbortError") {
        setShareNotice("Screen share cancelled.");
      } else {
        setShareNotice("Could not start screen sharing.");
      }
      return; // nothing changed — camera/mic keep running
    }
    const screenVideo = display.getVideoTracks()[0];
    if (!screenVideo) {
      display.getTracks().forEach((t) => t.stop());
      setShareNotice("Could not start screen sharing.");
      return;
    }
    // Save the current tracks first; the camera track is NEVER stopped.
    const camTrack = media.stream?.getVideoTracks().find((t) => t.readyState === "live") ?? null;
    const micTrack = media.stream?.getAudioTracks().find((t) => t.readyState === "live") ?? null;
    const videoOk = await peer.replaceVideoTrack(screenVideo);
    if (!videoOk) {
      display.getTracks().forEach((t) => t.stop());
      setShareNotice("Start your camera before sharing your screen.");
      return;
    }
    savedCameraTrackRef.current = camTrack;
    savedMicTrackRef.current = micTrack;

    // Tab audio: mix mic + screen audio; fall back to screen audio alone;
    // with no screen audio keep the mic untouched (video-only sharing).
    const screenAudio = display.getAudioTracks()[0] ?? null;
    if (screenAudio) {
      let replaced = false;
      if (micTrack) {
        try {
          const ctx = new AudioContext();
          const dest = ctx.createMediaStreamDestination();
          ctx.createMediaStreamSource(new MediaStream([micTrack])).connect(dest);
          ctx.createMediaStreamSource(new MediaStream([screenAudio])).connect(dest);
          const mixed = dest.stream.getAudioTracks()[0];
          replaced = await peer.replaceAudioTrack(mixed);
          if (replaced) {
            audioCtxRef.current = ctx;
          } else {
            await ctx.close().catch(() => {});
          }
        } catch {
          // mixing failed — fall back below
        }
      }
      if (!replaced) {
        await peer.replaceAudioTrack(screenAudio);
      }
      audioReplacedRef.current = true;
    } else {
      setShareNotice(
        "Sharing without tab audio. Share a browser tab and enable 'Share tab audio' to include sound.",
      );
    }

    // Native browser "Stop sharing" bar ends the track → same stop path.
    screenVideo.addEventListener("ended", () => void stopScreenShareRef.current());
    screenStreamRef.current = display;
    sharingActiveRef.current = true;
    setIsSharing(true);
    socket.emit("screen-share-state", { sessionId, active: true });
  }, [canScreenShare, media.stream, peer, socket, sessionId]);

  const handleShareScreen = useCallback(() => {
    if (sharingActiveRef.current) {
      void stopScreenShare();
    } else {
      void startScreenShare();
    }
  }, [startScreenShare, stopScreenShare]);

  const handleWatchTogether = useCallback(() => {
    watch.togglePanel();
  }, [watch]);

  const enterFocus = useCallback(() => {
    setFocusMode(true);
    // Native fullscreen is best-effort — the fixed-viewport layout works alone.
    const req = sessionRootRef.current?.requestFullscreen();
    req?.catch(() => {});
  }, []);

  const exitFocus = useCallback((openChat = false) => {
    setFocusMode(false);
    setUnreadCount(0);
    if (document.fullscreenElement) {
      document.exitFullscreen()?.catch(() => {});
    }
    if (openChat) {
      // Chat sidebar just became visible again — show the latest message.
      window.setTimeout(() => {
        const scroller = document.querySelector<HTMLElement>("aside .overflow-y-auto");
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      }, 60);
    }
  }, []);

  // Native fullscreen exit (browser Esc / F11) must also exit focus mode.
  // One-directional sync — no feedback loop.
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setFocusMode(false);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Esc exits focus mode when the browser isn't handling it via native fullscreen.
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) setFocusMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode]);

  // YouTube-style auto-hide: controls fade (and cursor hides) after 2.5s idle.
  useEffect(() => {
    if (!focusMode) {
      setFocusControlsVisible(true);
      return;
    }
    setFocusControlsVisible(true);
    let timer: number | undefined;
    const bump = () => {
      setFocusControlsVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setFocusControlsVisible(false), 2500);
    };
    bump();
    window.addEventListener("mousemove", bump);
    window.addEventListener("touchstart", bump);
    window.addEventListener("pointerdown", bump);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", bump);
      window.removeEventListener("touchstart", bump);
      window.removeEventListener("pointerdown", bump);
    };
  }, [focusMode]);

  // Hide the cursor together with the controls while idle in focus mode.
  useEffect(() => {
    if (!focusMode) {
      document.body.style.cursor = "";
      return;
    }
    document.body.style.cursor = focusControlsVisible ? "" : "none";
    return () => {
      document.body.style.cursor = "";
    };
  }, [focusMode, focusControlsVisible]);

  // Unread chat badge: count remote messages that arrive during focus mode.
  const remoteMessageCount = peer.messages.filter((m) => m.sender === "remote").length;
  const prevRemoteCountRef = useRef(remoteMessageCount);
  useEffect(() => {
    // Compute the delta BEFORE setState: the functional updater runs later,
    // when prevRemoteCountRef has already been updated — inside the updater
    // the delta would always read 0.
    const delta = remoteMessageCount - prevRemoteCountRef.current;
    if (focusMode && delta > 0) {
      setUnreadCount((u) => u + delta);
    }
    prevRemoteCountRef.current = remoteMessageCount;
  }, [remoteMessageCount, focusMode]);

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
    const onRoleUpdate = (payload: SessionRoleEvent) => {
      if (payload.sessionId !== sessionId) return;
      // Server promoted us to initiator after the previous one left
      // (e.g. simultaneous reloads) — take over offer duty.
      if (payload.initiator) setServerInitiator(true);
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
    const onScreenShareState = (payload: { sessionId: string; active?: boolean }) => {
      if (payload.sessionId !== sessionId) return;
      setRemoteSharing(Boolean(payload.active));
    };

    socket.on("session-joined", onJoined);
    socket.on("peer-joined", onPeerJoined);
    socket.on("session-role", onRoleUpdate);
    socket.on("session-error", onSessionError);
    socket.on("peer-left", onPeerLeft);
    socket.on("screen-share-state", onScreenShareState);

    socket.emit("join-session", { sessionId, name: localName });

    return () => {
      // No leave-session here: explicit exits (Back/End call) and tab close
      // (beforeunload) already emit it. Cleanup-time emission breaks dev
      // StrictMode remounts with spurious peer-left / role flips.
      socket.off("session-joined", onJoined);
      socket.off("peer-joined", onPeerJoined);
      socket.off("session-role", onRoleUpdate);
      socket.off("session-error", onSessionError);
      socket.off("peer-left", onPeerLeft);
      socket.off("screen-share-state", onScreenShareState);
    };
  }, [sessionId, socket, localName]);

  // Offer retry — only when signaling stable and not yet connected/chat open
  useEffect(() => {
    if (!joined || !effectiveInitiator) return;
    if (peer.channelOpen) return;
    const pc = peer.managerRef.current?.pc;
    if (pc && pc.signalingState !== "stable") return;
    const fire = () => {
      const currentPc = peer.managerRef.current?.pc;
      if (currentPc && currentPc.signalingState !== "stable") return;
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
    void stopScreenShareRef.current();
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

  // Switch button only makes sense with an actual second camera (re-checked
  // on devicechange inside the media hook) — not a facingMode capability guess.
  const canSwitchCamera = media.hasMultipleCameras;

  return (
    <CommunicationLayout
      focusMode={focusMode}
      rootRef={sessionRootRef}
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
            localStream={isSharing ? screenStreamRef.current : media.stream}
            remoteStream={peer.remoteStream}
            cameraOn={media.cameraOn}
            localName={localName}
            isLocalMain={isSharing ? true : isLocalMain}
            onSwapVideos={swapVideos}
            focusMode={focusMode}
            pipStream={isSharing ? media.stream : undefined}
            sharedScreen={isSharing || remoteSharing}
          />
          <div className={focusMode ? "hidden" : ""}>
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
          </div>
          {focusMode && (
            <div
              className={`fixed inset-x-0 bottom-0 z-[90] flex items-end justify-between gap-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] transition-opacity duration-300 ${
                focusControlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <div className="flex-1" />
              <div className="rounded-full border border-border bg-panel/90 px-2 backdrop-blur">
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
                  focusMode
                  hidePanelButtons
                  onToggleFocus={() => exitFocus()}
                  canScreenShare={canScreenShare}
                  isSharingScreen={isSharing}
                  onShareScreen={handleShareScreen}
                  shareScreenDisabled={!peer.channelOpen}
                />
              </div>
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={() => exitFocus(true)}
                  title="Open chat"
                  className="relative flex h-11 w-11 items-center justify-center rounded-full border border-border bg-panel/90 text-ink backdrop-blur transition hover:brightness-125"
                >
                  <MessageCircle size={18} />
                  {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => exitFocus()}
                  title="Exit focus mode"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-panel/90 text-ink backdrop-blur transition hover:brightness-125"
                >
                  <Minimize size={18} />
                </button>
              </div>
            </div>
          )}
        </>
      }
      controls={
        <>
          {media.error && (
            <p className="mx-auto max-w-xl rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-200">
              {media.error}
            </p>
          )}
          {shareNotice && (
            <p className="mx-auto max-w-xl rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-200">
              {shareNotice}
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
            onToggleFocus={enterFocus}
            canScreenShare={canScreenShare}
            isSharingScreen={isSharing}
            onShareScreen={handleShareScreen}
            shareScreenDisabled={!peer.channelOpen}
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
          {import.meta.env.DEV && (
            <p className="border-t border-border px-4 py-1.5 font-mono text-[10px] leading-relaxed text-muted/60">
              sock={socket.connected ? "up" : "down"} joined={String(joined)} init=
              {String(effectiveInitiator)} pc={peer.connectionState} chat={peer.chatState} file=
              {peer.fileState} ch={peer.channelOpen ? "open" : "shut"}
            </p>
          )}
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