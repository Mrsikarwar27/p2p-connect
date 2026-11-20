const DIRECT_CALL_KEY = "p2p:directCall";

export interface DirectCallData {
  sessionId: string;
  isInitiator: boolean;
  name: string;
}

/**
 * Direct calls keep their session id out of the URL. It lives in this tab's
 * sessionStorage and is used only by the client to join the call.
 */
export function readDirectCall(): DirectCallData | null {
  try {
    const raw = sessionStorage.getItem(DIRECT_CALL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DirectCallData;
    if (!parsed || typeof parsed.sessionId !== "string" || !parsed.sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDirectCall(data: DirectCallData): void {
  try {
    sessionStorage.setItem(DIRECT_CALL_KEY, JSON.stringify(data));
  } catch {
    /* noop */
  }
}

export function clearDirectCall(): void {
  try {
    sessionStorage.removeItem(DIRECT_CALL_KEY);
  } catch {
    /* noop */
  }
}
