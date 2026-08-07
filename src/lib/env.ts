import { z } from "zod";

const envSchema = z.object({
  // Required
  ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY is required (openssl rand -base64 32)"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required (openssl rand -base64 32)"),
  // Optional
  DATABASE_PATH: z.string().default("./data/open-finance.db"),
  BIND_ADDRESS: z.string().default("127.0.0.1"),
  PUBLIC_URL: z.string().default("http://localhost:3000"),
  DEMO_MODE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  SEED_DATE: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  CAP_SERVER_URL: z.string().optional(),
  DEFAULT_AGENT_SCOPE: z.string().default("read-only"),
  // Opt-in to sending the session cookie over plain HTTP (NEVER in production).
  // Allowed only for local HTTP development where TLS isn't available.
  ALLOW_INSECURE_COOKIE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration — see errors above.");
}

export const env = parsed.data;
