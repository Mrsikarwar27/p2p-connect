import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(requireEnv("PORT", "5000")),
  clientUrl: (() => {
    const url = process.env.CLIENT_URL;
    if (url && url.trim() !== "") return url.trim();
    const renderHost = process.env.RENDER_EXTERNAL_HOSTNAME;
    if (renderHost) return `https://${renderHost}`;
    // Same-origin friendly: in production served from same server, allow same origin
    if (process.env.NODE_ENV === "production") {
      return process.env.RENDER_EXTERNAL_URL || "https://p2p-connect.onrender.com";
    }
    return "http://localhost:5173";
  })(),
  nodeEnv: requireEnv("NODE_ENV", "development"),
  // Optional: when absent the server still runs, guest calling works, and
  // only the auth endpoints report themselves as unavailable (503).
  mongodbUri: process.env.MONGODB_URI?.trim() ?? "",
  jwtSecret: process.env.JWT_SECRET?.trim() ?? "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN?.trim() || "7d",
};
