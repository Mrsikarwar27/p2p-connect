import { Mic, MicOff, PhoneOff, Video, VideoOff, Paperclip } from "lucide-react";

export function VideoControls({
  micOn,
  cameraOn,
  onToggleMic,
  onToggleCamera,
  onShareFile,
  onEnd,
}: {
  micOn: boolean;
  cameraOn: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onShareFile: () => void;
  onEnd: () => void;
}) {
  const btn =
    "flex h-11 w-11 items-center justify-center rounded-full border border-border bg-panel3 text-ink transition hover:brightness-125";
  return (
    <div className="flex items-center justify-center gap-3 py-3">
      <button onClick={onToggleMic} title={micOn ? "Mute" : "Unmute"} className={btn}>
        {micOn ? <Mic size={18} /> : <MicOff size={18} className="text-red-400" />}
      </button>
      <button onClick={onToggleCamera} title={cameraOn ? "Camera off" : "Camera on"} className={btn}>
        {cameraOn ? <Video size={18} /> : <VideoOff size={18} className="text-red-400" />}
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
