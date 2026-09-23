import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function ConnectionId({ sessionId }: { sessionId: string | null }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = sessionId;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-widest text-muted">Your Connection ID</p>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 rounded-xl border border-border bg-panel2 px-4 py-3 text-center font-display text-2xl font-bold tracking-[0.2em] text-primary">
          {sessionId ?? "····-····"}
        </div>
        <button
          onClick={copy}
          disabled={!sessionId}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-[#13131B] transition hover:brightness-110 disabled:opacity-40"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? "Copied" : "Copy ID"}
        </button>
      </div>
    </div>
  );
}
