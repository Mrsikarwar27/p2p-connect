import mongoose from "mongoose";
import { env } from "./env.js";

/**
 * MongoDB is OPTIONAL. The app must keep working for guests when the
 * database is not configured or unreachable, so this module never throws:
 * it only reports whether the connection is usable.
 */
export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function connectDatabase(): Promise<void> {
  if (!env.mongodbUri) {
    console.warn("[db] MONGODB_URI not set - running without database (guest mode only).");
    return;
  }
  try {
    await mongoose.connect(env.mongodbUri, {
      dbName: "p2p-connect",
      serverSelectionTimeoutMS: 5000,
    });
    console.log("MongoDB connected");
  } catch (err) {
    // Never log the connection string (it may contain credentials).
    const name = err instanceof Error ? err.name : "UnknownError";
    console.error(`[db] MongoDB connection failed (${name}) - continuing without database.`);
  }
}
