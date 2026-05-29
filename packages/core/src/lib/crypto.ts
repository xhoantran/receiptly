/**
 * At-rest encryption for sensitive secrets (Plaid access tokens, merchant
 * browser sessions). AES-256-GCM via `node:crypto` — no third-party dependency.
 *
 * The 32-byte key is read from `RECEIPTLY_ENCRYPTION_KEY` (base64). For
 * self-hosting this is a value in the operator's `.env`; the hosted control
 * plane (Phase 4) swaps the `localProvider` below for a KMS-backed provider
 * (the key never leaves the KMS — `encrypt`/`decrypt` become envelope ops).
 *
 * Token format: `v1:` + base64( iv(12) | tag(16) | ciphertext ). The leading
 * version tag lets us rotate algorithms/keys later without ambiguity.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce
const TAG_BYTES = 16; // GCM auth tag
const VERSION = "v1";

/**
 * A swappable encryption backend. `localProvider` does AES-256-GCM in-process
 * with a key from the environment. A KMS-backed provider (hosted, Phase 4)
 * implements the same interface, so the repo layer never changes.
 */
export interface EncryptionProvider {
  encrypt(plaintext: string): string;
  decrypt(token: string): string;
}

function loadKey(): Buffer {
  const b64 = process.env.RECEIPTLY_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error(
      "RECEIPTLY_ENCRYPTION_KEY is not set. Generate a 32-byte base64 key with:\n" +
        "  openssl rand -base64 32\n" +
        "then add it to your environment (e.g. .env): RECEIPTLY_ENCRYPTION_KEY=<value>"
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `RECEIPTLY_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        "Generate a fresh one with: openssl rand -base64 32"
    );
  }
  return key;
}

/**
 * Local, in-process AES-256-GCM provider. The key is read from the environment
 * lazily on first use so importing this module never throws at load time.
 */
export const localProvider: EncryptionProvider = {
  encrypt(plaintext: string): string {
    const key = loadKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, tag, ciphertext]);
    return `${VERSION}:${payload.toString("base64")}`;
  },

  decrypt(token: string): string {
    const key = loadKey();
    const sep = token.indexOf(":");
    if (sep === -1) {
      throw new Error("Malformed ciphertext: missing version prefix.");
    }
    const version = token.slice(0, sep);
    if (version !== VERSION) {
      throw new Error(`Unsupported ciphertext version: ${version}`);
    }
    const payload = Buffer.from(token.slice(sep + 1), "base64");
    if (payload.length < IV_BYTES + TAG_BYTES) {
      throw new Error("Malformed ciphertext: payload too short.");
    }
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  },
};

/** The active provider. Phase 4 swaps this for a KMS-backed implementation. */
export const provider: EncryptionProvider = localProvider;

/** Encrypt a UTF-8 string → versioned base64 token. */
export function encrypt(plaintext: string): string {
  return provider.encrypt(plaintext);
}

/** Decrypt a versioned base64 token → original UTF-8 string. */
export function decrypt(token: string): string {
  return provider.decrypt(token);
}
