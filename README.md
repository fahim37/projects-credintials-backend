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
