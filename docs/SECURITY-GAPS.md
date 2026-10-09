# Security notes and open gaps

Checked against the Production Standard. Rule IDs refer to that standard.

## Data inventory (DB-7)

| Table.column | Class | Why stored | Protection |
|---|---|---|---|
| waitlist_signups.name_ciphertext | PII | address the update email | AES-256-GCM in the app before insert (DB-9) |
| waitlist_signups.email_ciphertext | PII | send launch updates | AES-256-GCM in the app before insert (DB-9) |
| waitlist_signups.email_bidx | derived from PII | one signup per address | HMAC-SHA256 blind index, separate key; reveals only equality |
| waitlist_signups.created_at | none | ordering | plaintext |

Keys: `WAITLIST_ENC_KEY` and `WAITLIST_INDEX_KEY`, Railway service variables on `web`.
**They must also be backed up outside Railway** (for example a password manager the founders share).
If the keys are lost, the waitlist can't be read again.

## How it is protected

- The app connects as `app_rw_login`, which can read and write rows but can't change the schema (DB-6).
  Migrations run as the owner through `MIGRATION_DATABASE_URL`.
- The database is reachable only on Railway's private network, with no public TCP proxy (DB-4).
- Signups are rate-limited per client IP (`X-Real-IP`), capped at 2 KB, validated, and refused from other origins.
- A repeat address returns the same response as a new one, so the form can't be used to check who signed up.

## Open

| Rule | Sev | Where | Problem | Status |
|---|---|---|---|---|
| PRIV-1 | High | index.html form | No privacy policy linked where names and emails are collected | Open: needs teacher/founder text |
| PRIV-2 | High | index.html form | The product is aimed at kids' nosebleeds; under-13s may sign up. Needs an age/parent decision | Open: needs teacher decision |
| DB-5 | Medium | Railway Postgres | Snapshots and PITR need the Pro plan; enable and rehearse one restore | Open: owner action |
| OPS-1 | Medium | Railway service | Turn on "Wait for CI" once the service deploys from GitHub | Open: owner action |
| OPS-4 | Medium | GitHub | Protect `main` (PRs, green CI) | Open: owner action |
| OPS-6 | Low | Railway | Uptime monitor on `/api/health` | Open |
