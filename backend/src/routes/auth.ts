import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import { isAuthConfigured, signToken } from "../config/auth.js";
import { isDbConnected } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { User } from "../models/User.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const BCRYPT_COST = 10;

interface PublicUser {
  id: string;
  name: string;
  email: string;
  username: string;
}

function publicUser(doc: {
  _id: unknown;
  name: string;
  email: string;
  username: string;
}): PublicUser {
  return {
    id: String(doc._id),
    name: doc.name,
    email: doc.email,
    username: doc.username,
  };
}

/** Auth needs both a JWT secret and a live database; otherwise 503. */
function authUnavailable(res: Response): boolean {
  if (!isAuthConfigured() || !isDbConnected()) {
    res.status(503).json({ error: "Authentication is temporarily unavailable." });
    return true;
  }
  return false;
}

function isDuplicateKey(err: unknown): err is { code: number; keyPattern?: Record<string, unknown> } {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

function duplicateMessage(keyPattern?: Record<string, unknown>): string {
  if (keyPattern && "username" in keyPattern) return "That username is already taken.";
  if (keyPattern && "email" in keyPattern) return "That email is already registered.";
  return "That email or username is already registered.";
}

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  if (authUnavailable(res)) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!name) {
    res.status(400).json({ error: "Please enter your name." });
    return;
  }
  if (name.length > 60) {
    res.status(400).json({ error: "Name must be 60 characters or fewer." });
    return;
  }
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: "Please enter a valid email address." });
    return;
  }
  if (!USERNAME_RE.test(username)) {
    res.status(400).json({
      error: "Username must be 3-20 characters and use only letters, numbers and underscores.",
    });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  const usernameKey = username.toLowerCase();

  try {
    const emailTaken = await User.exists({ email });
    if (emailTaken) {
      res.status(409).json({ error: "That email is already registered." });
      return;
    }
    const usernameTaken = await User.exists({ username: usernameKey });
    if (usernameTaken) {
      res.status(409).json({ error: "That username is already taken." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await User.create({ name, email, username: usernameKey, passwordHash });

    res.status(201).json({
      user: publicUser(user),
      token: signToken(String(user._id)),
    });
  } catch (err) {
    if (isDuplicateKey(err)) {
      res.status(409).json({ error: duplicateMessage(err.keyPattern) });
      return;
    }
    console.error(`[auth] register failed (${err instanceof Error ? err.name : "UnknownError"})`);
    res.status(500).json({ error: "Could not create the account." });
  }
});

authRouter.post("/login", async (req, res) => {
  if (authUnavailable(res)) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    res.status(400).json({ error: "Please enter your email and password." });
    return;
  }

  try {
    const user = await User.findOne({ email });
    const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) {
      // Same message for unknown email and wrong password.
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    res.status(200).json({
      user: publicUser(user),
      token: signToken(String(user._id)),
    });
  } catch (err) {
    console.error(`[auth] login failed (${err instanceof Error ? err.name : "UnknownError"})`);
    res.status(500).json({ error: "Could not sign in." });
  }
});

authRouter.get("/me", requireAuth, (req, res) => {
  // requireAuth guarantees req.user on success.
  res.status(200).json({ user: req.user });
});
