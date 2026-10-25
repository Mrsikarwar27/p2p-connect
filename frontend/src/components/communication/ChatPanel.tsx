import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../types/message";
import { MessageBubble } from "./MessageBubble";

export function ChatPanel({
  messages,
  channelOpen,
}: {
  messages: ChatMessage[];
  channelOpen: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || messages.length === 0) return;
    const last = messages[messages.length - 1];
    // Measured AFTER the new message is already in the DOM: if the user was
    // at the bottom, only the new message's own height now separates the
    // viewport edge from the true bottom (<160px). If they scrolled up to
    // read, the distance is large — do NOT yank them down. Own messages
    // always scroll to the bottom.
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (last.sender === "local" || distanceFromBottom < 160) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <p className="font-display text-sm font-bold">Secure Chat</p>
        <span className="text-[11px] text-muted">
          {channelOpen ? "Peer-to-peer connection" : "Direct WebRTC connection"}
        </span>
      </div>
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 ? (
          <p className="mt-6 text-center text-sm text-muted">
            {channelOpen
              ? "Connected. Say hello — messages travel directly between peers."
              : "Messages will appear here once the direct connection opens."}
          </p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>
    </div>
  );
}
