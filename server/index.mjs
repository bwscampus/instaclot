// Entry point. Validates configuration before listening, so a misconfigured deploy fails
// at boot and the previous version keeps serving (API-10).
import { fileURLToPath } from "node:url";
import { createApp } from "./app.mjs";
import { createSealer, loadKeys } from "./crypto.mjs";
import { createPool, createStore } from "./db.mjs";

const env = process.env;
const production = env.NODE_ENV === "production" || Boolean(env.RAILWAY_ENVIRONMENT);

if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (production && new URL(env.DATABASE_URL).username !== "app_rw_login") {
  console.error("In production DATABASE_URL must use the restricted app_rw_login role (DB-6).");
  process.exit(1);
}

let keys;
try {
  keys = loadKeys(env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const pool = createPool(env.DATABASE_URL);
const app = createApp({
  store: createStore(pool, createSealer(keys)),
  siteRoot: fileURLToPath(new URL("..", import.meta.url)),
  production,
});

const port = Number(env.PORT) || 3000;
const server = app.listen(port, "0.0.0.0", () => console.log(`Listening on port ${port}`));

process.on("SIGTERM", () => {
  server.close(() => pool.end().finally(() => process.exit(0)));
});
