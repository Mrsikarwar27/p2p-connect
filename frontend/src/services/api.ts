import { getSignalingUrl } from "./socket";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  username: string;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  username: string;
  password: string;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  // Same base URL as the socket: VITE_SIGNALING_URL, or same origin in
  // production, or the dev server. Never hardcoded here.
  const base = getSignalingUrl();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${base}${path}`, { ...init, headers });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const authApi = {
  register(input: RegisterInput): Promise<AuthResponse> {
    return request<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  login(email: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },
  me(token: string): Promise<{ user: AuthUser }> {
    return request<{ user: AuthUser }>("/api/auth/me", { method: "GET" }, token);
  },
};
