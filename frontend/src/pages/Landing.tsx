import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, ShieldCheck, Zap } from "lucide-react";
import { useSocket } from "../hooks/useSocket";
import { ConnectionCard } from "../components/connection/ConnectionCard";
import { ConnectionId } from "../components/connection/ConnectionId";
import { ConnectionStatus } from "../components/connection/ConnectionStatus";
import { OnlineUsers } from "../components/online/OnlineUsers";
import { useAuth } from "../context/AuthContext";
import { getClientId, readRejoin } from "../utils/rejoin";
import { readDirectCall } from "../utils/directCall";
import type { ConnectionState } from "../types/webrtc";
import type { SessionErrorEvent } from "../types/signaling";

export function Landing() {
  const socket = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, initializing } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [joinId, setJoinId] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  );
  // Once the user edits the name field, never overwrite it with the account name.
  const nameTouchedRef = useRef(false);

  // Per-tab auto-rejoin: a saved session (survives refresh, cleared on
  // Leave) skips the join form entirely. A "Session ended" notice means the
  // server confirmed the code is gone — show the form instead.
  useEffect(() => {
    if (notice || initializing) return;
    // Account-to-account calls restore first: their id lives only in this
    // tab's sessionStorage and must never end up in the URL.
    const direct = readDirectCall();
    if (direct?.sessionId) {
      navigate("/call", { replace: true });
      return;
    }
    // Accounts use direct calls only — never restore a guest code session.
    if (!user) {
      const saved = readRejoin();
      if (saved?.code) {
        navigate(`/session/${saved.code}`, { state: { name: saved.name } });
        return;
      }
    }
    // Prepare the per-tab identity early so the first join already carries it.
    getClientId();
  }, [navigate, notice, user, initializing]);

  // Logged-in users get their saved account name pre-filled automatically.
  useEffect(() => {
    if (user && !nameTouchedRef.current) setName(user.name);
  }, [user]);

  useEffect(() => {
    const onCreated = (payload: { sessionId: string }) => {
      setSessionId(payload.sessionId);
      setStatus("waiting");
      setCreating(false);
      setError(null);
    };
    const onPeerJoined = (payload: { sessionId: string }) => {
      const trimmedName = name.trim();
      navigate(`/session/${payload.sessionId}`, {
        state: { isInitiator: true, fresh: true, name: trimmedName },
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
  }, [socket, navigate, name]);

  const create = () => {
    const trimmedName = name.trim() || (user?.name ?? "").trim();
    if (!trimmedName) {
      setError("Please enter your name.");
      return;
    }
    setError(null);
    setCreating(true);
    socket.emit("create-session", { name: trimmedName, clientId: getClientId() });
  };

  const join = () => {
    const id = joinId.trim().toUpperCase();
    const trimmedName = name.trim() || (user?.name ?? "").trim();
    if (!trimmedName) {
      setError("Please enter your name.");
      return;
    }
    if (!id) {
      setError("Please enter a connection ID.");
      return;
    }
    setError(null);
    navigate(`/session/${id}`, { state: { isInitiator: false, name: trimmedName } });
  };

  const handleLogout = () => {
    logout();
    nameTouchedRef.current = false;
    setName("");
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-surface px-4 py-6">
      {/* Optional accounts: guests simply never use this row. */}
      <div className="flex w-full max-w-xl items-center justify-end gap-2">
        {user ? (
          <>
            <div className="rounded-xl border border-border bg-panel px-3 py-2 text-right">
              <p className="text-xs font-semibold text-ink">{user.name}</p>
              <p className="font-mono text-[11px] text-muted">@{user.username}</p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-xl bg-panel3 px-3 py-2 text-xs font-semibold text-ink transition hover:brightness-125"
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link
              to="/login"
              className="rounded-xl bg-panel3 px-3 py-2 text-xs font-semibold text-ink transition hover:brightness-125"
            >
              Log in
            </Link>
            <Link
              to="/register"
              className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-[#13131B] transition hover:brightness-110"
            >
              Sign up
            </Link>
          </>
        )}
      </div>

      {initializing ? (
        <div className="flex w-full flex-1 items-center justify-center py-6 text-sm text-muted">
          Loading…
        </div>
      ) : user ? (
        // Logged-in home: online users only. The session-code UI is never
        // rendered for accounts.
        <div className="flex w-full flex-1 flex-col items-center justify-center py-6">
          <OnlineUsers />
        </div>
      ) : (
      <div className="flex w-full flex-1 flex-col items-center justify-center py-6">
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
          {notice && (
            <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {notice}
            </p>
          )}
          <label className="text-xs font-medium uppercase tracking-widest text-muted">
            Enter your name
          </label>
          <input
            value={name}
            onChange={(e) => {
              nameTouchedRef.current = true;
              setName(e.target.value);
            }}
            placeholder="Enter your name"
            maxLength={30}
            className="mt-2 w-full rounded-xl border border-border bg-panel2 px-4 py-3 text-sm text-ink placeholder:text-muted/40 focus:border-primary/60 focus:outline-none"
          />
          {error && (
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {/* Create section — always visible */}
          <div className="mt-4">
            <button
              onClick={create}
              disabled={creating}
              className="w-full rounded-xl bg-primary px-4 py-3 font-display text-sm font-bold text-[#13131B] transition hover:brightness-110 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Connection ID"}
            </button>
          </div>

          {sessionId && (
            <>
              <ConnectionId sessionId={sessionId} />
              <div className="mt-5">
                <ConnectionStatus state={status} />
                <p className="mt-1 text-xs text-muted">
                  Share this ID with your peer. Stay on this page — you will continue automatically
                  when they join.
                </p>
              </div>
            </>
          )}

          {/* OR divider */}
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <div className="h-px flex-1 bg-border" />
            <span>OR</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Join section — always visible, independent of session creation */}
          <div>
            <label className="text-xs font-medium uppercase tracking-widest text-muted">
              Join with a connection ID
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
          </div>
        </ConnectionCard>

        <p className="mt-6 max-w-md text-center text-xs leading-relaxed text-muted/70">
          Peer-to-peer connection via WebRTC. The server only exchanges connection setup messages
          (offer, answer, ICE) and never receives your messages, files, audio or video.
        </p>
      </div>
      )}
    </div>
  );
}
