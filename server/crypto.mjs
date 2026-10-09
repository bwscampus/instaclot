// Field-level encryption for waitlist PII (Production Standard DB-9).
//
// Names and emails are encrypted with AES-256-GCM before they reach the database, so a leaked
// DATABASE_URL or a downloaded backup shows only ciphertext. Emails also get a blind index
// (HMAC-SHA256 under a separate key) so the database can still enforce "one signup per address"
// without ever holding the address itself.
//
// Keys come from the environment as 64 hex characters (32 bytes):
//   WAITLIST_ENC_KEY    encrypts and decrypts
//   WAITLIST_INDEX_KEY  computes the email blind index; it can't be rotated without recomputing
//                       every row, so never change it casually.
// Back both up somewhere other than Railway. A lost key means the waitlist is unreadable.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const HEX_KEY = /^[0-9a-f]{64}$/i;

function readKey(env, name) {
  const value = env[name];
  if (!value || !HEX_KEY.test(value)) {
    throw new Error(`${name} must be set to 64 hex characters (generate with: openssl rand -hex 32)`);
  }
  return Buffer.from(value, "hex");
}

export function loadKeys(env) {
  const encKey = readKey(env, "WAITLIST_ENC_KEY");
  const indexKey = readKey(env, "WAITLIST_INDEX_KEY");
  if (encKey.equals(indexKey)) {
    throw new Error("WAITLIST_ENC_KEY and WAITLIST_INDEX_KEY must be different keys");
  }
  return { encKey, indexKey };
}

// Decided once: changing this later orphans every stored blind index.
export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function createSealer({ encKey, indexKey }) {
  return {
    // Returns a versioned JSON envelope so keys can be rotated later without a flag day.
    seal(plaintext) {
      const iv = randomBytes(12); // fresh IV on every write; reuse breaks GCM
      const cipher = createCipheriv("aes-256-gcm", encKey, iv);
      const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return JSON.stringify({
        v: 1,
        iv: iv.toString("base64"),
        ct: ct.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
      });
    },

    open(envelope) {
      const { v, iv, ct, tag } = JSON.parse(envelope);
      if (v !== 1) { throw new Error(`Unknown ciphertext version ${v}`); }
      const decipher = createDecipheriv("aes-256-gcm", encKey, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
    },

    emailIndex(email) {
      return createHmac("sha256", indexKey).update(normalizeEmail(email)).digest("base64url");
    },
  };
}
