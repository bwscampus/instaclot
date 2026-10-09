// Runs against a real Postgres when MIGRATION_DATABASE_URL and APP_DATABASE_URL are set
// (CI sets them; locally see README). Skipped otherwise.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import { createSealer, loadKeys } from "../crypto.mjs";
import { createStore } from "../db.mjs";

const { MIGRATION_DATABASE_URL, APP_DATABASE_URL } = process.env;
const skip = !(MIGRATION_DATABASE_URL && APP_DATABASE_URL) && "set MIGRATION_DATABASE_URL and APP_DATABASE_URL";
const run = promisify(execFile);

describe("postgres", { skip }, () => {
  let owner, app, store;

  before(async () => {
    const migrate = new URL("../migrate.mjs", import.meta.url).pathname;
    await run(process.execPath, [migrate]);
    await run(process.execPath, [migrate]); // second run must be a no-op (idempotent)
    owner = new pg.Pool({ connectionString: MIGRATION_DATABASE_URL });
    app = new pg.Pool({ connectionString: APP_DATABASE_URL });
    await owner.query("delete from waitlist_signups");
    const keys = loadKeys({ WAITLIST_ENC_KEY: "33".repeat(32), WAITLIST_INDEX_KEY: "44".repeat(32) });
    store = createStore(app, createSealer(keys));
  });
  after(async () => { await owner?.end(); await app?.end(); });

  test("a stored signup is ciphertext in the database (DB-9)", async () => {
    await store.addSignup({ name: "Ada Lovelace", email: "ada@example.com" });
    const { rows } = await owner.query("select * from waitlist_signups");
    assert.equal(rows.length, 1);
    assert.doesNotMatch(JSON.stringify(rows), /ada@example|Lovelace/i);
    assert.deepEqual((await store.listSignups()).map((r) => r.email), ["ada@example.com"]);
  });

  test("the same address twice keeps one row, in any case", async () => {
    await store.addSignup({ name: "Ada again", email: "ADA@example.com" });
    assert.equal((await store.listSignups()).length, 1);
  });

  test("remove deletes a signup by email", async () => {
    assert.equal(await store.removeSignup("Ada@Example.com"), true);
    assert.equal((await store.listSignups()).length, 0);
  });

  test("the app role is not a superuser and cannot change schema (DB-6)", async () => {
    const { rows } = await app.query(
      "select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = current_user"
    );
    assert.deepEqual(rows[0], { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
    for (const sql of [
      "create table x (id int)",
      "drop table waitlist_signups",
      "alter table waitlist_signups add column x int",
      "truncate waitlist_signups",
      "select * from schema_migrations",
    ]) {
      await assert.rejects(app.query(sql), /permission denied|must be owner/, sql);
    }
  });
});
