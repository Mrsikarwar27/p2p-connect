import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ShieldCheck, Zap } from "lucide-react";
import { useSocket } from "../hooks/useSocket";
import { ConnectionCard } from "../components/connection/ConnectionCard";
import { ConnectionId } from "../components/connection/ConnectionId";
import { ConnectionStatus } from "../components/connection/ConnectionStatus";
import type { ConnectionState } from "../types/webrtc";
import type { SessionErrorEvent } from "../types/signaling";

export function Landing() {
  const socket = useSocket();
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [joinId, setJoinId] = useState("");
  const [status, setStatus] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const onCreated = (payload: { sessionId: string }) => {
      setSessionId(payload.sessionId);
      setStatus("waiting");
      setCreating(false);
      setError(null);
    };
    const onPeerJoined = (payload: { sessionId: string }) => {
      // Initiator: peer arrived — move to communication view.
      navigate(`/session/${payload.sessionId}`, {
        state: { isInitiator: true, fresh: true },
      });
    };
    const onError = (payload: SessionErrorEvent) => {
      setError(payload.message);
      setCreating(false);
    };
    socket.on("session-created", onCreated);
    socket.on("peer-joined", onPeerJoined);
    socket.on("session-error", onError);
    return () => {
      socket.off("session-created", onCreated);
      socket.off("peer-joined", onPeerJoined);
      socket.off("session-error", onError);
    };
  }, [socket, navigate]);

  const create = () => {
    setError(null);
    setCreating(true);
    socket.emit("create-session");
  };

  const join = () => {
    const id = joinId.trim().toUpperCase();
    if (!id) {
      setError("Please enter a connection ID.");
      return;
    }
    setError(null);
    navigate(`/session/${id}`, { state: { isInitiator: false } });
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-10">
      <div className="mb-6 text-center">
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-ink">
          P2P <span className="text-primary">Connect</span>
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted">
          Connect directly with another person. No account required. Messages, calls and files
          travel peer-to-peer over WebRTC.
        </p>
        <div className="mt-3 flex items-center justify-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Zap size={12} className="text-secondary" /> Direct WebRTC connection
          </span>
          <span className="flex items-center gap-1">
            <ShieldCheck size={12} className="text-secondary" /> Signaling only server
          </span>
        </div>
      </div>

      <ConnectionCard>
        {!sessionId ? (
          <button
            onClick={create}
            disabled={creating}
            className="w-full rounded-xl bg-primary px-4 py-3 font-display text-sm font-bold text-[#13131B] transition hover:brightness-110 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create Connection ID"}
          </button>
        ) : (
          <ConnectionId sessionId={sessionId} />
        )}

        <div className="my-5 flex items-center gap-3 text-xs text-muted">
          <div className="h-px flex-1 bg-border" />
          <span>OR</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <label className="text-xs font-medium uppercase tracking-widest text-muted">
          Enter remote peer connection ID
        </label>
        <div className="mt-2 flex gap-2">
          <input
            value={joinId}
            onChange={(e) => setJoinId(e.target.value.toUpperCase())}
            placeholder="7F3K-92LM"
            maxLength={9}
            className="min-w-0 flex-1 rounded-xl border border-border bg-panel2 px-4 py-3 font-mono text-sm tracking-[0.2em] text-ink placeholder:text-muted/40 focus:border-primary/60 focus:outline-none"
          />
          <button
            onClick={join}
            className="flex items-center gap-1.5 rounded-xl bg-panel3 px-5 py-3 text-sm font-semibold text-ink transition hover:brightness-125"
          >
            Connect <ArrowRight size={15} />
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-5">
          <ConnectionStatus state={sessionId ? status : "idle"} />
          {sessionId && (
            <p className="mt-1 text-xs text-muted">
              Share this ID with your peer. Stay on this page — you will continue automatically
              when they join.
            </p>
          )}
        </div>
      </ConnectionCard>

      <p className="mt-6 max-w-md text-center text-xs leading-relaxed text-muted/70">
        Peer-to-peer connection via WebRTC. The server only exchanges connection setup messages
        (offer, answer, ICE) and never receives your messages, files, audio or video.
      </p>
    </div>
  );
}
