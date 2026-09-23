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
  clientUrl: requireEnv("CLIENT_URL", "http://localhost:5173"),
  nodeEnv: requireEnv("NODE_ENV", "development"),
};
