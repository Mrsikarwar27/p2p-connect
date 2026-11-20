import jwt from "jsonwebtoken";
import { env } from "./env.js";

/**
 * Auth is OPTIONAL. With no JWT_SECRET the auth endpoints return 503 and
 * the rest of the app keeps working for guests.
 */
export function isAuthConfigured(): boolean {
  return env.jwtSecret.length > 0;
}

export function signToken(userId: string): string {
  return jwt.sign({ id: userId }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

/** Returns the user id carried by a valid token, or null. Never throws. */
export function verifyToken(token: string): string | null {
  if (!isAuthConfigured() || !token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    if (typeof payload === "object" && payload !== null && typeof payload.id === "string") {
      return payload.id;
    }
    return null;
  } catch {
    return null;
  }
}
