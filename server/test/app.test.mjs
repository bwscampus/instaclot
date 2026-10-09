import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp } from "../app.mjs";

const siteRoot = fileURLToPath(new URL("../..", import.meta.url));

function fakeStore() {
  return {
    signups: [],
    healthy: true,
    failInsert: false,
    async ping() { if (!this.healthy) { throw new Error("db down"); } },
    async addSignup(signup) {
      if (this.failInsert) { throw new Error("secret db detail"); }
      this.signups.push(signup);
    },
  };
}

let store, server, base, ipCounter = 0;

// Each test posts from its own IP so the rate limiter doesn't leak between tests.
function post(body, { headers = {}, raw = false, ip } = {}) {
  return fetch(`${base}/api/waitlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Real-IP": ip ?? `10.0.0.${++ipCounter}`, ...headers },
    body: raw ? body : JSON.stringify(body),
  });
}

before(async () => {
  store = fakeStore();
  server = createApp({ store, siteRoot, signupLimit: 3 }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => { store.signups = []; store.healthy = true; store.failInsert = false; });

describe("POST /api/waitlist", () => {
  test("stores a valid signup, trimmed", async () => {
    const res = await post({ name: "  Ada ", email: " ada@example.com " });
    assert.equal(res.status, 201);
    assert.deepEqual(store.signups, [{ name: "Ada", email: "ada@example.com" }]);
  });

  test("rejects a bad email or missing name (API-2)", async () => {
    for (const body of [{ name: "Ada", email: "nope" }, { name: "", email: "a@b.co" }, { email: "a@b.co" }, [1], "x"]) {
      assert.equal((await post(body)).status, 400, JSON.stringify(body));
    }
    assert.equal(store.signups.length, 0);
  });

  test("rejects over-length fields and oversized bodies with 4xx, not 500 (API-2)", async () => {
    assert.equal((await post({ name: "a".repeat(101), email: "a@b.co" })).status, 400);
    assert.equal((await post({ name: "Ada", email: `${"a".repeat(250)}@b.co` })).status, 400);
    assert.equal((await post({ name: "Ada", email: "a@b.co", pad: "x".repeat(5000) })).status, 413);
  });

  test("rejects malformed JSON and non-JSON bodies", async () => {
    assert.equal((await post("{oops", { raw: true })).status, 400);
    assert.equal((await post("name=Ada", { raw: true, headers: { "Content-Type": "application/x-www-form-urlencoded" } })).status, 415);
  });

  test("honeypot submissions look successful but store nothing", async () => {
    const res = await post({ name: "Bot", email: "bot@example.com", _gotcha: "http://spam" });
    assert.equal(res.status, 201);
    assert.equal(store.signups.length, 0);
  });

  test("refuses cross-site requests (API-6)", async () => {
    const res = await post({ name: "Ada", email: "ada@example.com" }, { headers: { Origin: "https://evil.example" } });
    assert.equal(res.status, 403);
    const same = await post({ name: "Ada", email: "ada@example.com" }, { headers: { Origin: base } });
    assert.equal(same.status, 201);
  });

  test("rate-limits per client IP (AUTH-3)", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await post({ name: "Ada", email: `ada${i}@example.com` }, { ip: "203.0.113.9" })).status);
    }
    assert.deepEqual(statuses, [201, 201, 201, 429]);
    assert.equal((await post({ name: "Ada", email: "x@example.com" }, { ip: "203.0.113.10" })).status, 201);
  });

  test("a database failure returns a generic 500 with a request ID (API-3)", async () => {
    store.failInsert = true;
    const res = await post({ name: "Ada", email: "ada@example.com" });
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.doesNotMatch(text, /secret db detail/);
    assert.match(JSON.parse(text).requestId, /^[0-9a-f-]{36}$/);
  });
});

describe("GET /api/health (API-9)", () => {
  test("reports ok when the database answers, 503 when it doesn't", async () => {
    assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { status: "ok" });
    store.healthy = false;
    assert.equal((await fetch(`${base}/api/health`)).status, 503);
  });
});

describe("site", () => {
  test("serves the pages and their assets", async () => {
    for (const p of ["/", "/story.html", "/css/styles.css", "/js/form.js", "/assets/images/favicon.svg"]) {
      assert.equal((await fetch(base + p)).status, 200, p);
    }
  });

  test("does not serve repo files outside the site", async () => {
    for (const p of ["/package.json", "/server/app.mjs", "/InstaClot_Specification.pdf", "/assets/source/kid-pinch.png", "/.git/config", "/css/../package.json"]) {
      assert.equal((await fetch(base + p)).status, 404, p);
    }
  });

  test("sends security headers (API-4)", async () => {
    const res = await fetch(`${base}/`);
    const csp = res.headers.get("content-security-policy");
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'self' 'sha256-/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok(res.headers.get("strict-transport-security"));
    assert.equal(res.headers.get("x-powered-by"), null);
  });
});
