import { useRef } from "react";
import { useState } from "react";
import { X, Minimize, Maximize2, Play, Pause, SkipBack, SkipForward, List, ChevronDown, ChevronUp, Plus, Trash2, Loader2 } from "lucide-react";

interface WatchTogetherPanelProps {
  watchState: {
    videoId: string | null;
    isPlaying: boolean;
    currentTime: number;
    playlist: { videoId: string; title?: string }[];
    playlistIndex: number;
  };
  playerReady: boolean;
  error: string | null;
  isPanelOpen: boolean;
  isMinimized: boolean;
  panelPosition: { x: number; y: number };
  playerContainerRef: React.RefObject<HTMLDivElement>;
  onLoadVideo: (url: string) => boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  onAddToPlaylist: (url: string) => boolean;
  onRemoveFromPlaylist: (index: number) => void;
  onPlayPlaylistItem: (index: number) => void;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
  onTogglePlaylist: () => void;
  showPlaylist: boolean;
  localName?: string;
  peerName?: string;
}

export function WatchTogetherPanel({
  watchState,
  playerReady,
  error,
  isPanelOpen,
  isMinimized,
  panelPosition,
  playerContainerRef,
  onLoadVideo,
  onPlay,
  onPause,
  onSeek,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onPlayPlaylistItem,
  onMinimize,
  onRestore,
  onClose,
  onTogglePlaylist,
  showPlaylist,
  localName,
  peerName,
}: WatchTogetherPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState("");
  const [playlistInput, setPlaylistInput] = useState("");
  const [showPlaylistInput, setShowPlaylistInput] = useState(false);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (!isPanelOpen) return null;

  if (isMinimized) {
    return (
      <div
        ref={playerContainerRef}
        style={{
          position: "absolute",
          left: panelPosition.x,
          top: panelPosition.y,
          zIndex: 50,
        }}
        className="pointer-events-auto"
      >
        <div className="flex items-center gap-2 rounded-xl border border-border bg-panel p-3 shadow-xl min-w-[320px] max-w-[480px]">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-ink truncate">
              {watchState.videoId ? `YouTube: ${watchState.videoId}` : "Watch Together"}
            </p>
            <p className="text-xs text-muted">
              {watchState.isPlaying ? "▶ Playing" : "⏸ Paused"} • {formatTime(watchState.currentTime)}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onRestore} title="Restore" className="p-1.5 rounded-lg bg-panel2 text-muted hover:text-ink hover:bg-panel3 transition">
              <Maximize2 size={16} />
            </button>
            <button onClick={onClose} title="Close" className="p-1.5 rounded-lg bg-panel2 text-muted hover:text-red-400 hover:bg-panel3 transition">
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full min-h-[300px] bg-black rounded-xl overflow-hidden">
      {/* Player Area */}
      <div className="relative flex-1 bg-black">
        <div ref={playerContainerRef} className="absolute inset-0" />
        {!playerReady && (
          <div className="absolute inset-0 flex items-center justify-center text-muted">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="ml-2">Loading YouTube Player...</span>
          </div>
        )}
        {!watchState.videoId && playerReady && (
          <div className="absolute inset-0 flex items-center justify-center text-muted">
            <p className="text-center px-4">No video loaded. Paste a YouTube URL to start watching together.</p>
          </div>
        )}
        {error && (
          <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between border-t border-border bg-panel p-3">
        <div className="flex items-center gap-3">
          <button
            onClick={watchState.isPlaying ? onPause : onPlay}
            className="p-2 rounded-lg bg-panel2 text-ink hover:bg-panel3 transition"
            aria-label={watchState.isPlaying ? "Pause" : "Play"}
          >
            {watchState.isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button
            onClick={() => onSeek(Math.max(0, watchState.currentTime - 10))}
            className="p-2 rounded-lg bg-panel2 text-ink hover:bg-panel3 transition"
            aria-label="Rewind 10s"
          >
            <SkipBack size={20} />
          </button>
          <button
            onClick={() => onSeek(watchState.currentTime + 10)}
            className="p-2 rounded-lg bg-panel2 text-ink hover:bg-panel3 transition"
            aria-label="Forward 10s"
          >
            <SkipForward size={20} />
          </button>
          <div className="w-px h-6 bg-border mx-1" />
          <span className="text-xs font-mono text-muted">{formatTime(watchState.currentTime)}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onTogglePlaylist}
            className={`p-2 rounded-lg transition ${showPlaylist ? "bg-primary text-[#13131B]" : "bg-panel2 text-ink hover:bg-panel3"}`}
            aria-label={showPlaylist ? "Hide playlist" : "Show playlist"}
          >
            <List size={20} />
          </button>
          <button onClick={onMinimize} title="Minimize" className="p-2 rounded-lg bg-panel2 text-ink hover:bg-panel3 transition">
            <Minimize size={20} />
          </button>
          <button onClick={onClose} title="Close" className="p-2 rounded-lg bg-panel2 text-ink hover:text-red-400 hover:bg-panel3 transition">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* URL Input */}
      <div className="border-t border-border bg-panel p-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onLoadVideo(urlInput)}
            placeholder="Paste YouTube URL (youtube.com/watch?v=... or youtu.be/...)"
            className="flex-1 rounded-xl border border-border bg-panel2 px-4 py-2 text-sm text-ink placeholder:text-muted/40 focus:border-primary/60 focus:outline-none"
            autoFocus
          />
          <button
            onClick={() => onLoadVideo(urlInput)}
            className="px-4 py-2 rounded-xl bg-primary text-[#13131B] font-medium text-sm hover:brightness-110 transition"
            disabled={!urlInput.trim()}
          >
            Load
          </button>
        </div>
        {showPlaylistInput && (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={playlistInput}
              onChange={(e) => setPlaylistInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onAddToPlaylist(playlistInput)}
              placeholder="Add to playlist (YouTube URL)"
              className="flex-1 rounded-xl border border-border bg-panel2 px-4 py-2 text-sm text-ink placeholder:text-muted/40 focus:border-primary/60 focus:outline-none"
            />
            <button
              onClick={() => onAddToPlaylist(playlistInput)}
              className="px-4 py-2 rounded-xl bg-panel3 text-ink font-medium text-sm hover:bg-panel2 transition"
              disabled={!playlistInput.trim()}
            >
              Add
            </button>
            <button
              onClick={() => setShowPlaylistInput(false)}
              className="p-2 rounded-xl bg-panel3 text-ink hover:bg-panel2 transition"
              aria-label="Cancel"
            >
              <X size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Playlist */}
      {showPlaylist && (
        <div className="border-t border-border bg-panel max-h-64 overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-2 text-xs font-medium text-muted">
            <span>Playlist ({watchState.playlist.length})</span>
            <button
              onClick={() => setShowPlaylistInput(true)}
              className="p-1 rounded-lg hover:bg-panel2 transition"
              aria-label="Add to playlist"
            >
              <Plus size={14} />
            </button>
          </div>
          {watchState.playlist.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted">Playlist is empty. Add videos to queue.</p>
          ) : (
            <ul className="divide-y divide-border">
              {watchState.playlist.map((item, index) => (
                <li key={item.videoId} className="flex items-center gap-2 px-3 py-2 hover:bg-panel2">
                  <span className="w-5 text-center text-xs text-muted">{index + 1}</span>
                  <button
                    onClick={() => onPlayPlaylistItem(index)}
                    className={`flex-1 text-left text-sm truncate transition ${index === watchState.playlistIndex ? "text-primary font-medium" : "text-ink"}`}
                  >
                    {item.title || `Video ${item.videoId}`}
                  </button>
                  <button
                    onClick={() => onRemoveFromPlaylist(index)}
                    className="p-1 rounded hover:bg-red-500/10 text-muted hover:text-red-400 transition"
                    aria-label="Remove from playlist"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}