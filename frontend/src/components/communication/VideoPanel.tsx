import { useEffect, useRef } from "react";

export function VideoPanel({
  localStream,
  remoteStream,
  cameraOn,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  cameraOn: boolean;
}) {
  const remoteRef = useRef<HTMLVideoElement>(null);
  const localRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (remoteRef.current && remoteStream) {
      remoteRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (localRef.current && localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const hasRemote = remoteStream && remoteStream.getVideoTracks().length > 0;

  return (
    <div className="relative min-h-[280px] flex-1 overflow-hidden rounded-2xl border border-border bg-black sm:min-h-[360px]">
      {hasRemote ? (
        <video ref={remoteRef} autoPlay playsInline className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-panel3 text-2xl font-bold text-secondary">
            P2P
          </div>
          <p className="text-sm">Waiting for remote video...</p>
          <p className="text-xs opacity-70">Remote video appears here once the peer shares camera</p>
        </div>
      )}

      <div className="absolute bottom-3 right-3 h-28 w-40 overflow-hidden rounded-xl border border-border bg-black shadow-xl sm:h-32 sm:w-48">
        {localStream ? (
          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover ${cameraOn ? "" : "hidden"}`}
          />
        ) : null}
        {(!localStream || !cameraOn) && (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted">
            {cameraOn ? "Camera off" : "Camera Off"}
          </div>
        )}
        <p className="absolute bottom-1 left-2 text-[10px] text-white/80">Your Video</p>
      </div>

      <p className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/90">
        Remote Video
      </p>
    </div>
  );
}
