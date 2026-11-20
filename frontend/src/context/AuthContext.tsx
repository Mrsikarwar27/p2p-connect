import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, authApi, type AuthUser, type RegisterInput } from "../services/api";
import { setSocketToken } from "../services/socket";
import { readStoredToken, writeStoredToken } from "../utils/authStorage";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  /** True while the saved token is being verified on first load. */
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(() => Boolean(readStoredToken()));

  // Restore the session on load. A 401 means the token is no longer valid
  // (expired/revoked): clear it. Network/503 errors keep it for a later try.
  useEffect(() => {
    const stored = readStoredToken();
    if (!stored) {
      setInitializing(false);
      return;
    }
    let cancelled = false;
    authApi
      .me(stored)
      .then(({ user: me }) => {
        if (cancelled) return;
        setUser(me);
        setToken(stored);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          writeStoredToken(null);
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the socket handshake identity in sync (guests simply have none).
  useEffect(() => {
    setSocketToken(token);
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    writeStoredToken(res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const res = await authApi.register(input);
    writeStoredToken(res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    writeStoredToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, initializing, login, register, logout }),
    [user, token, initializing, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
