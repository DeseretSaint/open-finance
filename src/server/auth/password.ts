import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

// A small embedded top-password list (the full top-1000 lives in code docs);
// this blocks the most common failures without a data dependency.
const WEAK_PASSWORDS = new Set([
  "password", "12345678", "123456789", "qwertyuiop", "abc123456", "letmein1",
  "iloveyou1", "admin1234", "welcome1", "monkey123", "dragon123", "passw0rd",
  "password1", "baseball1", "football1", "sunshine1", "princess1", "trustno1",
]);

/** Returns an error message, or null if the password is acceptable. */
export function validatePasswordPolicy(password: string, username?: string | null): string | null {
  const bytes = Buffer.byteLength(password, "utf8");
  if (bytes < 10) return "Password must be at least 10 characters.";
  if (bytes > 72) return "Password must be at most 72 bytes.";
  if (username && password.toLowerCase() === username.toLowerCase()) {
    return "Password cannot be the same as your username.";
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    return "That password is too common — choose a unique one.";
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
