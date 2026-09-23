import { useEffect, useMemo } from "react";
import { getSocket } from "../services/socket";
import type { Socket } from "socket.io-client";

export function useSocket(): Socket {
  const socket = useMemo(() => getSocket(), []);
  useEffect(() => {
    if (!socket.connected) socket.connect();
  }, [socket]);
  return socket;
}
