export type FileTransferStatus =
  | "sending"
  | "receiving"
  | "completed"
  | "failed"
  | "cancelled";

export interface FileTransferState {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  direction: "send" | "receive";
  progress: number; // 0-100
  status: FileTransferStatus;
  receivedBytes: number;
  blobUrl?: string;
  error?: string;
}

export type ControlMessage =
  | { kind: "chat"; id: string; text: string; timestamp: number }
  | {
      kind: "file-start";
      fileId: string;
      name: string;
      size: number;
      mimeType: string;
    }
  | { kind: "file-end"; fileId: string };
