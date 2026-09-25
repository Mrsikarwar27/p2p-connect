import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { existsSync } from "fs";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
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
  }),
);
app.use(express.json());

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

httpServer.listen(env.port, () => {
  console.log(`[signaling] listening on :${env.port} (client: ${env.clientUrl})`);
});
