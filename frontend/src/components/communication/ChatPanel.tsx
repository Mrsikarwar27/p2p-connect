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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="font-display text-sm font-bold">Secure Chat</p>
        <span className="text-[11px] text-muted">
          {channelOpen ? "Peer-to-peer connection" : "Direct WebRTC connection"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="mt-6 text-center text-sm text-muted">
            {channelOpen
              ? "Connected. Say hello — messages travel directly between peers."
              : "Messages will appear here once the direct connection opens."}
          </p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
