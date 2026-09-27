import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { WatchState, WatchPlaylistItem, WatchSyncEvent } from "../types/signaling";

interface UseWatchTogetherOptions {
  socket: Socket;
  sessionId: string;
  localPeerId: string;
  peerName?: string;
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const existingScript = document.getElementById("youtube-iframe-api");
    if (existingScript) {
      const checkReady = setInterval(() => {
        if (window.YT && window.YT.Player) {
          clearInterval(checkReady);
          resolve();
        }
      }, 100);
      return;
    }
    const script = document.createElement("script");
    script.id = "youtube-iframe-api";
    script.src = "https://www.youtube.com/iframe_api";
    script.onload = () => {
      const checkReady = setInterval(() => {
        if (window.YT && window.YT.Player) {
          clearInterval(checkReady);
          resolve();
        }
      }, 100);
    };
    script.onerror = () => reject(new Error("Failed to load YouTube API"));
    document.head.appendChild(script);
  });
}

const SYNC_INTERVAL = 3000; // 3 seconds for drift correction
const DRIFT_THRESHOLD = 0.5; // 500ms threshold for correction

export function useWatchTogether({ socket, sessionId, localPeerId, peerName }: UseWatchTogetherOptions) {
  const [watchState, setWatchState] = useState<WatchState>({
    videoId: null,
    isPlaying: false,
    currentTime: 0,
    playlist: [],
    playlistIndex: 0,
  });
  const [player, setPlayer] = useState<any>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ x: 16, y: 16 });

  const playerRef = useRef<any>(null);
  const isRemoteUpdateRef = useRef(false);
  const syncTimerRef = useRef<number | null>(null);
  const lastSyncRef = useRef(0);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const pendingLoadRef = useRef<string | null>(null);

  const sendSync = useCallback(
    (action: WatchSyncEvent["action"], data: Partial<WatchSyncEvent> = {}) => {
      if (!socket.connected) return;
      socket.emit("watch:sync", {
        sessionId,
        action,
        senderId: localPeerId,
        timestamp: Date.now(),
        ...data,
      });
    },
    [socket, sessionId, localPeerId],
  );

  // Periodic sync for drift correction
  const startPeriodicSync = useCallback(() => {
    if (syncTimerRef.current) return;
    syncTimerRef.current = window.setInterval(() => {
      if (!playerRef.current || !playerReady || isRemoteUpdateRef.current) return;
      const currentTime = playerRef.current.getCurrentTime?.() ?? 0;
      const isPlaying = watchState.isPlaying;
      if (isPlaying) {
        sendSync("sync", { currentTime, videoId: watchState.videoId ?? undefined, isPlaying });
      }
    }, SYNC_INTERVAL);
  }, [sendSync, watchState.isPlaying, watchState.videoId, playerReady]);

  const stopPeriodicSync = useCallback(() => {
    if (syncTimerRef.current) {
      clearInterval(syncTimerRef.current);
      syncTimerRef.current = null;
    }
  }, []);

  const applyRemoteState = useCallback(
    (event: WatchSyncEvent) => {
      if (event.from === localPeerId) return;
      if (!playerRef.current || !playerReady) {
        // Queue the event if player not ready
        if (event.action === "load" && event.videoId) {
          pendingLoadRef.current = event.videoId;
        } else if (event.action === "seek" && typeof event.currentTime === "number") {
          pendingSeekRef.current = event.currentTime;
        }
        return;
      }

      isRemoteUpdateRef.current = true;

      try {
        switch (event.action) {
          case "load":
            if (event.videoId) {
              playerRef.current.loadVideoById(event.videoId);
              if (typeof event.currentTime === "number" && event.currentTime > 0) {
                pendingSeekRef.current = event.currentTime;
              }
            }
            break;
          case "play":
            if (typeof event.currentTime === "number") {
              playerRef.current.seekTo(event.currentTime, true);
            }
            playerRef.current.playVideo();
            break;
          case "pause":
            if (typeof event.currentTime === "number") {
              playerRef.current.seekTo(event.currentTime, true);
            }
            playerRef.current.pauseVideo();
            break;
          case "seek":
            if (typeof event.currentTime === "number") {
              playerRef.current.seekTo(event.currentTime, true);
            }
            break;
          case "state":
            // Full state sync - load video if different
            if (event.videoId && event.videoId !== watchState.videoId) {
              playerRef.current.loadVideoById(event.videoId);
              pendingSeekRef.current = event.currentTime ?? 0;
            } else if (typeof event.currentTime === "number") {
              playerRef.current.seekTo(event.currentTime, true);
            }
            if (event.isPlaying) {
              playerRef.current.playVideo();
            } else {
              playerRef.current.pauseVideo();
            }
            setWatchState((prev) => ({
              ...prev,
              videoId: event.videoId ?? prev.videoId,
              isPlaying: event.isPlaying ?? prev.isPlaying,
              currentTime: event.currentTime ?? prev.currentTime,
              playlist: event.playlist ?? prev.playlist,
              playlistIndex: event.playlistIndex ?? prev.playlistIndex,
            }));
            break;
          case "sync":
            // Lightweight periodic sync for drift correction
            if (typeof event.currentTime === "number" && event.videoId === watchState.videoId) {
              const localTime = playerRef.current.getCurrentTime?.() ?? 0;
              const remoteTime = event.currentTime;
              const diff = Math.abs(localTime - remoteTime);
              if (diff > DRIFT_THRESHOLD && event.isPlaying === watchState.isPlaying) {
                // Only correct if both are playing or both paused, and difference is significant
                playerRef.current.seekTo(remoteTime, true);
              }
            }
            break;
          case "playlist-add":
            if (event.videoId) {
              setWatchState((prev) => ({
                ...prev,
                playlist: [...prev.playlist, { videoId: event.videoId! }],
              }));
            }
            break;
          case "playlist-remove":
            if (typeof event.playlistIndex === "number") {
              setWatchState((prev) => ({
                ...prev,
                playlist: prev.playlist.filter((_, i) => i !== event.playlistIndex),
              }));
            }
            break;
          case "playlist-play":
            if (typeof event.playlistIndex === "number" && event.videoId) {
              const playlistIndex = event.playlistIndex;
              setWatchState((prev) => ({
                ...prev,
                videoId: event.videoId!,
                isPlaying: true,
                currentTime: 0,
                playlistIndex,
              }));
              playerRef.current.loadVideoById(event.videoId!);
            }
            break;
        }
      } finally {
        setTimeout(() => {
          isRemoteUpdateRef.current = false;
        }, 0);
      }
    },
    [localPeerId, playerReady, watchState.videoId, watchState.isPlaying],
  );

  useEffect(() => {
    socket.on("watch:sync", applyRemoteState);
    return () => {
      socket.off("watch:sync", applyRemoteState);
    };
  }, [socket, applyRemoteState]);

  // Process pending operations when player becomes ready
  useEffect(() => {
    if (playerReady && playerRef.current) {
      if (pendingLoadRef.current) {
        playerRef.current.loadVideoById(pendingLoadRef.current);
        pendingLoadRef.current = null;
      }
      if (pendingSeekRef.current !== null) {
        setTimeout(() => {
          if (playerRef.current) {
            playerRef.current.seekTo(pendingSeekRef.current!, true);
          }
          pendingSeekRef.current = null;
        }, 500);
      }
    }
  }, [playerReady]);

  const onPlayerReady = useCallback(
    (event: any) => {
      const ytPlayer = event.target;
      playerRef.current = ytPlayer;
      setPlayer(ytPlayer);
      setPlayerReady(true);

      // Apply any pending operations
      if (pendingLoadRef.current) {
        ytPlayer.loadVideoById(pendingLoadRef.current);
        pendingLoadRef.current = null;
      }
      if (pendingSeekRef.current !== null) {
        setTimeout(() => ytPlayer.seekTo(pendingSeekRef.current!, true), 500);
        pendingSeekRef.current = null;
      }

      if (watchState.videoId) {
        ytPlayer.loadVideoById(watchState.videoId);
        if (watchState.currentTime > 0) {
          setTimeout(() => ytPlayer.seekTo(watchState.currentTime, true), 500);
        }
        if (watchState.isPlaying) {
          ytPlayer.playVideo();
        }
      }
    },
    [watchState.videoId, watchState.currentTime, watchState.isPlaying],
  );

  const onPlayerStateChange = useCallback(
    (event: any) => {
      if (isRemoteUpdateRef.current || !playerRef.current) return;

      const ytPlayer = event.target;
      const state = event.data;
      const currentTime = ytPlayer.getCurrentTime?.() ?? 0;

      switch (state) {
        case window.YT.PlayerState.PLAYING:
          sendSync("play", { currentTime, videoId: watchState.videoId ?? undefined, isPlaying: true });
          setWatchState((prev) => ({ ...prev, isPlaying: true, currentTime }));
          break;
        case window.YT.PlayerState.PAUSED:
          sendSync("pause", { currentTime, videoId: watchState.videoId ?? undefined, isPlaying: false });
          setWatchState((prev) => ({ ...prev, isPlaying: false, currentTime }));
          break;
        case window.YT.PlayerState.ENDED:
          sendSync("pause", { currentTime: 0, videoId: watchState.videoId ?? undefined, isPlaying: false });
          setWatchState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }));
          break;
        case window.YT.PlayerState.BUFFERING:
          break;
        case window.YT.PlayerState.CUED:
          break;
      }
    },
    [sendSync, watchState.videoId],
  );

  const onPlaybackRateChange = useCallback(
    (event: any) => {
      if (isRemoteUpdateRef.current) return;
    },
    [],
  );

  const initPlayer = useCallback(async () => {
    await loadYouTubeAPI();
    if (!playerContainerRef.current || playerRef.current) return;

    const ytPlayer = new window.YT.Player(playerContainerRef.current, {
      height: "100%",
      width: "100%",
      videoId: watchState.videoId || undefined,
      playerVars: {
        autoplay: 0,
        controls: 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onPlaybackRateChange: onPlaybackRateChange,
      },
    });
  }, [watchState.videoId, onPlayerReady, onPlayerStateChange, onPlaybackRateChange]);

  useEffect(() => {
    if (isPanelOpen && !playerReady) {
      initPlayer();
    }
    // Start periodic sync when panel opens
    if (isPanelOpen) {
      startPeriodicSync();
    } else {
      stopPeriodicSync();
    }
    return () => stopPeriodicSync();
  }, [isPanelOpen, playerReady, initPlayer, startPeriodicSync, stopPeriodicSync]);

  const loadVideo = useCallback(
    (url: string) => {
      const videoId = extractVideoId(url);
      if (!videoId) {
        setError("Please enter a valid YouTube URL.");
        return false;
      }
      setError(null);
      const newState = { videoId, isPlaying: false, currentTime: 0 };
      setWatchState((prev) => ({ ...prev, ...newState, playlistIndex: 0 }));
      sendSync("load", { videoId, currentTime: 0 });
      if (playerReady && playerRef.current) {
        playerRef.current.loadVideoById(videoId);
      }
      return true;
    },
    [sendSync, playerReady],
  );

  const playVideo = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.playVideo();
    }
  }, []);

  const pauseVideo = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.pauseVideo();
    }
  }, []);

  const seekVideo = useCallback((time: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(time, true);
    }
  }, []);

  const addToPlaylist = useCallback(
    (url: string) => {
      const videoId = extractVideoId(url);
      if (!videoId) {
        setError("Please enter a valid YouTube URL.");
        return false;
      }
      setError(null);
      const item: WatchPlaylistItem = { videoId };
      setWatchState((prev) => ({ ...prev, playlist: [...prev.playlist, item] }));
      sendSync("playlist-add", { videoId });
      return true;
    },
    [sendSync],
  );

  const removeFromPlaylist = useCallback(
    (index: number) => {
      setWatchState((prev) => ({
        ...prev,
        playlist: prev.playlist.filter((_, i) => i !== index),
      }));
      sendSync("playlist-remove", { playlistIndex: index });
    },
    [sendSync],
  );

  const playPlaylistItem = useCallback(
    (index: number) => {
      const item = watchState.playlist[index];
      if (!item) return;
      setWatchState((prev) => ({
        ...prev,
        videoId: item.videoId,
        isPlaying: true,
        currentTime: 0,
        playlistIndex: index,
      }));
      sendSync("playlist-play", { videoId: item.videoId, playlistIndex: index });
      if (playerReady && playerRef.current) {
        playerRef.current.loadVideoById(item.videoId);
      }
    },
    [watchState.playlist, sendSync, playerReady],
  );

  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => !prev);
    setIsMinimized(false);
  }, []);

  const minimizePanel = useCallback(() => {
    setIsMinimized(true);
  }, []);

  const restorePanel = useCallback(() => {
    setIsMinimized(false);
  }, []);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
    setIsMinimized(false);
  }, []);

  const handleDrag = useCallback((e: React.PointerEvent) => {
    if (!isMinimized || !playerContainerRef.current) return;
    const container = playerContainerRef.current.parentElement;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const panelRect = playerContainerRef.current.getBoundingClientRect();
    let x = e.clientX - containerRect.left - panelRect.width / 2;
    let y = e.clientY - containerRect.top - 20;
    const maxX = containerRect.width - panelRect.width;
    const maxY = containerRect.height - 40;
    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));
    setPanelPosition({ x, y });
  }, [isMinimized]);

  useEffect(() => {
    if (!isMinimized) return;
    const panel = playerContainerRef.current;
    if (!panel) return;
    panel.addEventListener("pointerdown", handleDrag as any);
    return () => panel.removeEventListener("pointerdown", handleDrag as any);
  }, [isMinimized, handleDrag]);

  useEffect(() => {
    return () => {
      stopPeriodicSync();
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          /* noop */
        }
      }
    };
  }, [stopPeriodicSync]);

  return {
    watchState,
    player,
    playerReady,
    error,
    isPanelOpen,
    isMinimized,
    panelPosition,
    playerContainerRef,
    setIsPanelOpen,
    togglePanel,
    minimizePanel,
    restorePanel,
    closePanel,
    loadVideo,
    playVideo,
    pauseVideo,
    seekVideo,
    addToPlaylist,
    removeFromPlaylist,
    playPlaylistItem,
    sendSync,
  };
}