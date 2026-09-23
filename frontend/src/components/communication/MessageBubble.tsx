import type { ChatMessage } from "../../types/message";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const local = message.sender === "local";
  return (
    <div className={`mb-2 flex ${local ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
          local
            ? "rounded-br-md bg-primary text-[#13131B]"
            : "rounded-bl-md border border-border bg-panel3 text-ink"
        }`}
      >
        <p className="break-words">{message.text}</p>
        <p className={`mt-1 text-[10px] ${local ? "text-[#13131B]/60" : "text-muted"}`}>
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}
