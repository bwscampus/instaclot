// The InstaClot web service: serves the static site and the waitlist API from one origin,
// so the browser never needs CORS (API-5).
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

const PAGES = { "/": "index.html", "/index.html": "index.html", "/story.html": "story.html" };
// Only what the pages load. Source images, sketches and the spec PDF in the repo stay private.
const STATIC_DIRS = ["css", "js", "assets/images", "assets/fonts"];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_NAME = 100;
const MAX_EMAIL = 254;

// The pages carry one tiny inline script each; allow exactly those by hash instead of
// opening script-src to 'unsafe-inline' (API-4).
function inlineScriptHashes(siteRoot) {
  const hashes = new Set();
  for (const page of new Set(Object.values(PAGES))) {
    const html = readFileSync(path.join(siteRoot, page), "utf8");
    for (const [, body] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      hashes.add(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
    }
  }
  return [...hashes];
}

// Railway's edge overwrites X-Real-IP on every request, so clients can't forge it (AUTH-3).
function clientIp(req) {
  return req.get("x-real-ip") || req.ip || "unknown";
}

function validateSignup(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) { return null; }
  const { name, email } = body;
  if (typeof name !== "string" || typeof email !== "string") { return null; }
  const cleanName = name.trim();
  const cleanEmail = email.trim();
  if (!cleanName || cleanName.length > MAX_NAME) { return null; }
  if (cleanEmail.length > MAX_EMAIL || !EMAIL.test(cleanEmail)) { return null; }
  return { name: cleanName, email: cleanEmail };
}

export function createApp({ store, siteRoot, production = false, signupLimit = 5 }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // Request ID on every response; logs carry method, path, status and time, never bodies (API-8).
  app.use((req, res, next) => {
    const id = randomUUID();
    const started = process.hrtime.bigint();
    res.locals.requestId = id;
    res.set("X-Request-Id", id);
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      console.log(`${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms id=${id}`);
    });
    next();
  });

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...inlineScriptHashes(siteRoot)],
        styleSrc: ["'self'", "'unsafe-inline'"], // one inline style attribute on the SVG sprite
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(production ? { upgradeInsecureRequests: [] } : {}),
      },
    },
  }));

  // ---------- API ----------

  app.get("/api/health", async (_req, res) => {
    try {
      await store.ping();
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });

  const signupLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: signupLimit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
    message: { message: "Too many sign ups from this connection. Please try again later." },
  });

  // Cross-site requests are refused (API-6): browsers always send Origin on a cross-origin POST.
  function sameOrigin(req, res, next) {
    const origin = req.get("origin");
    if (origin) {
      let host;
      try { host = new URL(origin).host; } catch { host = null; }
      if (host !== req.get("host")) {
        return res.status(403).json({ message: "Forbidden." });
      }
    }
    next();
  }

  app.post(
    "/api/waitlist",
    sameOrigin,
    signupLimiter,
    (req, res, next) => (req.is("application/json") ? next() : res.status(415).json({ message: "Send JSON." })),
    express.json({ limit: "2kb" }),
    async (req, res) => {
      const signup = validateSignup(req.body);
      if (!signup) {
        return res.status(400).json({ message: "Please enter your name and a valid email address." });
      }
      // Spam trap: real visitors never fill this hidden field. Pretend it worked and store nothing.
      if (typeof req.body._gotcha === "string" && req.body._gotcha !== "") {
        return res.status(201).json({ ok: true });
      }
      await store.addSignup(signup);
      res.status(201).json({ ok: true });
    }
  );

  app.use("/api", (_req, res) => res.status(404).json({ message: "Not found." }));

  // ---------- Site ----------

  for (const [route, file] of Object.entries(PAGES)) {
    app.get(route, (_req, res) => res.sendFile(path.join(siteRoot, file)));
  }
  for (const dir of STATIC_DIRS) {
    app.use(`/${dir}`, express.static(path.join(siteRoot, dir), { index: false, dotfiles: "ignore", maxAge: "1h" }));
  }
  app.use((_req, res) => res.status(404).type("text").send("Not found"));

  // Generic 500 with a request ID; details stay in the server log (API-3).
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) {
      console.error(`Error on ${req.method} ${req.path} id=${res.locals.requestId}:`, err.message);
      return res.status(500).json({ message: "Something went wrong.", requestId: res.locals.requestId });
    }
    res.status(status).json({ message: status === 413 ? "Request too large." : "Invalid request." });
  });

  return app;
}
