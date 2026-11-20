import { randomUUID } from "crypto";
import type { Server, Socket } from "socket.io";
import type { SessionManager } from "./sessionManager.js";
import type { PresenceManager } from "./presence.js";
import type { SocketUser } from "../types/auth.js";

const REQUEST_TTL_MS = 30_000;

interface PendingRequest {
  id: string;
  callerUserId: string;
  callerSocketId: string;
  callerClientId: string;
  callerName: string;
  callerUsername: string;
  targetUserId: string;
  targetName: string;
  targetUsername: string;
  timer: NodeJS.Timeout;
}

interface RespondPayload {
  requestId?: unknown;
  action?: unknown;
  clientId?: unknown;
}

export interface CallStartedPayload {
  sessionId: string;
  role: "initiator" | "joiner";
  peerUserId: string;
  peerName: string;
}

/**
 * In-memory connect-request broker for logged-in users. It never stores
 * anything in MongoDB, and it creates calls through the existing
 * SessionManager (same path as a guest creating a session).
 */
export class DirectCallManager {
  private byId = new Map<string, PendingRequest>();
  private outgoingByUser = new Map<string, string>();
  private incomingByUser = new Map<string, string>();

  constructor(
    private io: Server,
    private sessions: SessionManager,
    private presence: PresenceManager,
    private broadcastPresence: () => void,
  ) {}

  private fail(socket: Socket, reason: string, message: string): void {
    socket.emit("call-request-error", { reason, message });
  }

  request(
    socket: Socket,
    caller: SocketUser,
    targetUserId: unknown,
    clientId: unknown,
  ): void {
    if (typeof targetUserId !== "string" || !targetUserId) {
      this.fail(socket, "invalid", "Invalid call request.");
      return;
    }
    if (typeof clientId !== "string" || !clientId) {
      this.fail(socket, "invalid", "Invalid call request.");
      return;
    }
    if (targetUserId === caller.id) {
      this.fail(socket, "self", "You cannot call yourself.");
      return;
    }
    if (this.sessions.isUserBusy(caller.id)) {
      this.fail(socket, "busy", "You are already in a call.");
      return;
    }
    if (this.outgoingByUser.has(caller.id)) {
      this.fail(socket, "already-calling", "You are already calling someone.");
      return;
    }
    if (!this.presence.isOnline(targetUserId)) {
      this.fail(socket, "offline", "That user is offline.");
      return;
    }
    if (this.sessions.isUserBusy(targetUserId)) {
      this.fail(socket, "busy", "That user is in a call.");
      return;
    }
    if (this.incomingByUser.has(targetUserId)) {
      this.fail(socket, "busy", "That user is already receiving a call.");
      return;
    }

    const target = this.presence.get(targetUserId);
    if (!target) {
      this.fail(socket, "offline", "That user is offline.");
      return;
    }

    const request: PendingRequest = {
      id: randomUUID(),
      callerUserId: caller.id,
      callerSocketId: socket.id,
      callerClientId: clientId,
      callerName: caller.name,
      callerUsername: caller.username,
      targetUserId,
      targetName: target.name,
      targetUsername: target.username,
      timer: setTimeout(() => this.expire(request.id), REQUEST_TTL_MS),
    };

    this.byId.set(request.id, request);
    this.outgoingByUser.set(caller.id, request.id);
    this.incomingByUser.set(targetUserId, request.id);

    socket.emit("call-request-sent", {
      requestId: request.id,
      targetUserId,
      name: target.name,
    });
    for (const socketId of this.presence.socketIds(targetUserId)) {
      this.io.to(socketId).emit("incoming-call-request", {
        requestId: request.id,
        callerUserId: caller.id,
        name: caller.name,
        username: caller.username,
      });
    }
  }

  respond(socket: Socket, user: SocketUser, payload: RespondPayload): void {
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
    const action = payload?.action;
    const request = this.byId.get(requestId);
    if (!request) {
      this.fail(socket, "expired", "This call request is no longer available.");
      return;
    }
    if (request.targetUserId !== user.id) {
      this.fail(socket, "not-allowed", "You cannot respond to this call request.");
      return;
    }
    if (action !== "accept" && action !== "decline") {
      this.fail(socket, "invalid", "Invalid response.");
      return;
    }

    if (action === "decline") {
      this.clear(request);
      this.io.to(request.callerSocketId).emit("call-request-declined", {
        requestId: request.id,
        name: request.targetName,
      });
      return;
    }

    const targetClientId =
      typeof payload?.clientId === "string" && payload.clientId ? payload.clientId : socket.id;

    this.clear(request);

    // Same creation path as a guest session: SessionManager.create().
    const session = this.sessions.create();
    session.direct = true;
    session.directJoined = new Set();
    this.sessions.assignSlot(
      session,
      request.callerSocketId,
      request.callerClientId,
      request.callerName,
      request.callerUserId,
    );
    this.sessions.assignSlot(session, socket.id, targetClientId, request.targetName, request.targetUserId);
    this.sessions.cancelDeleteTimer(session);

    const callerPayload: CallStartedPayload = {
      sessionId: session.id,
      role: "initiator",
      peerUserId: request.targetUserId,
      peerName: request.targetName,
    };
    const targetPayload: CallStartedPayload = {
      sessionId: session.id,
      role: "joiner",
      peerUserId: request.callerUserId,
      peerName: request.callerName,
    };

    this.io.to(request.callerSocketId).emit("call-started", callerPayload);
    socket.emit("call-started", targetPayload);

    // Close the same request on any other tab of the accepting user.
    for (const socketId of this.presence.socketIds(user.id)) {
      if (socketId === socket.id) continue;
      this.io.to(socketId).emit("call-request-cancelled", {
        requestId: request.id,
        reason: "accepted",
      });
    }

    console.log(`[DirectCall] started session ${session.id} (caller=${request.callerUserId})`);
    this.broadcastPresence();
  }

  cancel(socket: Socket, user: SocketUser): void {
    const requestId = this.outgoingByUser.get(user.id);
    const request = requestId ? this.byId.get(requestId) : undefined;
    if (!request) return;
    if (request.callerUserId !== user.id || request.callerSocketId !== socket.id) return;
    this.clear(request);
    for (const socketId of this.presence.socketIds(request.targetUserId)) {
      this.io.to(socketId).emit("call-request-cancelled", {
        requestId: request.id,
        reason: "cancelled",
      });
    }
  }

  /** Clean up a disconnected socket. Presence removal has already happened. */
  handleDisconnect(socket: Socket, targetStillOnline: boolean): void {
    const user = socket.data.user as SocketUser | undefined;
    if (!user) return;

    const outgoingId = this.outgoingByUser.get(user.id);
    const outgoing = outgoingId ? this.byId.get(outgoingId) : undefined;
    if (outgoing && outgoing.callerSocketId === socket.id) {
      this.clear(outgoing);
      for (const socketId of this.presence.socketIds(outgoing.targetUserId)) {
        this.io.to(socketId).emit("call-request-cancelled", {
          requestId: outgoing.id,
          reason: "disconnected",
        });
      }
    }

    if (targetStillOnline) return;
    const incomingId = this.incomingByUser.get(user.id);
    const incoming = incomingId ? this.byId.get(incomingId) : undefined;
    if (!incoming) return;
    this.clear(incoming);
    for (const socketId of this.presence.socketIds(incoming.callerUserId)) {
      this.io.to(socketId).emit("call-request-cancelled", {
        requestId: incoming.id,
        reason: "disconnected",
      });
    }
  }

  private expire(requestId: string): void {
    const request = this.byId.get(requestId);
    if (!request) return;
    this.clear(request);
    for (const socketId of this.presence.socketIds(request.callerUserId)) {
      this.io.to(socketId).emit("call-request-timeout", {
        requestId: request.id,
        peerName: request.targetName,
      });
    }
    for (const socketId of this.presence.socketIds(request.targetUserId)) {
      this.io.to(socketId).emit("call-request-timeout", {
        requestId: request.id,
        peerName: request.callerName,
      });
    }
  }

  private clear(request: PendingRequest): void {
    clearTimeout(request.timer);
    this.byId.delete(request.id);
    if (this.outgoingByUser.get(request.callerUserId) === request.id) {
      this.outgoingByUser.delete(request.callerUserId);
    }
    if (this.incomingByUser.get(request.targetUserId) === request.id) {
      this.incomingByUser.delete(request.targetUserId);
    }
  }
}
