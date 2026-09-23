import type { ConnectionState } from "../../types/webrtc";

const LABELS: Record<ConnectionState, string> = {
  idle: "Waiting for connection...",
  waiting: "Waiting for connection...",
  connecting: "Connecting to peer...",
  connected: "Connected directly",
  failed: "Unable to establish a direct connection.",
  ended: "Connection ended",
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  const dot =
    state === "connected"
      ? "bg-emerald-400"
      : state === "connecting"
        ? "bg-amber-400 animate-pulse"
        : state === "failed"
          ? "bg-red-400"
          : "bg-muted/60";

  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span>{LABELS[state]}</span>
    </div>
  );
}
