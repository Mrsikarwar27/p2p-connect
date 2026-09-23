export const CHUNK_SIZE = 16 * 1024; // 16 KB
export const MAX_BUFFERED = 1024 * 1024; // 1 MB backpressure threshold
export const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GB guard

export function encodeChunk(fileId: string, chunk: ArrayBuffer): ArrayBuffer {
  const idBytes = new TextEncoder().encode(fileId);
  const out = new Uint8Array(2 + idBytes.length + chunk.byteLength);
  const view = new DataView(out.buffer);
  view.setUint16(0, idBytes.length);
  out.set(idBytes, 2);
  out.set(new Uint8Array(chunk), 2 + idBytes.length);
  return out.buffer;
}

export function decodeChunk(buffer: ArrayBuffer): { fileId: string; chunk: ArrayBuffer } {
  const view = new DataView(buffer);
  const idLen = view.getUint16(0);
  const idBytes = new Uint8Array(buffer, 2, idLen);
  const fileId = new TextDecoder().decode(idBytes);
  const chunk = buffer.slice(2 + idLen);
  return { fileId, chunk };
}

export function waitForDrain(dc: RTCDataChannel): Promise<void> {
  if (dc.bufferedAmount <= MAX_BUFFERED) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (dc.bufferedAmount <= MAX_BUFFERED / 2 || dc.readyState !== "open") {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };
    setTimeout(check, 50);
  });
}

export async function sendFileOverChannel(
  file: File,
  fileId: string,
  dc: RTCDataChannel,
  onProgress: (sentBytes: number) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const startMsg = JSON.stringify({
    kind: "file-start",
    fileId,
    name: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
  });
  dc.send(startMsg);

  let offset = 0;
  while (offset < file.size) {
    if (isCancelled()) throw new Error("cancelled");
    if (dc.readyState !== "open") throw new Error("DataChannel closed");
    await waitForDrain(dc);
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buf = await slice.arrayBuffer();
    dc.send(encodeChunk(fileId, buf));
    offset += buf.byteLength;
    onProgress(offset);
  }

  dc.send(JSON.stringify({ kind: "file-end", fileId }));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatId(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export function createFileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
