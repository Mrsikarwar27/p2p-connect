export interface ChatMessage {
  id: string;
  type: "text";
  text: string;
  timestamp: number;
  sender: "local" | "remote";
}

export function createLocalMessage(text: string): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "text",
    text,
    timestamp: Date.now(),
    sender: "local",
  };
}
