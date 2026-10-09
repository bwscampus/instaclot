import assert from "node:assert/strict";
import { test } from "node:test";
import { createSealer, loadKeys } from "../crypto.mjs";

const env = { WAITLIST_ENC_KEY: "11".repeat(32), WAITLIST_INDEX_KEY: "22".repeat(32) };
const sealer = createSealer(loadKeys(env));

test("seal/open round-trips and never contains the plaintext (DB-9)", () => {
  const sealed = sealer.seal("ada@example.com");
  assert.doesNotMatch(sealed, /ada/);
  assert.equal(sealer.open(sealed), "ada@example.com");
});

test("each seal uses a fresh IV", () => {
  assert.notEqual(sealer.seal("same"), sealer.seal("same"));
});

test("tampered ciphertext is rejected, not decrypted to garbage", () => {
  const envelope = JSON.parse(sealer.seal("ada@example.com"));
  const ct = Buffer.from(envelope.ct, "base64");
  ct[0] ^= 1;
  envelope.ct = ct.toString("base64");
  assert.throws(() => sealer.open(JSON.stringify(envelope)));
});

test("the blind index ignores case and surrounding spaces", () => {
  assert.equal(sealer.emailIndex(" Ada@Example.COM "), sealer.emailIndex("ada@example.com"));
  assert.notEqual(sealer.emailIndex("ada@example.com"), sealer.emailIndex("bob@example.com"));
});

test("missing, malformed or identical keys refuse to load (API-10)", () => {
  assert.throws(() => loadKeys({}), /WAITLIST_ENC_KEY/);
  assert.throws(() => loadKeys({ ...env, WAITLIST_INDEX_KEY: "changeme" }), /WAITLIST_INDEX_KEY/);
  assert.throws(() => loadKeys({ WAITLIST_ENC_KEY: env.WAITLIST_ENC_KEY, WAITLIST_INDEX_KEY: env.WAITLIST_ENC_KEY }), /different/);
});
