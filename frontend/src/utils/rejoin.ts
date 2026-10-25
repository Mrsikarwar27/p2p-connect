const CLIENT_ID_KEY = "p2p:clientId";
const REJOIN_KEY = "p2p:rejoin";

export function getClientId(): string {
  let id = sessionStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export interface RejoinData {
  code: string;
  name?: string;
  clientId?: string;
}

export function readRejoin(): RejoinData | null {
  try {
    const raw = sessionStorage.getItem(REJOIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RejoinData;
    if (!parsed || typeof parsed.code !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveRejoin(data: RejoinData): void {
  try {
    sessionStorage.setItem(REJOIN_KEY, JSON.stringify(data));
  } catch {
    /* noop */
  }
}

export function clearRejoin(): void {
  try {
    sessionStorage.removeItem(REJOIN_KEY);
  } catch {
    /* noop */
  }
}
