# Handoff (on‑prem)

Web app for daily onshore/offshore handoffs: **workspaces** (Chrome-style tabs: e.g. FE Production, OMS DEV, Testing) each with its own handoff history, dated pages, summaries per topic, comments with date/team prefix, **Add HO** rollover, and attachments on disk. After login, users pick a workspace at **`/workspaces`**; **admin** users can add and rename workspace tabs and create users with either admin access or workspace-specific access.

## Architecture and flow

- See [`docs/APPLICATION-FLOW.md`](docs/APPLICATION-FLOW.md) for the **application flow diagram** (sign-in through handoff actions).
- See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for component architecture, data flow diagrams, storage model, and functionality write-up.
- See [`docs/PERFORCE.md`](docs/PERFORCE.md) for Perforce ignore rules and post-sync setup.

## Prerequisites

- **Node.js** 20+ and **npm**
- **PostgreSQL** 15+ (local install, VM, or Docker — see `docker-compose.yml`)
- Reverse proxy with **HTTPS** in production (nginx / IIS) in front of `next start`

## Quick start

1. Copy environment file:

   ```bash
   cp .env.example .env
   ```

   Set `DATABASE_URL`, `AUTH_SECRET` (e.g. `openssl rand -base64 32`), and optionally `HANDOFF_TZ` (IANA timezone for “today” and business-day logic), `ATTACHMENTS_DIR`, `MAX_UPLOAD_BYTES`.

2. Install and migrate:

   ```bash
   npm install
   npx prisma migrate deploy
   npm run db:seed
   ```

3. Run dev server:

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000` — sign in, then choose a **workspace** on **`/workspaces`**. Handoff URLs are **`/w/{workspaceId}/handoff/{YYYY-MM-DD}`**. Default seed user (override with env):

   - `SEED_ADMIN_EMAIL` (default `admin@handoff.local`) — also **workspace admin** (`is_admin` in DB; can add/rename tabs)
   - `SEED_ADMIN_PASSWORD` (default `changeme`)
   - `SEED_USER_TEAM` (optional: `on_shore` or `off_shore`) — when set, that user can edit that team's posted updates; when unset, only the author can edit their own update.

   Migration + seed create three workspaces (**FE Production**, **OMS DEV**, **Testing**) and attach existing handoff data to **FE Production** if you upgrade an older database.

  Dates in the UI use **DD-MM-YYYY** (calendar input value stays ISO internally). The left sidebar groups handoff days by **MM-YYYY** (collapsible). **`/`** redirects to **`/workspaces`**. **Add HO** sends `clientToday` + `clientTimeZone` from the browser (per-user local calendar). **`HANDOFF_TZ`** still drives comment prefixes via `NEXT_PUBLIC_HANDOFF_TZ`. **Add HO** copies open items from the **most recent earlier handoff day** in that workspace, including comments and files. If today's handoff already exists, API returns conflict. **Delete HO** removes the **latest** handoff day **in that workspace only**.

4. Production build:

   ```bash
   npm run build
   npm start
   ```

## Docker Compose (PostgreSQL only)

From `handoff-app/`:

```bash
docker compose up -d
```

Use `DATABASE_URL=postgresql://handoff:handoff@localhost:5432/handoff?schema=public` to match `docker-compose.yml`.

## Operations & lifetime retention

- **Database**: schedule `pg_dump` (or `prisma migrate` + logical backups) daily; test restores.
- **Attachments**: back up the directory from `ATTACHMENTS_DIR` (default `./data/attachments` under the app working directory) together with the DB.
- **Secrets**: rotate `AUTH_SECRET` only with a session invalidation plan.
- **TLS**: terminate HTTPS at the reverse proxy; keep `NEXTAUTH_URL` aligned with the public URL.

## Authentication (on‑prem)

The app ships with **email + password** accounts in PostgreSQL (bcrypt). This fits VPN-only deployments. To plug in **LDAP/Active Directory** or **Keycloak**, replace or extend the NextAuth `Credentials` provider in [`src/auth.ts`](src/auth.ts) with an OIDC/SAML provider or a custom `authorize` that validates against AD.

## API overview

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/workspaces` | List workspaces (tabs) |
| POST | `/api/workspaces` | Create workspace (**admin only**) `{ "name" }` |
| PATCH | `/api/workspaces/:workspaceId` | Rename workspace (**admin only**) `{ "name" }` |
| GET | `/api/users` | List users + workspace options (**admin only**) |
| POST | `/api/users` | Create user (**admin only**) with admin or single-workspace access |
| PATCH | `/api/users/password` | Change current user's password |
| GET | `/api/workspaces/:id/handoffs` | Recent handoff dates **in that workspace** |
| GET | `/api/workspaces/:id/handoffs/:date` | One day in that workspace |
| POST | `/api/workspaces/:id/handoffs/:date/topics` | Add topic row |
| POST | `/api/workspaces/:id/handoffs/rollover` | **Add HO** (optional browser JSON body as before); scoped to workspace |
| DELETE | `/api/workspaces/:id/handoffs/:date` | Delete latest handoff day in workspace only |
| PATCH | `/api/workspaces/:id/topics/:topicId` | Update summaries |
| PATCH | `/api/workspaces/:id/topics/:topicId/close` | Toggle closed |
| POST | `/api/workspaces/:id/topics/:topicId/comments` | Add comment |
| PATCH | `/api/workspaces/:id/comments/:commentId` | Edit comment |
| POST | `/api/workspaces/:id/comments/:commentId/attachments` | Upload file |
| GET | `/api/workspaces/:id/attachments/:attachmentId` | Download (authenticated, workspace-scoped) |

## Reverse proxy notes

- Proxy `/` to the Node process (port 3000 by default).
- Preserve `Host` and forward `X-Forwarded-Proto` so NextAuth cookies work.
- Increase **client max body size** for large uploads if you raise `MAX_UPLOAD_BYTES`.
