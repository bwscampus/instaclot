// Postgres access for the waitlist. All encryption happens here, at the one boundary between
// the app and the database, so no caller can forget it (DB-9). Queries are parameterised (DB-1).
import pg from "pg";

// Railway's private network (*.railway.internal) needs no TLS. Anything else must verify the
// certificate; turning verification off would make TLS meaningless (DB-4).
export function sslFor(connectionString) {
  const host = new URL(connectionString).hostname;
  const isPrivate = host.endsWith(".railway.internal") || host === "localhost" || host === "127.0.0.1";
  return isPrivate ? undefined : { rejectUnauthorized: true };
}

export function createPool(connectionString) {
  return new pg.Pool({ connectionString, ssl: sslFor(connectionString), max: 5 });
}

export function createStore(pool, sealer) {
  return {
    async ping() {
      await pool.query("select 1");
    },

    // A repeat address is silently ignored, so the response never reveals who is already on the list.
    async addSignup({ name, email }) {
      await pool.query(
        `insert into waitlist_signups (email_bidx, email_ciphertext, name_ciphertext)
         values ($1, $2, $3)
         on conflict (email_bidx) do nothing`,
        [sealer.emailIndex(email), sealer.seal(email), sealer.seal(name)]
      );
    },

    async listSignups() {
      const { rows } = await pool.query(
        "select name_ciphertext, email_ciphertext, created_at from waitlist_signups order by created_at"
      );
      return rows.map((row) => ({
        name: sealer.open(row.name_ciphertext),
        email: sealer.open(row.email_ciphertext),
        createdAt: row.created_at,
      }));
    },

    async removeSignup(email) {
      const { rowCount } = await pool.query("delete from waitlist_signups where email_bidx = $1", [
        sealer.emailIndex(email),
      ]);
      return rowCount > 0;
    },
  };
}
