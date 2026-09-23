import { Download, FileIcon, X } from "lucide-react";
import type { FileTransferState } from "../../types/file";
import { formatBytes } from "../../services/fileTransfer";
import { FileTransferProgress } from "./FileTransferProgress";

export function FileTransferCard({
  transfer,
  onCancel,
}: {
  transfer: FileTransferState;
  onCancel: (fileId: string) => void;
}) {
  const active = transfer.status === "sending" || transfer.status === "receiving";
  return (
    <div className="rounded-xl border border-border bg-panel2 p-3">
      <div className="flex items-start gap-2.5">
        <div className="rounded-lg bg-panel3 p-2 text-secondary">
          <FileIcon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{transfer.name}</p>
          <p className="text-xs text-muted">
            {formatBytes(transfer.size)} ·{" "}
            {transfer.status === "sending"
              ? "Sending..."
              : transfer.status === "receiving"
                ? "Receiving..."
                : transfer.status === "completed"
                  ? "Completed"
                  : transfer.status === "cancelled"
                    ? "Cancelled"
                    : transfer.error ?? "Failed"}
          </p>
          <FileTransferProgress value={transfer.progress} />
        </div>
        {active ? (
          <button
            onClick={() => onCancel(transfer.fileId)}
            title="Cancel"
            className="rounded-md p-1 text-muted hover:text-ink"
          >
            <X size={14} />
          </button>
        ) : transfer.status === "completed" && transfer.blobUrl ? (
          <a
            href={transfer.blobUrl}
            download={transfer.name}
            className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-[#13131B] hover:brightness-110"
          >
            <Download size={13} /> Download
          </a>
        ) : null}
      </div>
    </div>
  );
}
