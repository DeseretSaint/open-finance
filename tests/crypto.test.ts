import { describe, expect, it } from "vitest";
import { decrypt, encrypt, hashSecret, safeEqual } from "@/lib/crypto";

describe("crypto", () => {
  it("roundtrips plaintext with AAD", () => {
    const envelope = encrypt("super-secret-plaid-key", "user:1:cred:2");
    expect(envelope).not.toContain("super-secret-plaid-key");
    expect(decrypt(envelope, "user:1:cred:2")).toBe("super-secret-plaid-key");
  });

  it("produces unique ciphertexts for the same input (random IV)", () => {
    const a = encrypt("same", "u:r");
    const b = encrypt("same", "u:r");
    expect(a).not.toBe(b);
  });

  it("rejects tampered ciphertext (auth tag)", () => {
    const envelope = encrypt("value", "u:r");
    const buf = Buffer.from(envelope, "base64");
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;
    expect(() => decrypt(buf.toString("base64"), "u:r")).toThrow();
  });

  it("rejects a different AAD", () => {
    const envelope = encrypt("value", "u:r");
    expect(() => decrypt(envelope, "u:OTHER")).toThrow();
  });

  it("hashes secrets deterministically (sha256 hex)", () => {
    expect(hashSecret("of_abc")).toBe(hashSecret("of_abc"));
    expect(hashSecret("of_abc")).not.toBe(hashSecret("of_abd"));
  });

  it("compares tokens in constant time", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});
