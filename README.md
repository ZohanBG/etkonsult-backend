# etkonsult — Backend API

REST API backend for an insurance request management system, built with NestJS, Prisma ORM and PostgreSQL.

## Tech Stack

| Technology | Version | Role |
|-----------|--------|------|
| NestJS | 11 | API framework |
| Prisma | 7 | ORM (driver adapter pattern) |
| PostgreSQL | 16 | Database |
| Node.js | 22 | Runtime |
| pnpm | 9 | Package manager |
| Docker | — | Containerization |
| Caddy | — | Reverse proxy + HTTPS |

---

## Features

- **Authentication** — JWT (access + refresh tokens), TOTP 2FA, email verification on login, brute-force protection with exponential backoff
- **RBAC** — Roles and permissions with granular access control
- **Requests** — State machine for processing insurance requests (ZAYAVENA → OBRABOTENA → PRIETA_OFERTA → ZAVURSHENA)
- **Vehicles** — CRUD with deduplication by VIN, registration number, and talon number
- **Insurance** — Google Sheets sync, expiring policy tracking, agent name mapping
- **File uploads** — Photo and document uploads (multer), PDF conversion (poppler)
- **Push notifications** — Web Push with VAPID keys
- **Real-time** — WebSocket gateway (Socket.IO) for live updates
- **Audit log** — Full action history with automatic recording
- **Security** — Helmet, CSRF protection, rate limiting (Throttler), cookie-based sessions

---

## Local Development

### Requirements

- Node.js 22+
- pnpm 9+
- PostgreSQL 16 (or Docker)

### Installation

```bash
pnpm install
```

### Database

```bash
# Start PostgreSQL with Docker
docker compose up db -d

# Apply migrations
npx prisma migrate dev

# Seed (admin user)
npx ts-node --transpile-only prisma/seed.ts
```

### Environment Variables

```bash
cp .env.example .env
# Fill in the values in .env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing key (64 bytes hex) |
| `PASSWORD_PEPPER` | Password hashing pepper (32 bytes hex) |
| `TOTP_ENCRYPTION_KEY` | 2FA encryption key (32 bytes hex) |
| `CORS_ORIGIN` | Frontend URL |
| `FRONTEND_URL` | Frontend URL |
| `SMTP_HOST` | SMTP server |
| `SMTP_PASS` | SMTP password / API key |
| `VAPID_PUBLIC_KEY` | Web Push public key |
| `VAPID_PRIVATE_KEY` | Web Push private key |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | Service account email |
| `GOOGLE_SHEETS_PRIVATE_KEY` | Service account private key |

Generating secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # others
npx web-push generate-vapid-keys  # VAPID keys
```

### Running

```bash
# Development (watch mode)
pnpm start:dev

# HTTPS (with mkcert certificates)
# Place localhost+2.pem and localhost+2-key.pem in the root directory
pnpm start:dev
# Backend auto-detects PEM files and starts with HTTPS

# Production
pnpm build
pnpm start:prod
```

App starts at `http://localhost:3001` (or HTTPS if certificates are present).

---

## Tests

```bash
# Unit tests
pnpm test

# Unit tests (watch mode)
pnpm test:watch

# Integration tests (requires a running PostgreSQL)
pnpm test:integration

# E2E tests
pnpm test:e2e
```

---

## Docker

### Database only (for local development)

```bash
docker compose up db -d
```

### Full stack (backend + PostgreSQL)

```bash
docker compose up -d --build
```

Services:
- **db** — PostgreSQL 16 on `127.0.0.1:5432`
- **backend** — NestJS on `127.0.0.1:3001`

Health check: `http://localhost:3001/api/health`

---

## Deployment

See [`DEPLOYMENT.md`](../DEPLOYMENT.md) in the root directory for the full guide.

Quick summary:
1. Copy `.env.example` → `.env` and fill in production values
2. `docker compose up -d --build`
3. `docker compose exec backend npx prisma migrate deploy`
4. Put Caddy in front of port 3001 for HTTPS

---

## Project Structure

```
src/
├── auth/               # JWT auth, 2FA, email verification
├── users/              # User management
├── rbac/               # Roles, permissions, access control
├── requests/           # Insurance requests
├── vehicles/           # Vehicles
├── owners/             # Vehicle owners
├── resources/          # Shared resources (files, links)
├── insurance/          # Insurance policies, Google Sheets sync, agent mapping
├── uploads/            # File uploads for vehicles
├── push-notifications/ # Web Push (VAPID)
├── notifications/      # In-app notifications
├── admin-notifications/# Broadcast notifications
├── audit/              # Audit log
├── events/             # WebSocket gateway
├── email/              # Email transport (Nodemailer)
├── cache/              # In-memory cache
├── health/             # Health check endpoint
├── prisma/             # Prisma service
├── config/             # Env validation
├── shared/             # Guards, filters, middleware, interceptors
└── main.ts             # App entry point
```

---

## API Documentation

All endpoints are under the `/api` prefix. Authentication uses HTTP-only cookies (`access_token`, `refresh_token`).

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Login with email + password | — |
| POST | `/api/auth/refresh` | Refresh access token | — |
| POST | `/api/auth/logout` | Logout | ✓ |
| POST | `/api/auth/logout-all` | Logout all sessions | ✓ |
| GET | `/api/auth/me` | Current user profile | ✓ |
| PATCH | `/api/auth/me` | Update username/password | ✓ |
| POST | `/api/auth/2fa/setup` | Generate 2FA secret (QR code) | ✓ |
| POST | `/api/auth/2fa/verify-setup` | Enable 2FA | ✓ |
| POST | `/api/auth/2fa/disable` | Disable 2FA | ✓ |
| POST | `/api/auth/2fa/verify` | Verify TOTP during login | — |
| GET | `/api/auth/2fa/status` | 2FA status | ✓ |
| POST | `/api/auth/email/send-verification` | Send verification code | — |
| POST | `/api/auth/email/verify` | Verify email code | — |

### Users

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/api/users` | List users | `USER_READ` |
| GET | `/api/users/:id` | Get user details | `USER_READ` |
| POST | `/api/users` | Create user | `USER_CREATE` |
| PATCH | `/api/users/:id` | Update user | `USER_UPDATE` |
| DELETE | `/api/users/:id` | Delete user | `USER_DELETE` |
| POST | `/api/users/:id/reset-2fa` | Reset user's 2FA | `USER_RESET_2FA` |
| POST | `/api/users/:id/unlock` | Unlock account | `USER_UPDATE` |

### Roles & Permissions

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/api/roles` | List roles | `ROLE_READ` |
| GET | `/api/roles/:id` | Get role details | `ROLE_READ` |
| GET | `/api/roles/permissions` | All available permissions | `ROLE_READ` |
| GET | `/api/roles/my-permissions` | My permissions | ✓ |
| POST | `/api/roles` | Create role | `ROLE_CREATE` |
| PATCH | `/api/roles/:id` | Update role | `ROLE_UPDATE` |
| DELETE | `/api/roles/:id` | Delete role | `ROLE_DELETE` |
| POST | `/api/roles/assign` | Assign role to user | `USER_UPDATE` |
| POST | `/api/roles/unassign` | Remove role from user | `USER_UPDATE` |
| GET | `/api/roles/user/:userId` | Get user's roles | `USER_READ` |

### Requests

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/api/requests` | All requests | `REQUEST_READ_ALL` |
| GET | `/api/requests/my` | My requests | `REQUEST_READ_OWN` |
| GET | `/api/requests/check-by-reg` | Check requests by registration number | `REQUEST_READ_OWN` |
| GET | `/api/requests/:id` | Request details | `REQUEST_READ_OWN` |
| POST | `/api/requests` | Create request | `REQUEST_CREATE` |
| PATCH | `/api/requests/:id/status` | Update status (staff) | `REQUEST_UPDATE_STATUS` |
| PATCH | `/api/requests/:id/cancel` | Cancel own request | `REQUEST_CREATE` |
| PATCH | `/api/requests/:id/respond` | Accept/reject offer | `REQUEST_RESPOND_OFFER` |
| POST | `/api/requests/:id/images` | Upload request photos | `REQUEST_CREATE` |
| POST | `/api/requests/:id/offer` | Upload offer (ZAYAVENA→OBRABOTENA) | `REQUEST_UPDATE_STATUS` |
| POST | `/api/requests/:id/offer/append` | Append offer photos | `REQUEST_UPDATE_STATUS` |
| POST | `/api/requests/:id/documents` | Upload documents (→ZAVURSHENA) | `REQUEST_UPLOAD_DOCUMENT` |
| POST | `/api/requests/:id/documents/append` | Append documents | `REQUEST_UPLOAD_DOCUMENT` |
| POST | `/api/requests/:id/copy-to-vehicle` | Copy photos to vehicle | `REQUEST_UPDATE_STATUS` |
| GET | `/api/requests/:id/copy-to-vehicle/status` | Copy operation status | `REQUEST_UPDATE_STATUS` |
| DELETE | `/api/requests/images/:imageId` | Delete image | `REQUEST_UPDATE_STATUS` |

**State machine:**
```
ZAYAVENA → OBRABOTENA (staff uploads offer) / OTKAZANA (staff declines)
OBRABOTENA → PRIETA_OFERTA (agent accepts, sticker required) / OTKAZANA_OFERTA (agent rejects)
PRIETA_OFERTA → ZAVURSHENA (staff uploads final documents)
```

### Vehicles

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/api/vehicles` | List vehicles | `VEHICLE_READ` |
| GET | `/api/vehicles/:id` | Vehicle details | `VEHICLE_READ` |
| POST | `/api/vehicles` | Create vehicle | `VEHICLE_CREATE` |
| PATCH | `/api/vehicles/:id` | Update vehicle | `VEHICLE_UPDATE` |
| DELETE | `/api/vehicles/:id` | Delete vehicle | `VEHICLE_DELETE` |
| POST | `/api/vehicles/check-duplicates` | Check for duplicates | `VEHICLE_CREATE` |
| POST | `/api/uploads/vehicles/:vehicleId/images` | Upload vehicle images | `VEHICLE_UPDATE` |
| GET | `/api/uploads/vehicles/:vehicleId/images` | Get vehicle images | `VEHICLE_READ` |
| DELETE | `/api/uploads/images/:imageId` | Delete image | `VEHICLE_UPDATE` |

### Owners

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/api/owners` | List owners | `OWNER_READ` |
| GET | `/api/owners/:id` | Owner details | `OWNER_READ` |
| GET | `/api/owners/:id/vehicles` | Owner's vehicles | `OWNER_READ` |
| GET | `/api/owners/search` | Search owners | `OWNER_READ` |
| GET | `/api/owners/lookup` | Find by identifier | `OWNER_READ` |
| POST | `/api/owners` | Create owner | `OWNER_CREATE` |
| PATCH | `/api/owners/:id` | Update owner | `OWNER_UPDATE` |
| DELETE | `/api/owners/:id` | Delete owner | `OWNER_DELETE` |

### Resources

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/api/resources` | All resource sections | `RESOURCE_READ` |
| POST | `/api/resources/sections` | Create section | `RESOURCE_MANAGE` |
| PATCH | `/api/resources/sections/:id` | Update section | `RESOURCE_MANAGE` |
| DELETE | `/api/resources/sections/:id` | Delete section | `RESOURCE_MANAGE` |
| POST | `/api/resources/sections/:id/items/link` | Add link | `RESOURCE_MANAGE` |
| POST | `/api/resources/sections/:id/items/file` | Upload file | `RESOURCE_MANAGE` |
| POST | `/api/resources/sections/:id/items/files` | Upload multiple files | `RESOURCE_MANAGE` |
| POST | `/api/resources/upload-folder` | Upload folder | `RESOURCE_MANAGE` |
| PATCH | `/api/resources/items/:id` | Update item | `RESOURCE_MANAGE` |
| DELETE | `/api/resources/items/:id` | Delete item | `RESOURCE_MANAGE` |

### Insurance

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/api/insurance/agent-names` | Unique agent names | `INSURANCE_MANAGE` |
| GET | `/api/insurance/agent-mappings` | Agent mappings | `INSURANCE_MANAGE` |
| GET | `/api/insurance/agent-mappings/users` | Users available for mapping | `INSURANCE_READ` |
| POST | `/api/insurance/agent-mappings` | Create mapping | `INSURANCE_MANAGE` |
| POST | `/api/insurance/agent-mappings/bulk` | Bulk assign agent names | `INSURANCE_MANAGE` |
| DELETE | `/api/insurance/agent-mappings/:id` | Delete mapping | `INSURANCE_MANAGE` |
| GET | `/api/insurance/by-agent/stats` | Expiry stats (current agent) | `INSURANCE_AGENT_VIEW` |
| GET | `/api/insurance/by-agent/expiries` | Expiries (current agent) | `INSURANCE_AGENT_VIEW` |
| GET | `/api/insurance/by-agent/:userId/stats` | Stats for a specific agent | `INSURANCE_READ` |
| GET | `/api/insurance/by-agent/:userId/expiries` | Expiries for a specific agent | `INSURANCE_READ` |
| GET | `/api/insurance/stats` | Global expiry stats | `INSURANCE_READ` |
| GET | `/api/insurance/expiries` | All expiring policies | `INSURANCE_READ` |
| GET | `/api/insurance/vehicle/:reg/history` | Vehicle insurance history | `INSURANCE_READ` |
| GET | `/api/insurance/spreadsheets` | List spreadsheets | `INSURANCE_MANAGE` |
| POST | `/api/insurance/spreadsheets` | Add spreadsheet | `INSURANCE_MANAGE` |
| DELETE | `/api/insurance/spreadsheets/:id` | Remove spreadsheet | `INSURANCE_MANAGE` |
| POST | `/api/insurance/spreadsheets/validate` | Validate spreadsheet | `INSURANCE_MANAGE` |
| POST | `/api/insurance/spreadsheets/:id/archive` | Archive spreadsheet | `INSURANCE_MANAGE` |
| POST | `/api/insurance/spreadsheets/:id/refresh` | Restore from archive | `INSURANCE_MANAGE` |
| POST | `/api/insurance/sync` | Force sync | `INSURANCE_MANAGE` |

### Push Notifications

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/push/vapid-public-key` | VAPID public key | ✓ |
| POST | `/api/push/subscribe` | Subscribe | ✓ |
| DELETE | `/api/push/unsubscribe` | Unsubscribe | ✓ |

### Notifications

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/notifications` | My notifications | ✓ |
| PATCH | `/api/notifications/:id/read` | Mark as read | ✓ |
| PATCH | `/api/notifications/read-all` | Mark all as read | ✓ |
| DELETE | `/api/notifications` | Clear all | ✓ |

### Admin Notifications

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| POST | `/api/admin-notifications/broadcast` | Broadcast notification | `USER_READ` |
| POST | `/api/admin-notifications/roles-list` | Roles for targeting | `USER_READ` |
| POST | `/api/admin-notifications/users-list` | Users for targeting | `USER_READ` |

### Audit Log

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/api/audit-logs` | Audit entries | `AUDIT_READ` |
| GET | `/api/audit-logs/:id` | Entry details | `AUDIT_READ` |
| GET | `/api/audit-logs/entity-types` | Entity types | `AUDIT_READ` |
| GET | `/api/audit-logs/actions` | Action types | `AUDIT_READ` |
| POST | `/api/audit-logs/client-error` | Log client-side error | — (public) |

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Application status |

---

## Security

- **Passwords** — argon2id + HMAC pepper
- **Sessions** — HTTP-only cookies, CSRF token (custom header `X-CSRF-Token`)
- **Rate limiting** — Throttler: 100 req/min globally, stricter limits on auth endpoints
- **Brute-force protection** — Exponential backoff, account lock after N failed attempts
- **Headers** — Helmet (CSP, HSTS, X-Frame-Options, etc.)
- **Fingerprinting** — Device fingerprint header `X-Fingerprint` for additional verification

---

## License

Private project — all rights reserved.
