# SCALEUP API

Express 5 + MongoDB (Mongoose) API that stores project resources and deployment credentials.

## Setup

```bash
npm install
cp .env.example .env      # fill in MONGODB_URI, JWT_SECRET, SMTP_*, ADMIN_*
npm run gen:key           # -> put the output in ENCRYPTION_KEYS as "v1:<key>"
npm run seed:admin        # creates the first admin from ADMIN_* (safe to re-run)
npm run dev               # http://localhost:5000
```

`npm run build && npm start` for production. `npm run typecheck` type-checks without emitting.

## Security model

- **Credential encryption** — every credential value, resource note and project note is encrypted with
  AES-256-GCM (`src/lib/crypto.ts`) before it reaches MongoDB. Values are stored as
  `enc:<keyVersion>:<iv>:<tag>:<ciphertext>`, so a database dump alone reveals nothing.
- **Back up `ENCRYPTION_KEYS`.** Losing the key makes stored credentials unrecoverable.
- **Key rotation** — prepend a new key (`ENCRYPTION_KEYS=v2:<new>,v1:<old>`), run `npm run rotate:keys`,
  then drop the old key once it reports 0 remaining.
- **Sessions** — JWT in an httpOnly cookie (`pm_session`). Password changes, role changes and rejections
  bump `tokenVersion`, which signs out existing sessions.
- **Registration** — Sales / Operation users self-register as `pending`; an admin approves them. Admins are
  only created by `seed:admin` or by another admin.
- **Password reset** — 6-digit OTP (hashed, 10 min TTL, 5 attempts) emailed over SMTP; without SMTP config
  the email is printed to the console.
- All `/api` responses send `Cache-Control: no-store`; auth/OTP endpoints are rate limited.

## Roles

| | Sales | Operation | Admin |
|---|:-:|:-:|:-:|
| View projects & credentials | ✓ | ✓ | ✓ |
| Create / edit / duplicate / delete projects | | ✓ | ✓ |
| Manage categories & profile names | | | ✓ |
| Approve / manage users | | | ✓ |

## API

| Method | Path | |
|---|---|---|
| POST | `/api/auth/register` · `/login` · `/logout` | |
| GET | `/api/auth/me` | current user |
| POST | `/api/auth/forgot-password` → `/verify-otp` → `/reset-password` | OTP reset flow |
| PATCH | `/api/me` · `/api/me/password` | own profile / password |
| GET | `/api/projects` | list (`search`, `category`, `profileName`, `serviceLine`, `tag`, `expiring`, `sort`, `page`, `limit`) — no secrets |
| GET | `/api/projects/meta` | enums + resource templates |
| GET | `/api/projects/expiring?days=30` | resources with upcoming renewals |
| GET | `/api/projects/tags` | tags in use |
| GET | `/api/projects/:id` | full project, decrypted |
| POST / PUT / DELETE | `/api/projects[/:id]` | operation, admin |
| POST | `/api/projects/:id/duplicate` | operation, admin |
| GET / POST / PATCH / DELETE | `/api/categories`, `/api/profile-names` | read: all; write: admin |
| GET / POST / PATCH / DELETE | `/api/users`, `GET /api/users/stats`, `POST /api/users/:id/approve|reject` | admin |

Resource templates (VPS, MongoDB, Cloudinary, App Store, Stripe, …) live in
`src/modules/projects/templates.ts` — add one there and it appears in the UI picker.

## Clients and named projects

Clients are shared across profiles. Every project belongs to one client and has its own name,
live-site links, repository links, and encrypted resources. Approved users can read clients;
operations and admins can create, rename, and delete them. A client with projects cannot be deleted.

- `GET /api/clients?search=&page=1&limit=12` — paginated client names and project counts.
- `POST /api/clients` with `{ "name": "Acme" }` — create a client. Names are unique after trimming and lowercasing.
- `GET /api/clients/:id`, `PATCH /api/clients/:id` with `{ "name": "New name" }`, `DELETE /api/clients/:id`.
- Project writes require `clientId`, `name`, `liveSites`, and `repositories` alongside the existing project fields.
  Links use `{ "label": "Admin dashboard", "url": "https://admin.example.com" }`; arrays may be empty.
  Completely blank link rows are discarded; partial rows and non-HTTP(S) URLs are rejected.
- Project listing accepts `clientId` and name sorts (`name`, `-name`), and searches link labels and URLs.
  Client-name sorting joins the current client record before pagination, so renames appear immediately.
- Legacy read fields (`clientName`, `liveUrl`, `repoUrl`) remain available. Old-form writes return HTTP 409
  with a refresh message instead of overwriting multiple links.

### Existing-data migration

```bash
npm run migrate:clients                 # read-only preview
npm run migrate:clients -- --apply      # apply to the database configured in .env
```

Back up the configured database before applying the migration and stop application writes while it runs.
The preview reports groups, proposed project names and link counts without printing credentials.
Matching names are grouped across profiles; different spellings stay separate. The migration retains
legacy fields and only sets client references, missing project names, and missing link arrays.
Project IDs, timestamps, resource IDs and ciphertext are preserved. Re-running it skips completed records.
Existing empty arrays are preserved, even when an old scalar URL remains on a record.

For a future production rollout, build a separate release first, save matching code and database
backups, disable API writes, apply the migration, switch the application, and verify health before
reenabling writes. Rollback must restore both backups before reenabling writes. No deployment is
performed by the migration command itself.

### Integration checks

`npm test` exercises migration, client/project permissions, multiple links, encryption, searching,
pagination, client renames, project duplication and reassignment against a disposable database on
the configured MongoDB server. It never writes fixtures into the application database and removes
the test database on completion. `npm run typecheck` and `npm run build` check the server code.
