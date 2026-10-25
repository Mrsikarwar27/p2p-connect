import { useCallback, useEffect, useRef, useState } from "react";

interface VideoPanelProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  cameraOn: boolean;
  localName?: string;
  isLocalMain: boolean;
  onSwapVideos: () => void;
  focusMode?: boolean;
}

export function VideoPanel({
  localStream,
  remoteStream,
  cameraOn,
  localName,
  isLocalMain,
  onSwapVideos,
  focusMode = false,
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
  const [localPos, setLocalPos] = useState({ x: 16, y: 16 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const animationFrameRef = useRef<number | null>(null);
  const pendingPosRef = useRef({ x: 16, y: 16 });

  const mainVideoStream = isLocalMain ? localStream : remoteStream;
  const mainVideoEnabled = isLocalMain
    ? (localStream && localStream.getVideoTracks().some((t) => t.readyState === "live") && cameraOn)
    : (remoteStream && remoteStream.getVideoTracks().some((t) => t.readyState === "live"));
  const previewVideoStream = isLocalMain ? remoteStream : localStream;
  const previewVideoEnabled = isLocalMain
    ? (remoteStream && remoteStream.getVideoTracks().some((t) => t.readyState === "live"))
    : (localStream && localStream.getVideoTracks().some((t) => t.readyState === "live") && cameraOn);
  const previewCameraOn = isLocalMain ? (remoteStream && remoteStream.getVideoTracks().some((t) => t.readyState === "live")) : cameraOn;

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
            className={`absolute inset-0 h-full w-full ${focusMode ? "object-contain" : "object-cover"}`}
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

      {/* Preview video (small, draggable) */}
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
              muted={!isLocalMain}
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

      <p className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/90">
        {isLocalMain ? "Your Video (main)" : "Remote Video (main)"}
      </p>
    </div>
  );
}