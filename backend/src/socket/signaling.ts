import type { Server, Socket } from "socket.io";
import { SessionManager, normalizeSessionId } from "./sessionManager.js";

interface JoinPayload {
  sessionId?: string;
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

export function setupSignaling(io: Server, sessions: SessionManager): void {
  io.on("connection", (socket: Socket) => {
    socket.on("create-session", () => {
      const session = sessions.create();
      console.log(`[Signaling] Session created: ${session.id} (by ${socket.id})`);
      const result = sessions.addPeer(session.id, socket.id);
      if (!result.ok) {
        socket.emit("session-error", {
          sessionId: session.id,
          reason: result.reason,
          message: "Could not create session.",
        });
        return;
      }
      socket.join(session.id);
      socket.emit("session-created", { sessionId: session.id });
    });

    socket.on("join-session", (payload: JoinPayload) => {
      const rawId = payload?.sessionId ?? "";
      const sessionId = normalizeSessionId(rawId);
      if (!sessionId) {
        socket.emit("session-error", {
          sessionId: rawId,
          reason: "invalid",
          message: "Please enter a valid connection ID.",
        });
        return;
      }
      const result = sessions.addPeer(sessionId, socket.id);
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
      const session = result.session;
      // First peer in the session is the initiator; second is the receiver.
      // This is authoritative — clients must not rely solely on router state,
      // which is lost on refresh / direct navigation.
      const initiator = session.peers[0] === socket.id;
      console.log(
        `[Signaling] Peer joined: ${sessionId} (${socket.id}) count=${session.peers.length} initiator=${initiator}`,
      );
      socket.emit("session-joined", {
        sessionId,
        peerId: socket.id,
        peerCount: session.peers.length,
        initiator,
      });
      socket.to(sessionId).emit("peer-joined", {
        sessionId,
        peerId: socket.id,
        peerCount: session.peers.length,
      });
    });

    socket.on("webrtc-offer", (payload: OfferPayload) => {
      if (!payload?.sessionId || !payload.offer) return;
      const sessionId = normalizeSessionId(payload.sessionId);
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
      if (targetId) {
        console.log(`[Signaling] Peer left: ${targetId} (${socket.id})`);
        socket.leave(targetId);
        socket.to(targetId).emit("peer-left", {
          sessionId: targetId,
          peerId: socket.id,
        });
      }
      sessions.removeSocket(socket.id);
    });

    socket.on("disconnect", () => {
      const session = sessions.sessionOfSocket(socket.id);
      sessions.removeSocket(socket.id);
      if (session) {
        console.log(`[Signaling] Peer disconnected: ${session.id} (${socket.id})`);
        socket.to(session.id).emit("peer-left", {
          sessionId: session.id,
          peerId: socket.id,
        });
      }
    });
  });
}
