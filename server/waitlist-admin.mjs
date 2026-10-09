// Owner tools for the waitlist. Run inside the Railway service, where the private database
// host and the encryption keys are available:
//
//   railway ssh -s web -- npm run waitlist export            CSV of everyone on the list
//   railway ssh -s web -- npm run waitlist remove <email>    delete one person (privacy request)
//
// Output goes to your terminal only. Don't paste the CSV anywhere public.
import { createSealer, loadKeys } from "./crypto.mjs";
import { createPool, createStore } from "./db.mjs";

const [command, arg] = process.argv.slice(2);
const pool = createPool(process.env.DATABASE_URL);
const store = createStore(pool, createSealer(loadKeys(process.env)));

function csvField(value) {
  const text = String(value);
  // Quote everything; neutralise leading =,+,-,@ so spreadsheets don't run it as a formula.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

try {
  if (command === "export") {
    console.log("name,email,signed_up_at");
    for (const row of await store.listSignups()) {
      console.log([row.name, row.email, row.createdAt.toISOString()].map(csvField).join(","));
    }
  } else if (command === "remove" && arg) {
    console.log((await store.removeSignup(arg)) ? "Removed." : "No signup with that email.");
  } else {
    console.error("Usage: npm run waitlist export | npm run waitlist remove <email>");
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
