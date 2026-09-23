import { useEffect } from "react";
import { useWebRTC } from "./useWebRTC";

export function useFileTransfer(peer: ReturnType<typeof useWebRTC>) {
  useEffect(() => {
    return () => {
      for (const t of peer.transfers) {
        if (t.blobUrl) URL.revokeObjectURL(t.blobUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    transfers: peer.transfers,
    sendFile: peer.sendFile,
    cancelTransfer: peer.cancelTransfer,
    channelOpen: peer.channelOpen,
  };
}
