# Perforce checklist

Short guide for submitting and syncing **handoff-app** in Perforce.

## Before first submit

1. Set ignore rules on your client (one of):
   - Client spec: `P4IGNORE=.p4ignore`
   - Or environment: `P4IGNORE=.p4ignore` (path relative to workspace root)
2. Confirm `.p4ignore` is in the project root (same folder as `package.json`).
3. Run `p4 reconcile -ead` (or your team’s equivalent) and verify **none** of these appear:
   - `node_modules/`, `.next/`, `.env`, `data/attachments/`
4. **Submit:** source, `prisma/` (schema + `migrations/` + `seed.ts`), `public/`, `package.json`, `package-lock.json`, `.env.example`, `docker-compose.yml`, docs, config files.
5. **Do not submit:** secrets, build artifacts, uploaded attachments, or `.git/`.

## After sync (every machine / server)

Prerequisites: **Node.js 20+**, **npm**, **PostgreSQL 15+** (or `docker compose up -d` for local Postgres).

```bash
cd handoff-app
cp .env.example .env
# Edit .env: DATABASE_URL, AUTH_SECRET, NEXTAUTH_URL, HANDOFF_TZ, ATTACHMENTS_DIR

npm install
npx prisma generate
npx prisma migrate deploy
npm run db:seed
```

| Step | Purpose |
|------|---------|
| `npm install` | Install dependencies from `package-lock.json` |
| `prisma generate` | Generate Prisma client |
| `prisma migrate deploy` | Create/update tables (production-safe) |
| `npm run db:seed` | Default admin user + workspaces (idempotent) |

**Seed overrides (recommended on servers):**

```bash
# bash
export SEED_ADMIN_EMAIL="you@company.com"
export SEED_ADMIN_PASSWORD="your-secure-password"
npm run db:seed
```

Default seed login if unset: `admin@handoff.local` / `changeme` — change before go-live.

## Run the app

```bash
npm run dev          # development
npm run build && npm start   # production
```

Ensure `ATTACHMENTS_DIR` exists and is writable (default `./data/attachments`).

## After pulling schema changes

When someone adds a new folder under `prisma/migrations/`:

```bash
p4 sync
npm install
npx prisma migrate deploy
npm run build    # production hosts
```

Only use `npx prisma migrate dev` when **authoring** a new migration on a dev machine, then submit the new migration SQL to Perforce.

## Operations

- **Database backups:** `pg_dump` on a schedule; test restores.
- **Attachments:** back up `ATTACHMENTS_DIR` with the DB.
- **Secrets:** keep `.env` only on each host; never in the depot.

See also [`README.md`](../README.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md).
