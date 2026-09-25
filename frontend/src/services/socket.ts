import { io, type Socket } from "socket.io-client";

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
  socketInstance = io(url, {
    transports: ["websocket", "polling"],
    autoConnect: true,
  });
  return socketInstance;
}

export function getSocket(): Socket {
  if (!socketInstance) return createSocket();
  return socketInstance;
}

export function disconnectSocket(): void {
  socketInstance?.disconnect();
  socketInstance = null;
}
