import type { NextFunction, Request, Response } from "express";
import { isAuthConfigured, verifyToken } from "../config/auth.js";
import { isDbConnected } from "../config/db.js";
import { User } from "../models/User.js";
import type { AuthUser } from "../types/auth.js";

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token.trim() || null;
}

/** Look up the account behind a token. Returns null for any failure. */
export async function resolveUserFromToken(token: string): Promise<AuthUser | null> {
  if (!isAuthConfigured() || !isDbConnected()) return null;
  const id = verifyToken(token);
  if (!id) return null;
  try {
    const doc = await User.findById(id).select("name email username").lean();
    if (!doc) return null;
    return {
      id: String(doc._id),
      name: doc.name,
      email: doc.email,
      username: doc.username,
    };
  } catch {
    return null;
  }
}

/** 401 for missing/invalid tokens; 503 when auth is not configured/DB is down. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!isAuthConfigured() || !isDbConnected()) {
    res.status(503).json({ error: "Authentication is temporarily unavailable." });
    return;
  }
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const user = await resolveUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.user = user;
  next();
}

/** Attaches req.user when a valid token is present; never rejects. */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearerToken(req);
  if (token) {
    const user = await resolveUserFromToken(token);
    if (user) req.user = user;
  }
  next();
}
