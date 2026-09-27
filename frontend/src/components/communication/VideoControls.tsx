import { Mic, MicOff, PhoneOff, Video, VideoOff, Paperclip, RotateCcw, Monitor } from "lucide-react";

export function VideoControls({
  micOn,
  cameraOn,
  onToggleMic,
  onToggleCamera,
  onSwitchCamera,
  onWatchTogether,
  onShareFile,
  onEnd,
  canSwitchCamera = false,
}: {
  micOn: boolean;
  cameraOn: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
  onWatchTogether: () => void;
  onShareFile: () => void;
  onEnd: () => void;
  canSwitchCamera?: boolean;
}) {
  const btn =
    "flex h-11 w-11 items-center justify-center rounded-full border border-border bg-panel3 text-ink transition hover:brightness-125";
  const btnDisabled =
    "flex h-11 w-11 items-center justify-center rounded-full border border-border bg-panel3 text-muted/40 cursor-not-allowed";
  return (
    <div className="flex items-center justify-center gap-3 py-3">
      <button onClick={onToggleMic} title={micOn ? "Mute" : "Unmute"} className={btn}>
        {micOn ? <Mic size={18} /> : <MicOff size={18} className="text-red-400" />}
      </button>
      <button onClick={onToggleCamera} title={cameraOn ? "Camera off" : "Camera on"} className={btn}>
        {cameraOn ? <Video size={18} /> : <VideoOff size={18} className="text-red-400" />}
      </button>
      {canSwitchCamera && (
        <button
          onClick={onSwitchCamera}
          title="Switch camera"
          disabled={!cameraOn}
          className={cameraOn ? btn : btnDisabled}
        >
          <RotateCcw size={18} />
        </button>
      )}
      <button onClick={onWatchTogether} title="Watch Together" className={btn}>
        <Monitor size={18} />
      </button>
      <button onClick={onShareFile} title="Share file" className={btn}>
        <Paperclip size={18} />
      </button>
      <button
        onClick={onEnd}
        title="End call"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white transition hover:brightness-110"
      >
        <PhoneOff size={18} />
      </button>
    </div>
  );
}
