import { useSocket } from "../../hooks/useSocket";
import { useAuth } from "../../context/AuthContext";
import { useDirectCalls } from "../../hooks/useDirectCalls";

function initials(name: string): string {
  const n = name.trim();
  if (!n) return "P2P";
  return n.slice(0, 2).toUpperCase();
}

export function OnlineUsers() {
  const socket = useSocket();
  const { user } = useAuth();
  const calls = useDirectCalls(socket, user?.id, user?.name);

  return (
    <div className="w-full max-w-3xl">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-ink">Online Users</h2>
          <p className="mt-1 text-xs text-muted">
            Connect directly — no session code needed. Calls stay peer-to-peer.
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-panel3 px-3 py-1 text-[11px] font-medium text-muted">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          {calls.users.length} online
        </span>
      </div>

      {calls.outgoing && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3">
          <p className="text-sm text-ink">
            Calling <span className="font-semibold">{calls.outgoing.name}</span>…
          </p>
          <button
            onClick={calls.cancel}
            className="rounded-lg bg-panel3 px-3 py-1.5 text-xs font-semibold text-ink transition hover:brightness-125"
          >
            Cancel
          </button>
        </div>
      )}

      {calls.notice && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-panel px-4 py-2.5">
          <p className="text-sm text-muted">{calls.notice}</p>
          <button
            onClick={calls.clearNotice}
            className="text-xs font-semibold text-muted hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      {calls.error && (
        <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
          {calls.error}
        </p>
      )}

      {calls.users.length === 0 ? (
        <div className="rounded-2xl border border-border bg-panel px-6 py-12 text-center">
          <p className="text-sm text-muted">No one else is online right now.</p>
          <p className="mt-1 text-xs text-muted/70">
            Keep this page open — the list updates live.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {calls.users.map((u) => (
            <div
              key={u.userId}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-panel p-4 shadow-lg"
            >
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-panel3 text-sm font-bold text-secondary">
                    {initials(u.name)}
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel bg-emerald-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-bold text-ink">{u.name}</p>
                  <p className="truncate font-mono text-xs text-muted">@{u.username}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium ${
                    u.busy
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  }`}
                >
                  {u.busy ? "In a call" : "Available"}
                </span>
              </div>

              <button
                onClick={() => calls.connect(u)}
                disabled={u.busy || !!calls.outgoing}
                className="w-full rounded-xl bg-primary px-4 py-2.5 font-display text-sm font-bold text-[#13131B] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {calls.outgoing?.targetUserId === u.userId ? "Calling..." : "Connect"}
              </button>
            </div>
          ))}
        </div>
      )}

      {calls.incoming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-6 shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-panel3 text-lg font-bold text-secondary">
              {initials(calls.incoming.name)}
            </div>
            <p className="mt-3 text-center font-display text-lg font-bold text-ink">
              {calls.incoming.name}
            </p>
            <p className="text-center font-mono text-xs text-muted">
              @{calls.incoming.username}
            </p>
            <p className="mt-2 text-center text-sm text-muted">is calling you</p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => calls.respond("decline")}
                className="flex-1 rounded-xl bg-panel3 px-4 py-2.5 text-sm font-semibold text-ink transition hover:brightness-125"
              >
                Decline
              </button>
              <button
                onClick={() => calls.respond("accept")}
                className="flex-1 rounded-xl bg-primary px-4 py-2.5 font-display text-sm font-bold text-[#13131B] transition hover:brightness-110"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
