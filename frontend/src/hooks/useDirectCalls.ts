import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Socket } from "socket.io-client";
import { getClientId } from "../utils/rejoin";
import { saveDirectCall } from "../utils/directCall";
import type {
  CallRequestCancelledEvent,
  CallRequestDeclinedEvent,
  CallRequestErrorEvent,
  CallRequestSentEvent,
  CallRequestTimeoutEvent,
  CallStartedEvent,
  IncomingCallRequestEvent,
  OnlineUser,
} from "../types/signaling";

export interface OutgoingCall {
  targetUserId: string;
  name: string;
  requestId?: string;
}

export interface IncomingCall {
  requestId: string;
  callerUserId: string;
  name: string;
  username: string;
}

const RING_TIMEOUT_MS = 30_000;

/**
 * Presence + direct-call state for a logged-in user. Guests never mount the
 * page that uses this hook, and the server rejects guest call-request events.
 */
export function useDirectCalls(
  socket: Socket,
  userId: string | undefined,
  displayName: string | undefined,
) {
  const navigate = useNavigate();
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingCall | null>(null);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const outgoingRef = useRef<OutgoingCall | null>(null);
  outgoingRef.current = outgoing;
  const incomingRef = useRef<IncomingCall | null>(null);
  incomingRef.current = incoming;

  useEffect(() => {
    if (!socket) return;

    const onUsers = (list: OnlineUser[]) => {
      setUsers(Array.isArray(list) ? list.filter((u) => u.userId !== userId) : []);
    };
    const onSent = (payload: CallRequestSentEvent) => {
      setOutgoing((prev) =>
        prev ? { ...prev, requestId: payload.requestId, name: prev.name || payload.name } : prev,
      );
    };
    const onIncoming = (payload: IncomingCallRequestEvent) => {
      setIncoming(payload);
      setError(null);
    };
    const onDeclined = (payload: CallRequestDeclinedEvent) => {
      const current = outgoingRef.current;
      if (!current) return;
      if (current.requestId && payload.requestId && current.requestId !== payload.requestId) return;
      setOutgoing(null);
      setNotice(`${payload.name || current.name} declined the call`);
    };
    const onTimeout = (payload: CallRequestTimeoutEvent) => {
      const current = outgoingRef.current;
      if (current && (!current.requestId || current.requestId === payload.requestId)) {
        setOutgoing(null);
        setNotice("No answer");
      }
      const ringing = incomingRef.current;
      if (ringing && ringing.requestId === payload.requestId) {
        setIncoming(null);
      }
    };
    const onCancelled = (payload: CallRequestCancelledEvent) => {
      const ringing = incomingRef.current;
      if (ringing && (!payload.requestId || ringing.requestId === payload.requestId)) {
        setIncoming(null);
      }
      const current = outgoingRef.current;
      if (current && current.requestId && current.requestId === payload.requestId) {
        setOutgoing(null);
        setNotice(`${current.name} is no longer available`);
      }
    };
    const onError = (payload: CallRequestErrorEvent) => {
      setError(payload.message);
      setOutgoing(null);
    };
    const onStarted = (payload: CallStartedEvent) => {
      setOutgoing(null);
      setIncoming(null);
      setNotice(null);
      setError(null);
      // The session id is internal to the clients: keep it in this tab's
      // sessionStorage and open the call page WITHOUT the id in the URL.
      saveDirectCall({
        sessionId: payload.sessionId,
        isInitiator: payload.role === "initiator",
        name: displayName ?? "",
      });
      navigate("/call", { replace: true });
    };
    const subscribe = () => socket.emit("presence-subscribe");

    socket.on("online-users", onUsers);
    socket.on("call-request-sent", onSent);
    socket.on("incoming-call-request", onIncoming);
    socket.on("call-request-declined", onDeclined);
    socket.on("call-request-timeout", onTimeout);
    socket.on("call-request-cancelled", onCancelled);
    socket.on("call-request-error", onError);
    socket.on("call-started", onStarted);
    socket.on("connect", subscribe);
    if (socket.connected) subscribe();

    return () => {
      socket.off("online-users", onUsers);
      socket.off("call-request-sent", onSent);
      socket.off("incoming-call-request", onIncoming);
      socket.off("call-request-declined", onDeclined);
      socket.off("call-request-timeout", onTimeout);
      socket.off("call-request-cancelled", onCancelled);
      socket.off("call-request-error", onError);
      socket.off("call-started", onStarted);
      socket.off("connect", subscribe);
    };
  }, [socket, userId, displayName, navigate]);

  // Client-side safety net: the server also expires/cancels at 30s.
  useEffect(() => {
    if (!outgoing) return;
    const timer = window.setTimeout(() => {
      setOutgoing(null);
      setNotice("No answer");
    }, RING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [outgoing]);

  useEffect(() => {
    if (!incoming) return;
    const timer = window.setTimeout(() => setIncoming(null), RING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [incoming]);

  const connect = useCallback(
    (target: OnlineUser) => {
      if (!userId || outgoingRef.current || target.busy) return;
      setError(null);
      setNotice(null);
      setOutgoing({ targetUserId: target.userId, name: target.name });
      socket.emit("call-request", {
        targetUserId: target.userId,
        clientId: getClientId(),
      });
    },
    [socket, userId],
  );

  const cancel = useCallback(() => {
    const current = outgoingRef.current;
    socket.emit("call-request-cancel", { requestId: current?.requestId });
    setOutgoing(null);
    setNotice("Call cancelled.");
  }, [socket]);

  const respond = useCallback(
    (action: "accept" | "decline") => {
      const request = incomingRef.current;
      if (!request) return;
      setIncoming(null);
      socket.emit("call-request-response", {
        requestId: request.requestId,
        action,
        clientId: getClientId(),
      });
      if (action === "decline") setNotice("Call declined.");
    },
    [socket],
  );

  return {
    users,
    outgoing,
    incoming,
    notice,
    error,
    connect,
    cancel,
    respond,
    clearNotice: () => setNotice(null),
  };
}
