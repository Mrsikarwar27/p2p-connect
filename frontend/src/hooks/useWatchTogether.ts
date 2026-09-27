import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { WatchState, WatchPlaylistItem, WatchSyncEvent } from "../types/signaling";

interface UseWatchTogetherOptions {
  socket: Socket;
  sessionId: string;
  localPeerId: string;
  peerName?: string;
}

const YOUTUBE_API_READY = "YOUTUBE_API_READY";

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

  const applyRemoteState = useCallback(
    (event: WatchSyncEvent) => {
      if (event.from === localPeerId) return;
      if (!playerRef.current || !playerReady) return;

      isRemoteUpdateRef.current = true;

      try {
        switch (event.action) {
          case "load":
            if (event.videoId) {
              playerRef.current.loadVideoById(event.videoId);
              if (typeof event.currentTime === "number" && event.currentTime > 0) {
                setTimeout(() => {
                  if (playerRef.current) {
                    playerRef.current.seekTo(event.currentTime!, true);
                  }
                }, 500);
              }
            }
            break;
          case "play":
            playerRef.current.playVideo();
            break;
          case "pause":
            playerRef.current.pauseVideo();
            break;
          case "seek":
            if (typeof event.currentTime === "number") {
              playerRef.current.seekTo(event.currentTime, true);
            }
            break;
          case "state":
            if (event.videoId !== undefined) {
              setWatchState((prev) => ({
                ...prev,
                videoId: event.videoId ?? null,
                isPlaying: event.isPlaying ?? false,
                currentTime: event.currentTime ?? 0,
                playlist: event.playlist ?? [],
                playlistIndex: event.playlistIndex ?? 0,
              }));
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
    [localPeerId, playerReady],
  );

  useEffect(() => {
    socket.on("watch:sync", applyRemoteState);
    return () => {
      socket.off("watch:sync", applyRemoteState);
    };
  }, [socket, applyRemoteState]);

  const onPlayerReady = useCallback(
    (event: any) => {
      const ytPlayer = event.target;
      playerRef.current = ytPlayer;
      setPlayer(ytPlayer);
      setPlayerReady(true);

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
  }, [isPanelOpen, playerReady, initPlayer]);

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
      if (syncTimerRef.current) {
        clearInterval(syncTimerRef.current);
      }
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

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