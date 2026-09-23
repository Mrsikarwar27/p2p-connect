import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { PeerConnectionManager, CHAT_LABEL, FILE_LABEL, LEGACY_LABEL } from "../services/webrtc";
import {
  createFileId,
  decodeChunk,
  sendFileOverChannel,
  MAX_BUFFERED,
  MAX_FILE_SIZE,
} from "../services/fileTransfer";
import type { ChatMessage } from "../types/message";
import type { ControlMessage, FileTransferState } from "../types/file";
import type { ConnectionState } from "../types/webrtc";
import type {
  AnswerEvent,
  IceEvent,
  OfferEvent,
  PeerLeftEvent,
} from "../types/signaling";

interface UseWebRTCOptions {
  socket: Socket;
  sessionId: string;
  isInitiator: boolean;
}

interface IncomingFile {
  name: string;
  size: number;
  mimeType: string;
  chunks: ArrayBuffer[];
  received: number;
}

export type DataChannelStatus = "connecting" | "open" | "closed" | "failed";

function mapPcState(s: RTCPeerConnectionState): ConnectionState {
  if (s === "connected") return "connected";
  if (s === "connecting") return "connecting";
  if (s === "failed" || s === "disconnected") return "failed";
  if (s === "closed") return "ended";
  return "connecting";
}

export function useWebRTC({ socket, sessionId, isInitiator }: UseWebRTCOptions) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [channelOpen, setChannelOpen] = useState(false);
  const [chatState, setChatState] = useState<DataChannelStatus>("connecting");
  const [fileState, setFileState] = useState<DataChannelStatus>("connecting");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [transfers, setTransfers] = useState<FileTransferState[]>([]);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const managerRef = useRef<PeerConnectionManager | null>(null);
  const incomingRef = useRef(new Map<string, IncomingFile>());
  const cancelledRef = useRef(new Set<string>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteMediaRef = useRef(new MediaStream());
  const roleRef = useRef(isInitiator);
  roleRef.current = isInitiator;

  const updateTransfer = useCallback((fileId: string, patch: Partial<FileTransferState>) => {
    setTransfers((prev) => prev.map((t) => (t.fileId === fileId ? { ...t, ...patch } : t)));
  }, []);

  const handleControlMessage = useCallback(
    (msg: ControlMessage) => {
      if (msg.kind === "chat") {
        setMessages((prev) => [
          ...prev,
          {
            id: msg.id,
            type: "text",
            text: msg.text,
            timestamp: msg.timestamp,
            sender: "remote",
          },
        ]);
      } else if (msg.kind === "file-start") {
        incomingRef.current.set(msg.fileId, {
          name: msg.name,
          size: msg.size,
          mimeType: msg.mimeType,
          chunks: [],
          received: 0,
        });
        setTransfers((prev) => [
          ...prev,
          {
            fileId: msg.fileId,
            name: msg.name,
            size: msg.size,
            mimeType: msg.mimeType,
            direction: "receive",
            progress: 0,
            status: "receiving",
            receivedBytes: 0,
          },
        ]);
      } else if (msg.kind === "file-end") {
        if (cancelledRef.current.has(msg.fileId)) {
          incomingRef.current.delete(msg.fileId);
          updateTransfer(msg.fileId, { status: "cancelled" });
          return;
        }
        const incoming = incomingRef.current.get(msg.fileId);
        if (!incoming) return;
        try {
          const blob = new Blob(incoming.chunks, {
            type: incoming.mimeType || "application/octet-stream",
          });
          const blobUrl = URL.createObjectURL(blob);
          incomingRef.current.delete(msg.fileId);
          updateTransfer(msg.fileId, {
            status: "completed",
            progress: 100,
            receivedBytes: incoming.size,
            blobUrl,
          });
        } catch {
          incomingRef.current.delete(msg.fileId);
          updateTransfer(msg.fileId, { status: "failed", error: "Could not assemble file." });
        }
      }
    },
    [updateTransfer],
  );

  const handleDataMessage = useCallback(
    (ev: MessageEvent) => {
      const data = ev.data as string | ArrayBuffer | Blob;
      if (typeof data === "string") {
        try {
          const msg = JSON.parse(data) as ControlMessage;
          handleControlMessage(msg);
        } catch {
          console.warn("Unknown text message on DataChannel");
        }
        return;
      }
      const toBuffer = async (): Promise<ArrayBuffer | null> => {
        if (data instanceof ArrayBuffer) return data;
        if (data instanceof Blob) return data.arrayBuffer();
        return null;
      };
      void toBuffer().then((buf) => {
        if (!buf) return;
        try {
          const { fileId, chunk } = decodeChunk(buf);
          if (cancelledRef.current.has(fileId)) return;
          const incoming = incomingRef.current.get(fileId);
          if (!incoming) return;
          incoming.chunks.push(chunk);
          incoming.received += chunk.byteLength;
          const progress =
            incoming.size > 0 ? Math.min(100, (incoming.received / incoming.size) * 100) : 0;
          updateTransfer(fileId, { progress, receivedBytes: incoming.received });
        } catch (err) {
          console.warn("Failed to decode chunk", err);
        }
      });
    },
    [handleControlMessage, updateTransfer],
  );

  const bindChannel = useCallback(
    (channel: RTCDataChannel) => {
      const label = channel.label;
      const isChat = label === CHAT_LABEL || label === LEGACY_LABEL;
      const isFile = label === FILE_LABEL;
      channel.binaryType = "arraybuffer";
      if (isFile) {
        try {
          channel.bufferedAmountLowThreshold = MAX_BUFFERED;
        } catch {
          /* noop — not supported everywhere */
        }
      }
      channel.onmessage = handleDataMessage;
      channel.onopen = () => {
        console.log(`[WebRTC] DataChannel opened: ${label}`);
        if (isChat) {
          setChatState("open");
          setChannelOpen(true);
          // Clear any prior transient channel error once actually open.
          setError((prev) =>
            prev === "Data channel error. Messaging may be unavailable." ? null : prev,
          );
        } else if (isFile) {
          setFileState("open");
        }
      };
      channel.onclose = () => {
        console.log(`[WebRTC] DataChannel closed: ${label}`);
        if (isChat) {
          setChatState("closed");
          setChannelOpen(false);
        } else if (isFile) {
          setFileState("closed");
        }
      };
      channel.onerror = (event) => {
        console.error("[WebRTC] Chat DataChannel error", event);
        console.error("[WebRTC] DataChannel error", label, event);
        if (isChat) {
          setChatState("failed");
          setError("Data channel error. Messaging may be unavailable.");
        } else if (isFile) {
          setFileState("failed");
        }
      };
      // Reflect current state without treating "connecting" as failure.
      if (channel.readyState === "open") {
        if (isChat) {
          setChatState("open");
          setChannelOpen(true);
        } else if (isFile) {
          setFileState("open");
        }
      } else if (channel.readyState === "connecting") {
        if (isChat) {
          setChatState("connecting");
          setChannelOpen(false);
        } else if (isFile) {
          setFileState("connecting");
        }
      }
    },
    [handleDataMessage],
  );

  const lastOfferAt = useRef(0);

  const sendOffer = useCallback(async () => {
    const manager = managerRef.current;
    if (!manager) return;
    if (!roleRef.current) return;
    // Throttle: re-join events can trigger duplicate offers; skip rapid repeats.
    const now = Date.now();
    if (now - lastOfferAt.current < 1000) return;
    lastOfferAt.current = now;
    try {
      // Role may have been learned from signaling after PC creation —
      // ensure initiator channels exist before offering.
      manager.ensureDataChannels(true);
      if (manager.chatChannel) bindChannel(manager.chatChannel);
      if (manager.fileChannel) bindChannel(manager.fileChannel);
      console.log("[WebRTC] Creating offer");
      const offer = await manager.createOffer();
      console.log("[DEBUG] offer created", { sessionId, socketId: socket.id });
      console.log("[WebRTC] Offer sent");
      socket.emit("webrtc-offer", { sessionId, offer });
    } catch (err) {
      console.error("Failed to create offer", err);
      setError("Failed to start peer connection.");
      setConnectionState("failed");
    }
  }, [sessionId, socket, bindChannel]);

  // Main setup effect — exactly ONE RTCPeerConnection per mount.
  useEffect(() => {
    console.log("[DEBUG] useWebRTC mount: WebRTC initialization starts", {
      sessionId,
      socketId: socket.id,
      isInitiator: roleRef.current,
    });
    console.log("[WebRTC] Creating RTCPeerConnection");
    const manager = new PeerConnectionManager();
    managerRef.current = manager;

    remoteMediaRef.current = new MediaStream();
    setRemoteStream(remoteMediaRef.current);

    manager.onIceCandidate = (candidate) => {
      console.log("[DEBUG] ICE candidate sent", { sessionId, socketId: socket.id });
      console.log("[WebRTC] ICE candidate sent");
      socket.emit("ice-candidate", {
        sessionId,
        candidate: candidate.toJSON(),
      });
    };

    manager.onConnectionState = (state) => {
      setConnectionState(mapPcState(state));
      if (state === "failed") {
        setError("Unable to establish a direct connection.");
      }
    };

    manager.onTrack = (ev) => {
      const ms = remoteMediaRef.current;
      const tracks = ev.streams[0]?.getTracks() ?? (ev.track ? [ev.track] : []);
      for (const track of tracks) {
        if (!ms.getTracks().some((t) => t.id === track.id)) {
          ms.addTrack(track);
        }
      }
      // Create a new MediaStream wrapper so React re-renders (same ref would bail out).
      setRemoteStream(new MediaStream(ms.getTracks()));
    };

    manager.onDataChannel = (channel) => {
      bindChannel(channel);
    };

    manager.onChannelOpen = () => setChannelOpen(true);

    const pc = manager.create(roleRef.current);
    console.log("[DEBUG] RTCPeerConnection created", {
      sessionId,
      socketId: socket.id,
      isInitiator: roleRef.current,
    });
    pc.onnegotiationneeded = () => {
      // Only the initiator renegotiates to avoid glare.
      if (!roleRef.current) return;
      if (!pc.localDescription) return;
      void (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("webrtc-offer", { sessionId, offer });
        } catch (err) {
          console.warn("Renegotiation failed", err);
        }
      })();
    };

    // Attach any existing local stream (media is optional — DataChannel works without it)
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        try {
          pc.addTrack(track, localStreamRef.current);
        } catch (err) {
          console.warn("addTrack failed", err);
        }
      }
    }

    if (manager.chatChannel) bindChannel(manager.chatChannel);
    if (manager.fileChannel) bindChannel(manager.fileChannel);
    // Legacy single-channel interop
    if (manager.dataChannel && manager.dataChannel.label === LEGACY_LABEL) {
      bindChannel(manager.dataChannel);
    }

    const onOffer = async (payload: OfferEvent) => {
      if (payload.sessionId !== sessionId) return;
      console.log("[DEBUG] offer received", { sessionId, socketId: socket.id });
      try {
        console.log("[WebRTC] Offer received");
        // Ensure local tracks attached before answering
        if (localStreamRef.current && manager.pc) {
          const existing = new Set(
            manager.pc.getSenders().map((s) => s.track?.id).filter(Boolean),
          );
          for (const track of localStreamRef.current.getTracks()) {
            if (!existing.has(track.id)) {
              try {
                manager.pc.addTrack(track, localStreamRef.current);
              } catch {
                /* noop */
              }
            }
          }
        }
        const answer = await manager.handleOffer(payload.offer);
        console.log("[DEBUG] answer created", { sessionId, socketId: socket.id });
        console.log("[WebRTC] Answer sent");
        socket.emit("webrtc-answer", { sessionId, answer });
        setConnectionState("connecting");
      } catch (err) {
        console.error("handleOffer failed", err);
        setError("Failed to accept connection.");
        setConnectionState("failed");
      }
    };

    const onAnswer = async (payload: AnswerEvent) => {
      if (payload.sessionId !== sessionId) return;
      console.log("[DEBUG] answer received", { sessionId, socketId: socket.id });
      try {
        console.log("[WebRTC] Answer received");
        await manager.handleAnswer(payload.answer);
        console.log("[WebRTC] Answer applied");
      } catch (err) {
        console.error("handleAnswer failed", err);
        setError("Failed to establish connection.");
        setConnectionState("failed");
      }
    };

    const onIce = (payload: IceEvent) => {
      if (payload.sessionId !== sessionId) return;
      console.log("[DEBUG] ICE candidate received", { sessionId, socketId: socket.id });
      console.log("[WebRTC] ICE candidate received");
      void manager.addIceCandidate(payload.candidate);
    };

    const onPeerLeft = (payload: PeerLeftEvent) => {
      if (payload.sessionId !== sessionId) return;
      console.log("[DEBUG] peer-left received", { sessionId, socketId: socket.id });
      console.log("[WebRTC] Peer disconnected");
      setConnectionState("ended");
      setChannelOpen(false);
      setChatState("closed");
      setFileState("closed");
      // Clear remote video so UI returns to "Waiting for remote video..."
      remoteMediaRef.current = new MediaStream();
      setRemoteStream(remoteMediaRef.current);
    };

    socket.on("webrtc-offer", onOffer);
    socket.on("webrtc-answer", onAnswer);
    socket.on("ice-candidate", onIce);
    socket.on("peer-left", onPeerLeft);

    // Initiator creates offer immediately if peer already present is handled by caller.
    // Caller should invoke sendOffer() when peer-joined arrives (or right away for joiner retry).
    return () => {
      console.log("[DEBUG] useWebRTC unmount: effect cleanup", {
        sessionId,
        socketId: socket.id,
      });
      socket.off("webrtc-offer", onOffer);
      socket.off("webrtc-answer", onAnswer);
      socket.off("ice-candidate", onIce);
      socket.off("peer-left", onPeerLeft);
      console.log("[DEBUG] WEBRTC CLEANUP CALLED", {
        reason: "useWebRTC-effect-cleanup",
        sessionId,
        socketId: socket.id,
        connectionState: manager.pc?.connectionState ?? null,
        iceConnectionState: manager.pc?.iceConnectionState ?? null,
      });
      manager.cleanup("useWebRTC-effect-cleanup");
      managerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, socket]);

  const setLocalStream = useCallback(
    (stream: MediaStream | null) => {
      localStreamRef.current = stream;
      const pc = managerRef.current?.pc;
      if (!pc || !stream) return;
      const existing = new Set(
        pc.getSenders().map((s) => s.track?.id).filter(Boolean),
      );
      let added = false;
      for (const track of stream.getTracks()) {
        if (!existing.has(track.id)) {
          try {
            pc.addTrack(track, stream);
            added = true;
          } catch (err) {
            console.warn("addTrack failed", err);
          }
        }
      }
      if (added && roleRef.current && pc.localDescription && pc.remoteDescription) {
        void (async () => {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit("webrtc-offer", { sessionId, offer });
          } catch (err) {
            console.warn("Renegotiation after adding tracks failed", err);
          }
        })();
      }
    },
    [sessionId, socket],
  );

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      const manager = managerRef.current;
      if (!manager?.isChannelOpen()) return false;
      const msg = {
        kind: "chat",
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: trimmed.slice(0, 4000),
        timestamp: Date.now(),
      };
      try {
        manager.sendText(JSON.stringify(msg));
        setMessages((prev) => [
          ...prev,
          {
            id: msg.id,
            type: "text",
            text: msg.text,
            timestamp: msg.timestamp,
            sender: "local",
          },
        ]);
        return true;
      } catch {
        setError("Message could not be sent. Channel is not open.");
        return false;
      }
    },
    [],
  );

  const sendFile = useCallback(
    async (file: File) => {
      const manager = managerRef.current;
      if (!manager?.isFileChannelOpen() || !manager.fileChannel) {
        setError("File sharing is unavailable until the direct connection opens.");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError("File is too large (max 1 GB).");
        return;
      }
      const fileId = createFileId();
      setTransfers((prev) => [
        ...prev,
        {
          fileId,
          name: file.name,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
          direction: "send",
          progress: 0,
          status: "sending",
          receivedBytes: 0,
        },
      ]);
      try {
        await sendFileOverChannel(
          file,
          fileId,
          manager.fileChannel,
          (sent) => {
            updateTransfer(fileId, {
              progress: file.size > 0 ? Math.min(100, (sent / file.size) * 100) : 0,
              receivedBytes: sent,
            });
          },
          () => cancelledRef.current.has(fileId),
        );
        if (cancelledRef.current.has(fileId)) {
          updateTransfer(fileId, { status: "cancelled" });
          cancelledRef.current.delete(fileId);
        } else {
          updateTransfer(fileId, { status: "completed", progress: 100, receivedBytes: file.size });
        }
      } catch (err) {
        if ((err as Error).message === "cancelled") {
          updateTransfer(fileId, { status: "cancelled" });
        } else {
          console.error("sendFile failed", err);
          updateTransfer(fileId, { status: "failed", error: "Transfer failed." });
        }
      }
    },
    [updateTransfer],
  );

  const cancelTransfer = useCallback(
    (fileId: string) => {
      cancelledRef.current.add(fileId);
      updateTransfer(fileId, { status: "cancelled" });
    },
    [updateTransfer],
  );

  return {
    connectionState,
    setConnectionState,
    channelOpen,
    chatState,
    fileState,
    messages,
    transfers,
    remoteStream,
    error,
    setError,
    sendMessage,
    sendFile,
    cancelTransfer,
    sendOffer,
    setLocalStream,
    managerRef,
  };
}
