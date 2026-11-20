import type { Server, Socket } from "socket.io";
import { SessionManager, normalizeSessionId } from "./sessionManager.js";
import { PresenceManager } from "./presence.js";
import { DirectCallManager } from "./directCalls.js";
import { resolveUserFromToken } from "../middleware/auth.js";
import type { SocketUser } from "../types/auth.js";

interface CreatePayload {
  name?: string;
}

interface JoinPayload {
  sessionId?: string;
  name?: string;
}

interface OfferPayload {
  sessionId?: string;
  offer?: Record<string, unknown>;
}

interface AnswerPayload {
  sessionId?: string;
  answer?: Record<string, unknown>;
}

interface CandidatePayload {
  sessionId?: string;
  candidate?: Record<string, unknown>;
}

interface WatchPayload {
  sessionId?: string;
  action: "load" | "play" | "pause" | "seek" | "state" | "sync" | "playlist-add" | "playlist-remove" | "playlist-play";
  videoId?: string;
  currentTime?: number;
  isPlaying?: boolean;
  playlistIndex?: number;
}

export function setupSignaling(io: Server, sessions: SessionManager): void {
  const presence = new PresenceManager();

  // Presence is per-account and in memory only. Each authenticated socket
  // receives the list WITHOUT itself; guest sockets are skipped entirely.
  const broadcastPresence = (): void => {
    for (const client of io.sockets.sockets.values()) {
      const socketUser = client.data.user as SocketUser | undefined;
      if (!socketUser) continue;
      client.emit(
        "online-users",
        presence.list(socketUser.id, (userId) => sessions.isUserBusy(userId)),
      );
    }
  };

  const directCalls = new DirectCallManager(io, sessions, presence, broadcastPresence);

  io.on("connection", (socket: Socket) => {
    // Optional identity from the handshake: auth.token. Guests have none.
    // Resolved lazily (never blocking connection) so no event can be missed.
    const rawToken = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const token = typeof rawToken === "string" ? rawToken.trim() : "";
    const userPromise: Promise<SocketUser | null> = token
      ? resolveUserFromToken(token).then((user) => {
          if (!user) return null;
          const socketUser: SocketUser = {
            id: user.id,
            name: user.name,
            username: user.username,
          };
          socket.data.user = socketUser;
          presence.add(socketUser, socket.id);
          broadcastPresence();
          return socketUser;
        })
      : Promise.resolve(null);

    socket.on("create-session", async (payload: CreatePayload & { clientId?: string }) => {
      const user = await userPromise;
      const typedName = payload?.name?.trim() ?? "";
      // A logged-in user's account name is the default display name, but a
      // name they typed explicitly always wins.
      const name = typedName || user?.name || "";
      const clientId = payload?.clientId ?? socket.id;
      const session = sessions.create();
      sessions.assignSlot(session, socket.id, clientId, name || undefined, user?.id);
      sessions.cancelDeleteTimer(session);
      socket.join(session.id);
      console.log(`[Signaling] Session created: ${session.id} (by ${socket.id} client=${clientId}) name="${name}"`);
      socket.emit("session-created", { sessionId: session.id });
      if (user) broadcastPresence();
    });

    socket.on("join-session", async (payload: JoinPayload & { clientId?: string }) => {
      const user = await userPromise;
      const rawId = payload?.sessionId ?? "";
      const sessionId = normalizeSessionId(rawId);
      const typedName = payload?.name?.trim() ?? "";
      const name = typedName || user?.name || "";
      const clientId = payload?.clientId ?? socket.id;
      if (!sessionId) {
        socket.emit("session-error", {
          sessionId: rawId,
          reason: "invalid",
          message: "Please enter a valid connection ID.",
        });
        return;
      }
      const session = sessions.get(sessionId);
      if (!session) {
        console.log(`[Signaling] Join rejected (not found): ${sessionId} (${socket.id})`);
        socket.emit("session-error", {
          sessionId,
          reason: "invalid",
          message: "Session not found. Check the ID and try again.",
        });
        return;
      }
      // Signaling is routed by ROOM, never by stored socketId.
      socket.join(sessionId);
      const result = sessions.assignSlot(session, socket.id, clientId, name || undefined, user?.id);
      if (result === "full") {
        socket.leave(sessionId);
        console.log(`[Signaling] Join rejected (full): ${sessionId} (${socket.id})`);
        socket.emit("session-error", {
          sessionId,
          reason: "full",
          message: "This session is already full.",
        });
        return;
      }
      sessions.cancelDeleteTimer(session);
      if (user) broadcastPresence();
      const mySlot = sessions.slotBySocket(session, socket.id);
      const partner = sessions.partnerOf(session, socket.id);
      // Direct calls reserve both seats before either client navigates. A
      // reserved seat only counts as "connected" once that socket has
      // actually entered the room, so the initiator's offer never races a
      // peer page that has not mounted yet.
      let partnerState: "connected" | "away" | "none" = "none";
      if (partner) {
        if (partner.state === "away") {
          partnerState = "away";
        } else if (!session.direct || (partner.socketId && session.directJoined?.has(partner.socketId))) {
          partnerState = "connected";
        }
      }
      // Role is derived ONCE from the stable seat: seat 0 is the initiator,
      // always, for first joins AND rejoins. It never flips.
      const initiator = session.slots[0] === mySlot;
      const peerCount = session.slots.filter(Boolean).length;
      console.log(
        `[Signaling] ${result === "rejoin" ? "Rejoined" : result === "same" ? "Duplicate-join" : "Joined"}: ${sessionId} (${socket.id} client=${clientId}) epoch=${mySlot?.connectionEpoch} partnerState=${partnerState} initiator=${initiator}`,
      );
      socket.emit("session-joined", {
        sessionId,
        peerId: socket.id,
        peerCount,
        initiator,
        name,
        peerName: partner?.name,
        partnerState,
        epoch: mySlot?.connectionEpoch ?? 1,
      });
      // Send current watch state to the joining peer
      const watchState = sessions.getWatchState(sessionId);
      if (watchState && watchState.videoId) {
        socket.emit("watch:sync", {
          sessionId,
          action: "state",
          videoId: watchState.videoId,
          currentTime: watchState.currentTime,
          isPlaying: watchState.isPlaying,
          playlist: watchState.playlist,
          playlistIndex: watchState.playlistIndex,
          from: "server",
          timestamp: Date.now(),
        });
      }
      const firstDirectJoin = session.direct ? !session.directJoined?.has(socket.id) : false;
      if (session.direct) session.directJoined?.add(socket.id);
      if (!partner || !partner.socketId) return;
      // "same" = this socket re-joined its own live seat (StrictMode double
      // mount, manual rejoin button) — idempotent, never notify the partner.
      if (result === "same") {
        // Exception: the first real entry into a direct call. If the other
        // reserved seat is already in the room, tell it the peer arrived so
        // the initiator sends the (single) offer now.
        if (firstDirectJoin && session.direct && session.directJoined?.has(partner.socketId)) {
          socket.to(sessionId).emit("peer-joined", {
            sessionId,
            peerId: socket.id,
            peerCount,
            name,
          });
        }
        return;
      }
      const myEpoch = sessions.slotBySocket(session, socket.id)?.connectionEpoch ?? 1;
      if (result === "rejoin") {
        socket.to(sessionId).emit("peer-rejoined", {
          sessionId,
          peerId: socket.id,
          name,
          epoch: myEpoch,
        });
      } else {
        socket.to(sessionId).emit("peer-joined", {
          sessionId,
          peerId: socket.id,
          peerCount,
          name,
        });
      }
    });

    socket.on("webrtc-offer", (payload: OfferPayload) => {
      if (!payload?.sessionId || !payload.offer) return;
      const sessionId = normalizeSessionId(payload.sessionId);
      const session = sessions.get(sessionId);
      if (!session || !sessions.isMember(session, socket.id)) return; // member check
      socket.to(sessionId).emit("webrtc-offer", {
        sessionId,
        offer: payload.offer,
        from: socket.id,
      });
    });

    socket.on("webrtc-answer", (payload: AnswerPayload) => {
      if (!payload?.sessionId || !payload.answer) return;
      const sessionId = normalizeSessionId(payload.sessionId);
      const session = sessions.get(sessionId);
      if (!session || !sessions.isMember(session, socket.id)) return; // member check
      socket.to(sessionId).emit("webrtc-answer", {
        sessionId,
        answer: payload.answer,
        from: socket.id,
      });
    });

    socket.on("ice-candidate", (payload: CandidatePayload) => {
      if (!payload?.sessionId || !payload.candidate) return;
      const sessionId = normalizeSessionId(payload.sessionId);
      const session = sessions.get(sessionId);
      if (!session || !sessions.isMember(session, socket.id)) return; // member check
      socket.to(sessionId).emit("ice-candidate", {
        sessionId,
        candidate: payload.candidate,
        from: socket.id,
      });
    });

    // Screen share state: relay to the other session member only
    socket.on("screen-share-state", (payload: { sessionId?: string; active?: boolean }) => {
      const rawId = payload?.sessionId ?? "";
      const sessionId = rawId ? normalizeSessionId(rawId) : undefined;
      if (!sessionId) return;
      const session = sessions.get(sessionId);
      if (!session || !sessions.isMember(session, socket.id)) return; // member check
      socket.to(sessionId).emit("screen-share-state", {
        sessionId,
        active: Boolean(payload.active),
        from: socket.id,
      });
    });

    socket.on("leave-session", (payload: { sessionId?: string }) => {
      const rawId = payload?.sessionId ?? "";
      const sessionId = rawId ? normalizeSessionId(rawId) : undefined;
      const session = sessionId ? sessions.get(sessionId) : sessions.sessionOfSocket(socket.id);
      if (!session) return;
      const removed = sessions.removeSlotBySocket(session, socket.id);
      if (!removed) return;
      console.log(`[Signaling] Peer left: ${session.id} (${socket.id})`);
      socket.leave(session.id);
      socket.to(session.id).emit("peer-left", {
        sessionId: session.id,
        peerId: socket.id,
      });
      // Free seat can be taken again; delete only when NO seats remain.
      sessions.scheduleDeleteIfIdle(session);
      if (socket.data.user) broadcastPresence();
    });

    // ---- Optional accounts: presence + direct (no-code) calls ----
    socket.on("presence-subscribe", async () => {
      const user = await userPromise;
      if (!user) return;
      socket.emit(
        "online-users",
        presence.list(user.id, (userId) => sessions.isUserBusy(userId)),
      );
    });

    socket.on(
      "call-request",
      async (payload: { targetUserId?: unknown; clientId?: unknown }) => {
        const user = await userPromise;
        if (!user) {
          // Guests cannot use direct calls — enforced here, not just in the UI.
          socket.emit("call-request-error", {
            reason: "unauthenticated",
            message: "Sign in to call other users.",
          });
          return;
        }
        directCalls.request(socket, user, payload?.targetUserId, payload?.clientId);
      },
    );

    socket.on(
      "call-request-response",
      async (payload: { requestId?: unknown; action?: unknown; clientId?: unknown }) => {
        const user = await userPromise;
        if (!user) return;
        directCalls.respond(socket, user, payload ?? {});
      },
    );

    socket.on("call-request-cancel", async () => {
      const user = await userPromise;
      if (!user) return;
      directCalls.cancel(socket, user);
    });

    // Watch Together events
    socket.on("watch:sync", (payload: WatchPayload) => {
      const rawId = payload?.sessionId ?? "";
      const sessionId = rawId ? normalizeSessionId(rawId) : undefined;
      if (!sessionId) return;

      const session = sessions.get(sessionId);
      if (!session) return;

      // Validate the peer is in this session
      if (!sessions.isMember(session, socket.id)) return;

      // Persist watch state before forwarding so late joiners get the real current state
      if (payload.action === "load" && payload.videoId) {
        sessions.setWatchState(sessionId, {
          videoId: payload.videoId,
          currentTime: payload.currentTime ?? 0,
          isPlaying: payload.isPlaying ?? false,
        }, socket.id);
      } else if (payload.action === "play" || payload.action === "pause" || payload.action === "seek" || payload.action === "state" || payload.action === "sync") {
        sessions.setWatchState(sessionId, {
          videoId: payload.videoId ?? session.watchState.videoId ?? null,
          currentTime: typeof payload.currentTime === "number" ? payload.currentTime : (payload.action === "seek" ? payload.currentTime ?? session.watchState.currentTime : session.watchState.currentTime),
          isPlaying: payload.isPlaying ?? session.watchState.isPlaying,
        }, socket.id);
      } else if (payload.action === "playlist-add" && payload.videoId) {
        sessions.addToPlaylist(sessionId, { videoId: payload.videoId }, socket.id);
      } else if (payload.action === "playlist-remove" && typeof payload.playlistIndex === "number") {
        sessions.removeFromPlaylist(sessionId, payload.playlistIndex);
      } else if (payload.action === "playlist-play" && typeof payload.playlistIndex === "number") {
        const item = session.watchState.playlist[payload.playlistIndex];
        if (item) {
          sessions.playPlaylistItem(sessionId, payload.playlistIndex, socket.id);
        }
      }

      // Only route to the other peer
      socket.to(sessionId).emit("watch:sync", {
        ...payload,
        from: socket.id,
      });
    });

    socket.on("disconnect", () => {
      const presenceResult = presence.remove(socket.id);
      directCalls.handleDisconnect(socket, presenceResult?.online ?? false);
      broadcastPresence();
      const session = sessions.sessionOfSocket(socket.id);
      if (!session) return;
      const slot = sessions.markAway(session, socket.id);
      if (!slot) return;
      console.log(`[Signaling] Peer away: ${session.id} (${socket.id})`);
      // Unexpected drop: the seat is HELD (state=away), the session survives.
      socket.to(session.id).emit("peer-away", {
        sessionId: session.id,
        peerId: socket.id,
        name: slot.name,
      });
      // Both seats away -> grace timer; any join cancels it.
      sessions.scheduleDeleteIfIdle(session);
    });
  });
}
