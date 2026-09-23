import { io, type Socket } from "socket.io-client";

let socketInstance: Socket | null = null;

export function getSignalingUrl(): string {
  const url = import.meta.env.VITE_SIGNALING_URL as string | undefined;
  return url ?? "http://localhost:5000";
}

export function createSocket(): Socket {
  if (socketInstance?.connected) return socketInstance;
  if (socketInstance) {
    socketInstance.disconnect();
  }
  socketInstance = io(getSignalingUrl(), {
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
