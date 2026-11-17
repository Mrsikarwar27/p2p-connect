import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, MonitorUp } from "lucide-react";
import {
  AUDIO_PRIORITY,
  attachStreamToElement,
  detachStreamFromElement,
} from "../../utils/audioPlayback";

interface VideoPanelProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  // Additional (screen-share) video stream. Kept separate from the camera
  // streams so neither camera is ever replaced or hidden.
  screenStream?: MediaStream | null;
  screenIsLocal?: boolean;
  shareActive?: boolean;
  cameraOn: boolean;
  localName?: string;
  remoteName?: string;
  isLocalMain: boolean;
  onSwapVideos: () => void;
  focusMode?: boolean;
}

type PinTarget = "local" | "remote" | null;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function initials(name?: string) {
  const n = (name ?? "").trim();
  if (!n) return "P2P";
  return n.slice(0, 2).toUpperCase();
}

function CameraPlaceholder({
  name,
  hint,
  compact = false,
}: {
  name: string;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-panel3/70 text-muted">
      <div
        className={`flex items-center justify-center rounded-full bg-panel3 font-bold text-secondary ${
          compact ? "h-9 w-9 text-xs" : "h-14 w-14 text-lg"
        }`}
      >
        {initials(name)}
      </div>
      <span className={compact ? "px-1 text-center text-[10px] leading-tight" : "text-sm"}>
        {name}
      </span>
      {hint && <span className="text-[10px] opacity-70">{hint}</span>}
    </div>
  );
}

export function VideoPanel({
  localStream,
  remoteStream,
  screenStream,
  screenIsLocal = false,
  shareActive = false,
  cameraOn,
  localName,
  remoteName,
  isLocalMain,
  onSwapVideos,
  focusMode = false,
}: VideoPanelProps) {
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const localRef = useRef<HTMLVideoElement | null>(null);
  const screenRef = useRef<HTMLVideoElement | null>(null);
  const pinnedRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const remoteWrapRef = useRef<HTMLDivElement | null>(null);
  const localWrapRef = useRef<HTMLDivElement | null>(null);

  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  // Filmstrip width as a percentage of the stage; remembered for this mount
  // (i.e. the current session only).
  const [stripPct, setStripPct] = useState(26);
  const [stripCollapsed, setStripCollapsed] = useState(false);
  const [mainCamera, setMainCamera] = useState<PinTarget>(null);
  const [dividerDragging, setDividerDragging] = useState(false);

  // A new share always starts on the shared screen, never on a pinned camera.
  useEffect(() => {
    if (!shareActive) setMainCamera(null);
  }, [shareActive]);

  // Measure the stage. Layout only — no media is touched.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ref callbacks (not conditional rendering) own the srcObject assignment.
  // The <video> elements below stay mounted across every layout change, so
  // their streams are never lost. Playback state (muted/volume) is applied by
  // the single-playback registry on EVERY attach, so a re-attached srcObject
  // can never make a local or duplicate element audible.
  const remoteVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el) {
        remoteRef.current = el;
        attachStreamToElement(
          el,
          remoteStream ?? null,
          "remote",
          AUDIO_PRIORITY.remoteCamera,
        );
      } else if (remoteRef.current) {
        detachStreamFromElement(remoteRef.current);
        remoteRef.current = null;
      }
    },
    [remoteStream],
  );

  const localVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el) {
        localRef.current = el;
        // Local playback is always silent — the peer still receives the mic.
        attachStreamToElement(el, localStream ?? null, "local", AUDIO_PRIORITY.local);
      } else if (localRef.current) {
        detachStreamFromElement(localRef.current);
        localRef.current = null;
      }
    },
    [localStream],
  );

  const screenVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el) {
        screenRef.current = el;
        // A local screen preview is silent. A remote screen stream is only a
        // lower-priority audio carrier than the camera tile.
        attachStreamToElement(
          el,
          screenStream ?? null,
          screenIsLocal ? "local" : "remote",
          screenIsLocal ? AUDIO_PRIORITY.local : AUDIO_PRIORITY.remoteScreen,
        );
      } else if (screenRef.current) {
        detachStreamFromElement(screenRef.current);
        screenRef.current = null;
      }
    },
    [screenStream, screenIsLocal],
  );

  const pinnedVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el) {
        pinnedRef.current = el;
        // The pinned stage may carry the same stream as a filmstrip tile —
        // it is a picture only and always loses the audio to the tile.
        attachStreamToElement(
          el,
          mainCamera === "local" ? (localStream ?? null) : (remoteStream ?? null),
          mainCamera === "local" ? "local" : "remote",
          mainCamera === "local" ? AUDIO_PRIORITY.local : AUDIO_PRIORITY.remotePinned,
        );
      } else if (pinnedRef.current) {
        detachStreamFromElement(pinnedRef.current);
        pinnedRef.current = null;
      }
    },
    [mainCamera, localStream, remoteStream],
  );

  // Never leave a detached element registered as an audio owner.
  useEffect(() => {
    return () => {
      for (const el of [
        remoteRef.current,
        localRef.current,
        screenRef.current,
        pinnedRef.current,
      ]) {
        if (el) detachStreamFromElement(el);
      }
    };
  }, []);

  // ---- Derived liveness -------------------------------------------------
  const hasRemoteVideo = !!(
    remoteStream &&
    remoteStream.getVideoTracks().some((t) => t.readyState === "live")
  );
  const hasLocalVideo = !!(
    localStream &&
    localStream.getVideoTracks().some((t) => t.readyState === "live")
  );
  const remoteVideoVisible = hasRemoteVideo;
  const localVideoVisible = hasLocalVideo && cameraOn;

  const remoteLabel = remoteName?.trim() || "Participant";
  const localLabel = localName?.trim() ? `${localName.trim()} (You)` : "You";

  // ---- Share layout geometry -------------------------------------------
  const shareMode = !!shareActive;
  const isWide = containerSize.w === 0 || containerSize.w >= 640;
  const stripVisible = shareMode && !stripCollapsed;
  const dividerW = 10;
  const stripW =
    stripVisible && isWide
      ? Math.round(
          Math.max(0.18, Math.min(0.4, stripPct / 100)) * containerSize.w,
        )
      : 0;
  const narrowStripH =
    stripVisible && !isWide
      ? Math.round(Math.min(150, Math.max(96, (containerSize.h || 400) * 0.24)))
      : 0;
  const mainW =
    stripVisible && isWide
      ? Math.max(0, containerSize.w - stripW - dividerW)
      : containerSize.w;
  const mainH =
    stripVisible && !isWide
      ? Math.max(0, containerSize.h - narrowStripH)
      : containerSize.h;

  let remoteTile: Rect = { x: 0, y: 0, w: 0, h: 0 };
  let localTile: Rect = { x: 0, y: 0, w: 0, h: 0 };
  if (stripVisible) {
    if (isWide) {
      const pad = 8;
      const gap = 8;
      const innerW = Math.max(0, stripW - pad * 2);
      const maxTileH = Math.max(0, (containerSize.h - pad * 2 - gap) / 2);
      const tileW = Math.max(0, Math.min(innerW, (maxTileH * 16) / 9));
      const tileH = (tileW * 9) / 16;
      const x = containerSize.w - stripW + (stripW - tileW) / 2;
      remoteTile = { x, y: pad, w: tileW, h: tileH };
      localTile = { x, y: pad + tileH + gap, w: tileW, h: tileH };
    } else {
      const pad = 6;
      const gap = 8;
      const availH = Math.max(0, narrowStripH - pad * 2);
      const availW = Math.max(0, (containerSize.w - pad * 2 - gap) / 2);
      const tileW = Math.max(0, Math.min(availW, (availH * 16) / 9));
      const tileH = (tileW * 9) / 16;
      const totalW = tileW * 2 + gap;
      const x0 = (containerSize.w - totalW) / 2;
      const y = containerSize.h - narrowStripH + pad + (availH - tileH) / 2;
      remoteTile = { x: x0, y, w: tileW, h: tileH };
      localTile = { x: x0 + tileW + gap, y, w: tileW, h: tileH };
    }
  }

  const mainAreaStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: mainW,
    height: mainH,
    transform: "none",
  };

  const tileStyle = (r: Rect): CSSProperties =>
    stripVisible
      ? {
          position: "absolute",
          left: r.x,
          top: r.y,
          width: r.w,
          height: r.h,
          transform: "none",
        }
      : { position: "absolute", display: "none" };

  // ---- Normal (non-share) layout ---------------------------------------
  const [localPos, setLocalPos] = useState({ x: 16, y: 16 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const animationFrameRef = useRef<number | null>(null);
  const pendingPosRef = useRef({ x: 16, y: 16 });

  const previewW = focusMode ? 96 : 120;
  const previewH = focusMode ? 128 : 160;

  const getPreviewEl = () =>
    isLocalMain ? remoteWrapRef.current : localWrapRef.current;

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      const preview = getPreviewEl();
      if (!container || !preview) return;
      e.preventDefault();
      const localRect = preview.getBoundingClientRect();
      dragOffset.current = {
        x: e.clientX - localRect.left,
        y: e.clientY - localRect.top,
      };
      setIsDragging(true);
      preview.setPointerCapture?.(e.pointerId);
    },
    // getPreviewEl reads refs + isLocalMain
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLocalMain],
  );

  const updatePosition = useCallback(() => {
    if (!isDragging) return;
    const container = containerRef.current;
    const preview = getPreviewEl();
    if (!container || !preview) return;

    const containerRect = container.getBoundingClientRect();
    const videoRect = preview.getBoundingClientRect();
    const maxX = containerRect.width - videoRect.width;
    const maxY = containerRect.height - videoRect.height;
    const x = Math.max(0, Math.min(pendingPosRef.current.x, maxX));
    const y = Math.max(0, Math.min(pendingPosRef.current.y, maxY));

    preview.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    pendingPosRef.current = { x, y };
    setLocalPos({ x, y });
    animationFrameRef.current = requestAnimationFrame(updatePosition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, isLocalMain]);

  useEffect(() => {
    if (!isDragging) return;

    const move = (e: PointerEvent) => {
      if (!containerRef.current) return;
      const preview = getPreviewEl();
      if (!preview) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      pendingPosRef.current = {
        x: e.clientX - containerRect.left - dragOffset.current.x,
        y: e.clientY - containerRect.top - dragOffset.current.y,
      };
    };

    const up = (e: PointerEvent) => {
      setIsDragging(false);
      getPreviewEl()?.releasePointerCapture?.(e.pointerId);
      setLocalPos(pendingPosRef.current);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, updatePosition, isLocalMain]);

  // ---- Filmstrip divider drag ------------------------------------------
  useEffect(() => {
    if (!dividerDragging) return;
    const move = (e: PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0) return;
      const pct = ((r.right - e.clientX) / r.width) * 100;
      setStripPct(Math.max(18, Math.min(40, pct)));
    };
    const up = () => setDividerDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dividerDragging]);

  const handleVideoClick = () => {
    if (shareMode) return;
    onSwapVideos();
  };

  // Normal-mode ordering: one camera is the main stage, the other is the
  // small draggable preview. The exact same wrappers/elements are reused in
  // share mode, only repositioned.
  const remoteIsMain = !isLocalMain;
  const remoteWrapperStyle: CSSProperties = shareMode
    ? tileStyle(remoteTile)
    : remoteIsMain
      ? {
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          transform: "none",
        }
      : {
          position: "absolute",
          left: 0,
          top: 0,
          width: previewW,
          height: previewH,
          transform: `translate3d(${localPos.x}px, ${localPos.y}px, 0)`,
        };
  const localWrapperStyle: CSSProperties = shareMode
    ? tileStyle(localTile)
    : !remoteIsMain
      ? {
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          transform: "none",
        }
      : {
          position: "absolute",
          left: 0,
          top: 0,
          width: previewW,
          height: previewH,
          transform: `translate3d(${localPos.x}px, ${localPos.y}px, 0)`,
        };

  const remoteWrapperClass = shareMode
    ? "z-10 overflow-hidden rounded-xl border border-white/20 bg-black shadow-lg cursor-pointer"
    : remoteIsMain
      ? "z-0 overflow-hidden bg-black cursor-pointer"
      : `z-20 rounded-xl border-2 border-white/20 bg-black shadow-xl ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`;

  const localWrapperClass = shareMode
    ? "z-10 overflow-hidden rounded-xl border border-white/20 bg-black shadow-lg cursor-pointer"
    : !remoteIsMain
      ? "z-0 overflow-hidden bg-black cursor-pointer"
      : `z-20 rounded-xl border-2 border-white/20 bg-black shadow-xl ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`;

  const tileLabelClass =
    "absolute bottom-2 left-2 z-20 max-w-[90%] truncate rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/90";
  const mainLabelClass =
    "absolute left-3 top-3 z-20 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/90";
  const previewLabelClass =
    "absolute -bottom-5 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap text-[10px] text-white/80";

  return (
    <div
      className={
        focusMode
          ? "relative flex h-full min-h-0 w-full flex-1 overflow-hidden rounded-none border-0 bg-black"
          : "relative min-h-[280px] flex-1 overflow-hidden rounded-2xl border border-border bg-black sm:min-h-[360px]"
      }
      ref={containerRef}
    >
      {/* Filmstrip background (behind tiles) */}
      {stripVisible && isWide && (
        <div
          style={{
            position: "absolute",
            left: mainW,
            top: 0,
            width: stripW + dividerW,
            height: containerSize.h,
          }}
          className="z-0 border-l border-border bg-panel2/70"
        />
      )}
      {stripVisible && !isWide && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: mainH,
            width: containerSize.w,
            height: narrowStripH,
          }}
          className="z-0 border-t border-border bg-panel2/70"
        />
      )}

      {/* Shared screen: main stage (new element; cameras below stay mounted) */}
      {shareMode && screenStream && (
        <div
          style={{
            ...mainAreaStyle,
            display: mainCamera ? "none" : "block",
          }}
          className="z-0 overflow-hidden bg-black"
          onClick={() => setMainCamera(null)}
        >
          <video
            ref={screenVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-contain"
          />
          <p className={mainLabelClass}>
            {screenIsLocal
              ? "Your screen (main)"
              : `${remoteName?.trim() || "Peer"}'s screen (main)`}
          </p>
          <span className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-white/90">
            <span className="h-2 w-2 rounded-full bg-red-400" />
            Screen shared
          </span>
        </div>
      )}
      {shareMode && !screenStream && !mainCamera && (
        <div
          style={mainAreaStyle}
          className="z-0 flex items-center justify-center bg-black text-sm text-muted"
        >
          Waiting for shared screen…
        </div>
      )}

      {/* Pinned camera in the main stage (share mode). A separate muted
          element; the two live camera tiles stay mounted in the filmstrip. */}
      {shareMode && mainCamera && (
        <div
          style={mainAreaStyle}
          className="z-10 overflow-hidden bg-black"
          onClick={() => setMainCamera(null)}
        >
          <video
            ref={pinnedVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-contain"
          />
          {mainCamera === "local" && !localVideoVisible && (
            <CameraPlaceholder
              name={localName?.trim() || "You"}
              hint="Camera is off"
            />
          )}
          {mainCamera === "remote" && !remoteVideoVisible && (
            <CameraPlaceholder name={remoteLabel} hint="Camera is off" />
          )}
          <p className={mainLabelClass}>
            {mainCamera === "local"
              ? localName?.trim()
                ? `${localName.trim()}'s video`
                : "Your video"
              : `${remoteLabel}'s video`}
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMainCamera(null);
            }}
            className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1 text-[11px] font-medium text-white/90 transition hover:bg-black"
          >
            <MonitorUp size={13} />
            Back to screen
          </button>
        </div>
      )}

      {/* Remote camera wrapper — ALWAYS mounted */}
      <div
        ref={remoteWrapRef}
        style={remoteWrapperStyle}
        className={remoteWrapperClass}
        onPointerDown={
          !shareMode && remoteIsMain === false ? handlePointerDown : undefined
        }
        onClick={
          shareMode
            ? () =>
                setMainCamera((m) => (m === "remote" ? null : "remote"))
            : handleVideoClick
        }
      >
        {remoteStream && (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`h-full w-full ${
              shareMode
                ? "object-cover"
                : remoteIsMain
                  ? focusMode
                    ? "object-contain"
                    : "object-cover"
                  : "rounded-[10px] object-cover"
            } ${remoteVideoVisible ? "" : "hidden"}`}
          />
        )}
        {!remoteVideoVisible && (
          <CameraPlaceholder
            name={remoteLabel}
            hint={shareMode ? undefined : "Camera is off"}
            compact={shareMode || !remoteIsMain}
          />
        )}
        <span
          className={
            shareMode
              ? tileLabelClass
              : remoteIsMain
                ? mainLabelClass
                : previewLabelClass
          }
        >
          {shareMode
            ? remoteLabel
            : remoteIsMain
              ? "Remote Video (main)"
              : remoteLabel}
        </span>
      </div>

      {/* Local camera wrapper — ALWAYS mounted */}
      <div
        ref={localWrapRef}
        style={localWrapperStyle}
        className={localWrapperClass}
        onPointerDown={!shareMode && remoteIsMain ? handlePointerDown : undefined}
        onClick={
          shareMode
            ? () =>
                setMainCamera((m) => (m === "local" ? null : "local"))
            : handleVideoClick
        }
      >
        {localStream && (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full ${
              shareMode
                ? "object-cover"
                : !remoteIsMain
                  ? focusMode
                    ? "object-contain"
                    : "object-cover"
                  : "rounded-[10px] object-cover"
            } ${localVideoVisible ? "" : "hidden"}`}
          />
        )}
        {!localVideoVisible && (
          <CameraPlaceholder
            name={localName?.trim() || "You"}
            hint={shareMode ? undefined : "Camera is off"}
            compact={shareMode || remoteIsMain}
          />
        )}
        <span
          className={
            shareMode
              ? tileLabelClass
              : !remoteIsMain
                ? mainLabelClass
                : previewLabelClass
          }
        >
          {shareMode
            ? localLabel
            : !remoteIsMain
              ? "Your Video (main)"
              : "Your Video"}
        </span>
      </div>

      {/* Collapse / expand button (CSS-only hide, elements stay mounted) */}
      {shareMode && isWide && !stripCollapsed && (
        <button
          onClick={() => {
            setMainCamera(null);
            setStripCollapsed(true);
          }}
          title="Hide camera strip"
          style={{
            position: "absolute",
            left: Math.max(0, mainW - 14),
            top: 12,
            zIndex: 40,
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-black/70 text-white/90 transition hover:bg-black"
        >
          <ChevronRight size={14} />
        </button>
      )}
      {shareMode && !isWide && !stripCollapsed && (
        <button
          onClick={() => {
            setMainCamera(null);
            setStripCollapsed(true);
          }}
          title="Hide camera strip"
          style={{
            position: "absolute",
            right: 12,
            bottom: narrowStripH + 10,
            zIndex: 40,
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-black/70 text-white/90 transition hover:bg-black"
        >
          <ChevronDown size={14} />
        </button>
      )}
      {shareMode && stripCollapsed && (
        <button
          onClick={() => setStripCollapsed(false)}
          title="Show camera strip"
          style={{ position: "absolute", right: 12, bottom: 12, zIndex: 40 }}
          className="flex items-center gap-1.5 rounded-full border border-border bg-black/70 px-3 py-1.5 text-[11px] font-medium text-white/90 transition hover:bg-black"
        >
          <ChevronLeft size={13} />
          Cameras
        </button>
      )}

      {/* Draggable divider: 18%–40% of the stage width */}
      {shareMode && isWide && !stripCollapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize camera strip"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDividerDragging(true);
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          style={{
            position: "absolute",
            left: mainW,
            top: 0,
            width: dividerW,
            height: containerSize.h,
            zIndex: 35,
          }}
          className={`touch-none select-none ${
            dividerDragging ? "cursor-col-resize" : "cursor-col-resize"
          }`}
        >
          <div className="mx-auto h-full w-[2px] bg-white/15" />
        </div>
      )}
    </div>
  );
}
