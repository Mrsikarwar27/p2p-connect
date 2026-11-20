import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { existsSync } from "fs";
import { env } from "./config/env.js";
import { connectDatabase } from "./config/db.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { SessionManager } from "./socket/sessionManager.js";
import { setupSignaling } from "./socket/signaling.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distPath = resolve(__dirname, "../../frontend/dist");

const app = express();

app.use(
  cors({
    origin: env.clientUrl,
    methods: ["GET", "POST"],
    credentials: true,
  }),
);
app.use(express.json());

// Optional accounts. Guests never touch these routes; if auth is not
// configured they return 503 and the rest of the app is unaffected.
app.use("/api/auth", authRouter);

// Serve frontend static files in production
if (env.nodeEnv === "production") {
  app.use(express.static(distPath));
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "p2p-connect-signaling" });
});

// Catch-all: serve index.html for SPA routes (production only)
if (env.nodeEnv === "production") {
  app.get("*", (_req, res) => {
    const indexPath = join(distPath, "index.html");
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(500).send("Frontend not built. Check build output.");
    }
  });
}

app.use(errorHandler);

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: env.clientUrl,
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const sessions = new SessionManager();
setupSignaling(io, sessions);

async function start(): Promise<void> {
  // Never fatal: without a database the server still runs for guests.
  await connectDatabase();
  httpServer.listen(env.port, () => {
    console.log(`[signaling] listening on :${env.port} (client: ${env.clientUrl})`);
  });
}

void start();
