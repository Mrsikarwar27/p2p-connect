import type { Server, Socket } from "socket.io";
import { SessionManager, normalizeSessionId } from "./sessionManager.js";

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
  io.on("connection", (socket: Socket) => {
    socket.on("create-session", (payload: CreatePayload) => {
      const name = payload?.name?.trim() ?? "";
      const session = sessions.create();
      console.log(`[Signaling] Session created: ${session.id} (by ${socket.id}) name="${name}"`);
      const result = sessions.addPeer(session.id, socket.id, name || undefined);
      if (!result.ok) {
        socket.emit("session-error", {
          sessionId: session.id,
          reason: result.reason,
          message: "Could not create session.",
        });
        return;
      }
      socket.join(session.id);
      sessions.claimInitiator(session.id, socket.id);
      socket.emit("session-created", { sessionId: session.id });
    });

    socket.on("join-session", (payload: JoinPayload) => {
      const rawId = payload?.sessionId ?? "";
      const sessionId = normalizeSessionId(rawId);
      const name = payload?.name?.trim() ?? "";
      if (!sessionId) {
        socket.emit("session-error", {
          sessionId: rawId,
          reason: "invalid",
          message: "Please enter a valid connection ID.",
        });
        return;
      }
      // Membership must be checked BEFORE addPeer() mutates the session,
      // otherwise alreadyPeer is always true and peer-joined never fires.
      const sessionBefore = sessions.get(sessionId);
      const alreadyPeer = sessionBefore ? sessionBefore.peers.includes(socket.id) : false;
      const result = sessions.addPeer(sessionId, socket.id, name || undefined);
      if (!result.ok) {
        if (result.reason === "full") {
          console.log(`[Signaling] Join rejected (full): ${sessionId} (${socket.id})`);
          socket.emit("session-error", {
            sessionId,
            reason: "full",
            message: "This session is already full.",
          });
        } else {
          console.log(`[Signaling] Join rejected (invalid): ${sessionId} (${socket.id})`);
          socket.emit("session-error", {
            sessionId,
            reason: "invalid",
            message: "Session not found. Check the ID and try again.",
          });
        }
        return;
      }
      socket.join(sessionId);
      sessions.claimInitiator(sessionId, socket.id);
      const session = result.session;
      // Authoritative role from the session's initiatorId — this is computed
      // from live peers only, so join-order races after simultaneous reloads
      // can't leave both peers as answerers. Clients must not rely solely on
      // router state, which is lost on refresh / direct navigation.
      const initiator = session.initiatorId === socket.id;
      const otherPeerId = session.peers.find((id) => id !== socket.id);
      const otherPeerName = otherPeerId ? sessions.getPeerName(sessionId, otherPeerId) : undefined;
      console.log(
        `[Signaling] Peer joined: ${sessionId} (${socket.id}) count=${session.peers.length} initiator=${initiator}`,
      );
      socket.emit("session-joined", {
        sessionId,
        peerId: socket.id,
        peerCount: session.peers.length,
        initiator,
        name,
        peerName: otherPeerName,
      });
      // Send current watch state to the new peer
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
      if (!alreadyPeer) {
        socket.to(sessionId).emit("peer-joined", {
          sessionId,
          peerId: socket.id,
          peerCount: session.peers.length,
          name,
        });
      }
    });

    socket.on("webrtc-offer", (payload: OfferPayload) => {
      if (!payload?.sessionId || !payload.offer) return;
      const sessionId = normalizeSessionId(payload.sessionId);
      const session = sessions.get(sessionId);
      if (!session || !session.peers.includes(socket.id)) return; // member check
      console.log(`[Signaling] Routing offer: ${sessionId} (from ${socket.id})`);
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
      if (!session || !session.peers.includes(socket.id)) return; // member check
      console.log(`[Signaling] Routing answer: ${sessionId} (from ${socket.id})`);
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
      if (!session || !session.peers.includes(socket.id)) return; // member check
      console.log(`[Signaling] Routing ICE candidate: ${sessionId} (from ${socket.id})`);
      socket.to(sessionId).emit("ice-candidate", {
        sessionId,
        candidate: payload.candidate,
        from: socket.id,
      });
    });

    socket.on("leave-session", (payload: { sessionId?: string }) => {
      const rawId = payload?.sessionId ?? "";
      const sessionId = rawId ? normalizeSessionId(rawId) : undefined;
      const session = sessions.sessionOfSocket(socket.id);
      const targetId = sessionId ?? session?.id;
      sessions.removeSocket(socket.id);
      if (targetId) {
        console.log(`[Signaling] Peer left: ${targetId} (${socket.id})`);
        socket.leave(targetId);
        socket.to(targetId).emit("peer-left", {
          sessionId: targetId,
          peerId: socket.id,
        });
        const promoted = sessions.ensureInitiator(targetId);
        if (promoted) {
          console.log(`[Signaling] Initiator promoted: ${targetId} -> ${promoted}`);
          io.to(promoted).emit("session-role", { sessionId: targetId, initiator: true });
        }
      }
    });

    // Watch Together events
    socket.on("watch:sync", (payload: WatchPayload) => {
      const rawId = payload?.sessionId ?? "";
      const sessionId = rawId ? normalizeSessionId(rawId) : undefined;
      if (!sessionId) return;

      const session = sessions.get(sessionId);
      if (!session) return;

      // Validate the peer is in this session
      if (!session.peers.includes(socket.id)) return;

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
      const session = sessions.sessionOfSocket(socket.id);
      sessions.removeSocket(socket.id);
      if (session) {
        console.log(`[Signaling] Peer disconnected: ${session.id} (${socket.id})`);
        io.to(session.id).emit("peer-left", {
          sessionId: session.id,
          peerId: socket.id,
        });
        const promoted = sessions.ensureInitiator(session.id);
        if (promoted) {
          console.log(`[Signaling] Initiator promoted: ${session.id} -> ${promoted}`);
          io.to(promoted).emit("session-role", { sessionId: session.id, initiator: true });
        }
      }
    });
  });
}
