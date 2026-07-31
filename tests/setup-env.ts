// Global test env (runs once before all tests). Must export a function in vitest 4.
export default function setup(): void {
  process.env.ENCRYPTION_KEY = "test-encryption-key-0123456789abcdef";
  process.env.AUTH_SECRET = "test-auth-secret-0123456789abcdef";
  process.env.DATABASE_PATH = ":memory:";
}
