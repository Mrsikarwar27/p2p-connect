import { io, type Socket } from "socket.io-client";
import { readStoredToken } from "../utils/authStorage";

let socketInstance: Socket | null = null;

export function getSignalingUrl(): string {
  const url = import.meta.env.VITE_SIGNALING_URL as string | undefined;
  if (url) return url;
  // In production (served from same origin as backend), use relative URL
  if (import.meta.env.PROD) return "";
  return "http://localhost:5000";
}

export function createSocket(): Socket {
  if (socketInstance?.connected) return socketInstance;
  if (socketInstance) {
    socketInstance.disconnect();
  }
  const url = getSignalingUrl();
  const token = readStoredToken();
  socketInstance = io(url, {
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    // Optional identity. Without a token the handshake is exactly the guest
    // handshake the app has always used.
    auth: token ? { token } : {},
  });
  return socketInstance;
}

/**
 * Applies a token to the existing socket. Only reconnects when the token
 * actually changes, so guest sessions are never disturbed.
 */
export function setSocketToken(token: string | null): void {
  if (!socketInstance) return;
  const next = token ?? "";
  const current = (socketInstance.auth as { token?: string }).token ?? "";
  if (current === next) return;
  socketInstance.auth = next ? { token: next } : {};
  if (socketInstance.connected) {
    socketInstance.disconnect();
    socketInstance.connect();
  }
}

export function getSocket(): Socket {
  if (!socketInstance) return createSocket();
  return socketInstance;
}

export function disconnectSocket(): void {
  socketInstance?.disconnect();
  socketInstance = null;
}
