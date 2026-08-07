import { z } from "zod";

const envSchema = z.object({
  // Required for server-side field encryption and session tokens. On a
  // standalone phone these are provided by the device at runtime; on a hub
  // they come from .env. We NO LONGER hard-throw at module load: a missing
  // key must not brick every route (that turned the whole app into a
  // lockout — the landing page's /api/device/status 500'd and fell back to
  // "Create an account"). A missing key is surfaced loudly by crypto.key()
  // only when encryption is actually attempted, and the server-side
  // bootstrap (src/server/env-bootstrap) auto-generates stable keys on first
  // run so self-hosters are never required to hand-provision secrets.
  ENCRYPTION_KEY: z.string().default(""),
  AUTH_SECRET: z.string().default(""),
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
  console.error("Invalid environment (continuing with defaults):", parsed.error.flatten().fieldErrors);
}

// Fallback so the app can at least boot and serve routes that don't need a
// key. A missing required key is surfaced loudly by crypto.key() at the moment
// encryption is actually used, not at import time.
export const env: z.infer<typeof envSchema> =
  parsed.success ? parsed.data : (envSchema.parse({}) as z.infer<typeof envSchema>);

if (!env.ENCRYPTION_KEY || !env.AUTH_SECRET) {
  console.warn(
    "[env] ENCRYPTION_KEY / AUTH_SECRET are not set. The server bootstrap will generate stable keys on first run; until then server-side encryption/sessions use an insecure fallback.",
  );
}
