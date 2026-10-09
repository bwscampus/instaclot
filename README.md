# instaclot
The website and its waitlist API run as one Node service on Railway (`server/`), backed by Postgres.

## Running locally

```bash
npm install
docker run -d --name instaclot-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=instaclot -p 5432:5432 postgres:16
cp .env.example .env            # fill in the two keys with: openssl rand -hex 32
node --env-file=.env server/migrate.mjs
node --env-file=.env server/index.mjs   # http://localhost:3000
```

Tests: `npm test`. The Postgres tests run when `MIGRATION_DATABASE_URL` and `APP_DATABASE_URL` are set.

## Waitlist

Names and emails are encrypted before they reach the database (see `docs/SECURITY-GAPS.md`).
To read or edit the list, run the tools inside the Railway service:

```bash
railway ssh -s web -- npm run waitlist export           # CSV to your terminal
railway ssh -s web -- npm run waitlist remove <email>   # privacy/deletion request
```

## License

InstaClot is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).
Copyright 2026 The InstaClot founders.

- **Noncommercial use is free.** Personal study, learning, hobby projects, schools, and nonprofits may
  use, copy, modify, and share the code, as long as they include the license and its `Required Notice:` line.
- **Commercial use is reserved to the founders,** who keep all rights to the code and the product. To ask
  about commercial use, open an issue on this repository.
- Third-party libraries and assets keep their own licenses.
