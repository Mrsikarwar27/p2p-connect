import { useState } from "react";
import { Paperclip, Send } from "lucide-react";

export function MessageInput({
  onSend,
  onAttach,
  disabled,
}: {
  onSend: (text: string) => boolean;
  onAttach: () => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    if (!value.trim()) return;
    const ok = onSend(value);
    if (ok) setValue("");
  };

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-center gap-2">
        <button
          onClick={onAttach}
          disabled={disabled}
          title="Share file"
          className="rounded-lg border border-border bg-panel3 p-2.5 text-muted transition hover:text-ink disabled:opacity-40"
        >
          <Paperclip size={16} />
        </button>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={disabled ? "Connecting..." : "Type a message..."}
          disabled={disabled}
          maxLength={4000}
          className="min-w-0 flex-1 rounded-xl border border-border bg-panel2 px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/60 focus:border-primary/60 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-[#13131B] transition hover:brightness-110 disabled:opacity-40"
        >
          <span className="flex items-center gap-1.5">
            <Send size={14} /> Send
          </span>
        </button>
      </div>
    </div>
  );
}
