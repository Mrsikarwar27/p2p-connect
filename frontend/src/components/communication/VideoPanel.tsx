import { useCallback, useEffect, useRef, useState } from "react";

interface VideoPanelProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  cameraOn: boolean;
  localName?: string;
  isLocalMain: boolean;
  onSwapVideos: () => void;
  focusMode?: boolean;
  // While screen-sharing, the small PiP shows the local camera instead of
  // the stream it would normally display in this slot.
  pipStream?: MediaStream | null;
  // A shared screen is the main content: letterbox (contain) + label.
  sharedScreen?: boolean;
}

export function VideoPanel({
  localStream,
  remoteStream,
  cameraOn,
  localName,
  isLocalMain,
  onSwapVideos,
  focusMode = false,
  pipStream,
  sharedScreen = false,
}: VideoPanelProps) {
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localWrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Ref callbacks: the <video> elements unmount when the camera turns off and
  // remount when it turns back on. A plain effect keyed on the stream would
  // NOT re-run for the remounted element (same stream object), leaving it
  // without srcObject — so assign here, on every attach (and whenever the
  // callback identity changes because stream/swap changed).
  const mainVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      remoteRef.current = el;
      if (el) {
        el.srcObject = (isLocalMain ? localStream : remoteStream) ?? null;
      }
    },
    [isLocalMain, localStream, remoteStream],
  );

  const previewVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoRef.current = el;
      if (el) {
        el.srcObject = (isLocalMain ? remoteStream : localStream) ?? null;
      }
    },
    [isLocalMain, localStream, remoteStream],
  );

  // While the local user shares their screen, both visible slots carry local
  // content (screen main, camera PiP). The remote stream must keep exactly
  // one playing element in EVERY state or its audio goes silent — this
  // hidden sink takes over for the duration of the share (same-commit swap,
  // no gap), and hands back to the visible element on stop.
  const remoteSinkRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && remoteStream) {
        el.srcObject = remoteStream;
      }
    },
    [remoteStream],
  );
  const remoteOrphaned = pipStream !== undefined;

  // Floating self-view tile (only while the local user shares their screen).
  // The camera track stays alive the whole time — this tile is preview-only.
  const TILE_W = 120;
  const TILE_H = 160;
  const [shareTilePos, setShareTilePos] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingShareTile, setIsDraggingShareTile] = useState(false);
  const shareTileRef = useRef<HTMLDivElement | null>(null);
  const shareTileDragOffsetRef = useRef({ dx: 0, dy: 0 });
  const shareTileInitRef = useRef(false);

  const shareTileVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && pipStream) {
        el.srcObject = pipStream;
      }
    },
    [pipStream],
  );

  // Default position: bottom-right, fully inside the video area with a
  // margin; in focus mode sit above the auto-hide control bar.
  useEffect(() => {
    if (remoteOrphaned) {
      if (!shareTileInitRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setShareTilePos({
          x: Math.max(8, rect.width - TILE_W - 16),
          y: Math.max(8, rect.height - TILE_H - (focusMode ? 120 : 40)),
        });
        shareTileInitRef.current = true;
      }
    } else {
      shareTileInitRef.current = false;
      setShareTilePos(null);
    }
  }, [remoteOrphaned, focusMode]);

  const handleShareTilePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || !shareTilePos) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = container.getBoundingClientRect();
      shareTileDragOffsetRef.current = {
        dx: e.clientX - rect.left - shareTilePos.x,
        dy: e.clientY - rect.top - shareTilePos.y,
      };
      setIsDraggingShareTile(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [shareTilePos],
  );

  useEffect(() => {
    if (!isDraggingShareTile) return;
    const move = (e: PointerEvent) => {
      const container = containerRef.current;
      const tile = shareTileRef.current;
      if (!container || !tile) return;
      const rect = container.getBoundingClientRect();
      const { dx, dy } = shareTileDragOffsetRef.current;
      // Clamp with the tile's FULL rendered size (box + label) so no part
      // of it can ever leave the video area.
      const tw = tile.offsetWidth || TILE_W;
      const th = tile.offsetHeight || TILE_H;
      const x = Math.min(Math.max(0, e.clientX - rect.left - dx), Math.max(0, rect.width - tw));
      const y = Math.min(Math.max(0, e.clientY - rect.top - dy), Math.max(0, rect.height - th));
      setShareTilePos({ x, y });
    };
    const up = () => {
      setIsDraggingShareTile(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [isDraggingShareTile]);

  const shareTileLive = !!(
    pipStream &&
    pipStream.getVideoTracks().some((t) => t.readyState === "live" && t.enabled) &&
    cameraOn
  );
  const [localPos, setLocalPos] = useState({ x: 16, y: 16 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const animationFrameRef = useRef<number | null>(null);
  const pendingPosRef = useRef({ x: 16, y: 16 });

  const mainVideoStream = isLocalMain ? localStream : remoteStream;
  const previewVideoStream = pipStream !== undefined ? pipStream : isLocalMain ? remoteStream : localStream;
  // Muted rule stays: local content is always muted, remote stays unmuted.
  const previewIsLocalContent = pipStream !== undefined || !isLocalMain;
  const mainVideoEnabled = isLocalMain
    ? (localStream && localStream.getVideoTracks().some((t) => t.readyState === "live") && (remoteOrphaned || cameraOn))
    : (remoteStream && remoteStream.getVideoTracks().some((t) => t.readyState === "live"));
  const previewVideoEnabled =
    pipStream !== undefined
      ? (pipStream && pipStream.getVideoTracks().some((t) => t.readyState === "live") && cameraOn)
      : isLocalMain
        ? (remoteStream && remoteStream.getVideoTracks().some((t) => t.readyState === "live"))
        : (localStream && localStream.getVideoTracks().some((t) => t.readyState === "live") && cameraOn);
  const previewCameraOn =
    pipStream !== undefined
      ? cameraOn
      : isLocalMain
        ? (remoteStream && remoteStream.getVideoTracks().some((t) => t.readyState === "live"))
        : cameraOn;

  const hasRemoteVideo = remoteStream && remoteStream.getVideoTracks().some((t) => t.readyState === "live");
  const hasLocalVideo = localStream && localStream.getVideoTracks().some((t) => t.readyState === "live");
  const localVideoEnabled = hasLocalVideo && cameraOn;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!containerRef.current || !localWrapperRef.current) return;
      e.preventDefault();
      const containerRect = containerRef.current.getBoundingClientRect();
      const localRect = localWrapperRef.current.getBoundingClientRect();
      dragOffset.current = {
        x: e.clientX - localRect.left,
        y: e.clientY - localRect.top,
      };
      setIsDragging(true);
      // Capture pointer for smooth dragging
      localWrapperRef.current?.setPointerCapture?.(e.pointerId);
    },
    [],
  );

  const updatePosition = useCallback(() => {
    if (!isDragging || !containerRef.current || !localWrapperRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const videoRect = localWrapperRef.current.getBoundingClientRect();
    let x = pendingPosRef.current.x;
    let y = pendingPosRef.current.y;

    // Constrain within container
    const maxX = containerRect.width - videoRect.width;
    const maxY = containerRect.height - videoRect.height;
    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));

    // Apply transform directly to avoid React re-renders
    localWrapperRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    pendingPosRef.current = { x, y };
    setLocalPos({ x, y }); // Keep state in sync for persistence

    animationFrameRef.current = requestAnimationFrame(updatePosition);
  }, [isDragging]);

  useEffect(() => {
    if (!isDragging) return;

    const move = (e: PointerEvent) => {
      if (!containerRef.current || !localWrapperRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const localRect = localWrapperRef.current.getBoundingClientRect();
      let x = e.clientX - containerRect.left - dragOffset.current.x;
      let y = e.clientY - containerRect.top - dragOffset.current.y;
      pendingPosRef.current = { x, y };
    };

    const up = (e: PointerEvent) => {
      setIsDragging(false);
      localWrapperRef.current?.releasePointerCapture?.(e.pointerId);
      // Sync final position to state
      setLocalPos(pendingPosRef.current);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };

    // Start animation loop for smooth 60fps updates
    animationFrameRef.current = requestAnimationFrame(updatePosition);

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isDragging, updatePosition]);

  const handleVideoClick = () => {
    onSwapVideos();
  };

  return (
    <div
      className={
        focusMode
          ? "relative flex h-full min-h-0 w-full flex-1 overflow-hidden rounded-none border-0 bg-black"
          : "relative min-h-[280px] flex-1 overflow-hidden rounded-2xl border border-border bg-black sm:min-h-[360px]"
      }
      ref={containerRef}
    >
      {/* Main video (large) */}
      <div className="absolute inset-0">
        {mainVideoEnabled && mainVideoStream ? (
          <video
            ref={mainVideoRef}
            autoPlay
            playsInline
            muted={isLocalMain}
            className={`absolute inset-0 h-full w-full ${focusMode || sharedScreen ? "object-contain" : "object-cover"}`}
            onClick={handleVideoClick}
          />
        ) : (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted"
            onClick={handleVideoClick}
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-panel3 text-2xl font-bold text-secondary">
              P2P
            </div>
            <p className="text-sm">
              {isLocalMain
                ? localName
                  ? `${localName}'s video`
                  : "Your video"
                : "Waiting for remote video..."}
            </p>
            {isLocalMain && !localVideoEnabled && (
              <p className="text-xs opacity-70">Camera is off</p>
            )}
            {!isLocalMain && !hasRemoteVideo && (
              <p className="text-xs opacity-70">Remote video appears here once the peer shares camera</p>
            )}
          </div>
        )}
      </div>

      {/* Preview video (small, draggable) — hidden while screen sharing;
          the floating "You" tile takes over for the duration of the share. */}
      {!remoteOrphaned && (
      <div
        ref={localWrapperRef}
        style={{ transform: `translate3d(${localPos.x}px, ${localPos.y}px, 0)` }}
        className={`absolute transition-transform duration-150 ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        onPointerDown={handlePointerDown}
        onClick={handleVideoClick}
      >
        <div
          className="overflow-hidden rounded-xl border-2 border-white/20 bg-black shadow-xl"
          style={focusMode ? { width: 96, height: 128 } : { width: 120, height: 160 }}
        >
          {previewVideoEnabled && previewVideoStream ? (
            <video
              ref={previewVideoRef}
              autoPlay
              playsInline
              muted={previewIsLocalContent}
              className={`h-full w-full object-cover ${previewCameraOn ? "" : "hidden"}`}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted">
              {isLocalMain ? "Remote" : "You"} video
            </div>
          )}
          {(!previewVideoEnabled || !previewCameraOn) && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">
              {previewCameraOn ? "Camera off" : "Camera Off"}
            </div>
          )}
        </div>
        <p className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-white/80 whitespace-nowrap">
          {isLocalMain ? (localName ?? "Peer") : "Your Video"}
        </p>
      </div>
      )}

      <p className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/90">
        {isLocalMain ? (remoteOrphaned ? "Your screen (main)" : "Your Video (main)") : "Remote Video (main)"}
      </p>
      {sharedScreen && (
        <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-white/90">
          <span className="h-2 w-2 rounded-full bg-red-400" />
          Screen shared
        </span>
      )}
      {remoteOrphaned && shareTilePos && (
        <div
          ref={shareTileRef}
          style={{ transform: `translate3d(${shareTilePos.x}px, ${shareTilePos.y}px, 0)` }}
          onPointerDown={handleShareTilePointerDown}
          className={`absolute left-0 top-0 z-20 select-none ${
            isDraggingShareTile ? "cursor-grabbing" : "cursor-grab"
          } touch-none`}
        >
          <div
            className="overflow-hidden rounded-xl border-2 border-white/20 bg-black shadow-xl"
            style={{ width: 120, height: 160 }}
          >
            {shareTileLive ? (
              <video
                ref={shareTileVideoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-xs text-muted">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-panel3 text-sm font-bold text-secondary">
                  P2P
                </div>
                <span>Camera Off</span>
              </div>
            )}
          </div>
          <p className="mt-1 text-center text-[10px] text-white/80">You</p>
        </div>
      )}
      {remoteOrphaned && remoteStream && (
        <video ref={remoteSinkRef} autoPlay playsInline className="hidden" />
      )}
    </div>
  );
}