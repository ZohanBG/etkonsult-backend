# etkonsult — Backend API

REST API backend за система за управление на застрахователни заявки, изградена с NestJS, Prisma ORM и PostgreSQL.

## Технологии

| Технология | Версия | Роля |
|-----------|--------|------|
| NestJS | 11 | API framework |
| Prisma | 7 | ORM (driver adapter pattern) |
| PostgreSQL | 16 | База данни |
| Node.js | 22 | Runtime |
| pnpm | 9 | Package manager |
| Docker | — | Контейнеризация |
| Caddy | — | Reverse proxy + HTTPS |

---

## Функционалности

- **Автентикация** — JWT (access + refresh tokens), TOTP 2FA, email верификация при вход, защита от brute-force с exponential backoff
- **RBAC** — Роли и права с персонализирани permissions
- **Заявки** — State machine за обработка на застрахователни заявки (ZAYAVENA → OBRABOTENA → PRIETA_OFERTA → ZAVURSHENA)
- **Превозни средства** — CRUD с дедупликация по VIN, регистрационен номер, талон
- **Застраховки** — Синхронизация от Google Sheets, проследяване на изтичащи полици, mapping на агенти
- **Файлове** — Upload на снимки и документи (multer), PDF конвертиране (poppler)
- **Push нотификации** — Web Push с VAPID ключове
- **Real-time** — WebSocket gateway (Socket.IO) за live updates
- **Одит лог** — Пълна история на действията с автоматично записване
- **Сигурност** — Helmet, CSRF protection, rate limiting (Throttler), cookie-based sessions

---

## Локално стартиране

### Изисквания

- Node.js 22+
- pnpm 9+
- PostgreSQL 16 (или Docker)

### Инсталация

```bash
pnpm install
```

### База данни

```bash
# Стартирай PostgreSQL с Docker
docker compose up db -d

# Приложи миграции
npx prisma migrate dev

# Seed (admin потребител)
npx ts-node --transpile-only prisma/seed.ts
```

### Environment Variables

```bash
cp .env.example .env
# Попълни стойностите в .env
```

Задължителни vars:

| Variable | Описание |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing key (64 bytes hex) |
| `PASSWORD_PEPPER` | Password hashing pepper (32 bytes hex) |
| `TOTP_ENCRYPTION_KEY` | 2FA encryption key (32 bytes hex) |
| `CORS_ORIGIN` | Frontend URL |
| `FRONTEND_URL` | Frontend URL |
| `SMTP_HOST` | SMTP сървър |
| `SMTP_PASS` | SMTP парола / API ключ |
| `VAPID_PUBLIC_KEY` | Web Push public key |
| `VAPID_PRIVATE_KEY` | Web Push private key |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | Service account email |
| `GOOGLE_SHEETS_PRIVATE_KEY` | Service account private key |

Генериране на секрети:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # останалите
npx web-push generate-vapid-keys  # VAPID ключове
```

### Стартиране

```bash
# Development (watch mode)
pnpm start:dev

# HTTPS (с mkcert сертификати)
# Постави localhost+2.pem и localhost+2-key.pem в root директорията
pnpm start:dev
# Backend автоматично открива PEM файловете и стартира с HTTPS

# Production
pnpm build
pnpm start:prod
```

Приложението стартира на `http://localhost:3001` (или HTTPS ако има сертификати).

---

## Тестове

```bash
# Unit тестове
pnpm test

# Unit тестове (watch mode)
pnpm test:watch

# Integration тестове (изисква работеща PostgreSQL)
pnpm test:integration

# E2E тестове
pnpm test:e2e
```

---

## Docker

### Само базата данни (за локална разработка)

```bash
docker compose up db -d
```

### Пълен stack (backend + PostgreSQL)

```bash
docker compose up -d --build
```

Услуги:
- **db** — PostgreSQL 16 на `127.0.0.1:5432`
- **backend** — NestJS на `127.0.0.1:3001`

Health check: `http://localhost:3001/api/health`

---

## Deployment

Виж [`DEPLOYMENT.md`](../DEPLOYMENT.md) в root директорията за пълно ръководство.

Накратко:
1. Копирай `.env.example` → `.env` и попълни production стойности
2. `docker compose up -d --build`
3. `docker compose exec backend npx prisma migrate deploy`
4. Постави Caddy пред порт 3001 за HTTPS

---

## Структура

```
src/
├── auth/               # JWT auth, 2FA, email верификация
├── users/              # Управление на потребители
├── rbac/               # Роли, права, permissions
├── requests/           # Застрахователни заявки
├── vehicles/           # Превозни средства
├── owners/             # Собственици
├── resources/          # Споделени ресурси (файлове, линкове)
├── insurance/          # Застраховки, Google Sheets sync, агент mapping
├── uploads/            # File upload за превозни средства
├── push-notifications/ # Web Push (VAPID)
├── notifications/      # In-app нотификации
├── admin-notifications/# Broadcast нотификации
├── audit/              # Одит лог
├── events/             # WebSocket gateway
├── email/              # Email транспорт (Nodemailer)
├── cache/              # In-memory кеш
├── health/             # Health check endpoint
├── prisma/             # Prisma service
├── config/             # Env validation
├── shared/             # Guards, filters, middleware, interceptors
└── main.ts             # App entry point
```

---

## API Документация

Всички endpoints са под `/api` prefix. Автентикацията използва HTTP-only cookies (`access_token`, `refresh_token`).

### Автентикация

| Метод | Endpoint | Описание | Auth |
|-------|----------|---------|------|
| POST | `/api/auth/login` | Вход с email + парола | — |
| POST | `/api/auth/refresh` | Обнови access token | — |
| POST | `/api/auth/logout` | Изход | ✓ |
| POST | `/api/auth/logout-all` | Изход от всички сесии | ✓ |
| GET | `/api/auth/me` | Текущ потребител | ✓ |
| PATCH | `/api/auth/me` | Промени username/парола | ✓ |
| POST | `/api/auth/2fa/setup` | Генерирай 2FA secret (QR код) | ✓ |
| POST | `/api/auth/2fa/verify-setup` | Активирай 2FA | ✓ |
| POST | `/api/auth/2fa/disable` | Деактивирай 2FA | ✓ |
| POST | `/api/auth/2fa/verify` | Верифицирай TOTP при вход | — |
| GET | `/api/auth/2fa/status` | Статус на 2FA | ✓ |
| POST | `/api/auth/email/send-verification` | Изпрати код за верификация | — |
| POST | `/api/auth/email/verify` | Верифицирай email код | — |

### Потребители

| Метод | Endpoint | Описание | Permission |
|-------|----------|---------|------------|
| GET | `/api/users` | Списък потребители | `USER_READ` |
| GET | `/api/users/:id` | Детайли за потребител | `USER_READ` |
| POST | `/api/users` | Създай потребител | `USER_CREATE` |
| PATCH | `/api/users/:id` | Редактирай потребител | `USER_UPDATE` |
| DELETE | `/api/users/:id` | Изтрий потребител | `USER_DELETE` |
| POST | `/api/users/:id/reset-2fa` | Ресетни 2FA на потребител | `USER_RESET_2FA` |
| POST | `/api/users/:id/unlock` | Отключи акаунт | `USER_UPDATE` |

### Роли и права

| Метод | Endpoint | Описание | Permission |
|-------|----------|---------|------------|
| GET | `/api/roles` | Списък роли | `ROLE_READ` |
| GET | `/api/roles/:id` | Детайли за роля | `ROLE_READ` |
| GET | `/api/roles/permissions` | Всички налични permissions | `ROLE_READ` |
| GET | `/api/roles/my-permissions` | Моите permissions | ✓ |
| POST | `/api/roles` | Създай роля | `ROLE_CREATE` |
| PATCH | `/api/roles/:id` | Редактирай роля | `ROLE_UPDATE` |
| DELETE | `/api/roles/:id` | Изтрий роля | `ROLE_DELETE` |
| POST | `/api/roles/assign` | Присвои роля на потребител | `USER_UPDATE` |
| POST | `/api/roles/unassign` | Премахни роля от потребител | `USER_UPDATE` |
| GET | `/api/roles/user/:userId` | Роли на потребител | `USER_READ` |

### Заявки

| Метод | Endpoint | Описание | Permission |
|-------|----------|---------|------------|
| GET | `/api/requests` | Всички заявки | `REQUEST_READ_ALL` |
| GET | `/api/requests/my` | Моите заявки | `REQUEST_READ_OWN` |
| GET | `/api/requests/check-by-reg` | Провери заявки по рег. номер | `REQUEST_READ_OWN` |
| GET | `/api/requests/:id` | Детайли за заявка | `REQUEST_READ_OWN` |
| POST | `/api/requests` | Създай заявка | `REQUEST_CREATE` |
| PATCH | `/api/requests/:id/status` | Промени статус (staff) | `REQUEST_UPDATE_STATUS` |
| PATCH | `/api/requests/:id/cancel` | Откажи собствена заявка | `REQUEST_CREATE` |
| PATCH | `/api/requests/:id/respond` | Приеми/откажи оферта | `REQUEST_RESPOND_OFFER` |
| POST | `/api/requests/:id/images` | Качи снимки към заявка | `REQUEST_CREATE` |
| POST | `/api/requests/:id/offer` | Качи оферта (ZAYAVENA→OBRABOTENA) | `REQUEST_UPDATE_STATUS` |
| POST | `/api/requests/:id/offer/append` | Добави снимки към оферта | `REQUEST_UPDATE_STATUS` |
| POST | `/api/requests/:id/documents` | Качи документи (→ZAVURSHENA) | `REQUEST_UPLOAD_DOCUMENT` |
| POST | `/api/requests/:id/documents/append` | Добави документи | `REQUEST_UPLOAD_DOCUMENT` |
| POST | `/api/requests/:id/copy-to-vehicle` | Копирай снимки към превозно средство | `REQUEST_UPDATE_STATUS` |
| GET | `/api/requests/:id/copy-to-vehicle/status` | Статус на копирането | `REQUEST_UPDATE_STATUS` |
| DELETE | `/api/requests/images/:imageId` | Изтрий снимка | `REQUEST_UPDATE_STATUS` |

**State machine:**
```
ZAYAVENA → OBRABOTENA (staff качва оферта) / OTKAZANA (staff отказва)
OBRABOTENA → PRIETA_OFERTA (агент приема, sticker задължителен) / OTKAZANA_OFERTA (агент отказва)
PRIETA_OFERTA → ZAVURSHENA (staff качва финални документи)
```

### Превозни средства

| Метод | Endpoint | Описание | Permission |
|-------|----------|---------|------------|
| GET | `/api/vehicles` | Списък превозни средства | `VEHICLE_READ` |
| GET | `/api/vehicles/:id` | Детайли | `VEHICLE_READ` |
| POST | `/api/vehicles` | Създай | `VEHICLE_CREATE` |
| PATCH | `/api/vehicles/:id` | Редактирай | `VEHICLE_UPDATE` |
| DELETE | `/api/vehicles/:id` | Изтрий | `VEHICLE_DELETE` |
| POST | `/api/vehicles/check-duplicates` | Провери за дубликати | `VEHICLE_CREATE` |
| POST | `/api/uploads/vehicles/:vehicleId/images` | Качи снимки | `VEHICLE_UPDATE` |
| GET | `/api/uploads/vehicles/:vehicleId/images` | Снимки на превозно средство | `VEHICLE_READ` |
| DELETE | `/api/uploads/images/:imageId` | Изтрий снимка | `VEHICLE_UPDATE` |

### Собственици

| Метод | Endpoint | Описание | Permission |
|-------|----------|---------|------------|
| GET | `/api/owners` | Списък собственици | `OWNER_READ` |
| GET | `/api/owners/:id` | Детайли | `OWNER_READ` |
| GET | `/api/owners/:id/vehicles` | Превозни средства на собственик | `OWNER_READ` |
| GET | `/api/owners/search` | Търсене | `OWNER_READ` |
| GET | `/api/owners/lookup` | Намери по идентификатор | `OWNER_READ` |
| POST | `/api/owners` | Създай | `OWNER_CREATE` |
| PATCH | `/api/owners/:id` | Редактирай | `OWNER_UPDATE` |
| DELETE | `/api/owners/:id` | Изтрий | `OWNER_DELETE` |

### Ресурси

| Метод | Endpoint | Описание | Permission |
|-------|----------|---------|------------|
| GET | `/api/resources` | Всички секции с ресурси | `RESOURCE_READ` |
| POST | `/api/resources/sections` | Създай секция | `RESOURCE_MANAGE` |
| PATCH | `/api/resources/sections/:id` | Редактирай секция | `RESOURCE_MANAGE` |
| DELETE | `/api/resources/sections/:id` | Изтрий секция | `RESOURCE_MANAGE` |
| POST | `/api/resources/sections/:id/items/link` | Добави линк | `RESOURCE_MANAGE` |
| POST | `/api/resources/sections/:id/items/file` | Качи файл | `RESOURCE_MANAGE` |
| POST | `/api/resources/sections/:id/items/files` | Качи множество файлове | `RESOURCE_MANAGE` |
| POST | `/api/resources/upload-folder` | Качи папка | `RESOURCE_MANAGE` |
| PATCH | `/api/resources/items/:id` | Редактирай item | `RESOURCE_MANAGE` |
| DELETE | `/api/resources/items/:id` | Изтрий item | `RESOURCE_MANAGE` |

### Застраховки

| Метод | Endpoint | Описание | Permission |
|-------|----------|---------|------------|
| GET | `/api/insurance/agent-names` | Уникални имена на агенти | `INSURANCE_MANAGE` |
| GET | `/api/insurance/agent-mappings` | Agent mappings | `INSURANCE_MANAGE` |
| GET | `/api/insurance/agent-mappings/users` | Потребители за mapping | `INSURANCE_READ` |
| POST | `/api/insurance/agent-mappings` | Създай mapping | `INSURANCE_MANAGE` |
| POST | `/api/insurance/agent-mappings/bulk` | Bulk assign | `INSURANCE_MANAGE` |
| DELETE | `/api/insurance/agent-mappings/:id` | Изтрий mapping | `INSURANCE_MANAGE` |
| GET | `/api/insurance/by-agent/stats` | Статистика (текущ агент) | `INSURANCE_AGENT_VIEW` |
| GET | `/api/insurance/by-agent/expiries` | Изтичащи (текущ агент) | `INSURANCE_AGENT_VIEW` |
| GET | `/api/insurance/by-agent/:userId/stats` | Статистика за агент | `INSURANCE_READ` |
| GET | `/api/insurance/by-agent/:userId/expiries` | Изтичащи за агент | `INSURANCE_READ` |
| GET | `/api/insurance/stats` | Глобална статистика | `INSURANCE_READ` |
| GET | `/api/insurance/expiries` | Всички изтичащи | `INSURANCE_READ` |
| GET | `/api/insurance/vehicle/:reg/history` | История за МПС | `INSURANCE_READ` |
| GET | `/api/insurance/spreadsheets` | Spreadsheets | `INSURANCE_MANAGE` |
| POST | `/api/insurance/spreadsheets` | Добави spreadsheet | `INSURANCE_MANAGE` |
| DELETE | `/api/insurance/spreadsheets/:id` | Премахни spreadsheet | `INSURANCE_MANAGE` |
| POST | `/api/insurance/spreadsheets/validate` | Валидирай spreadsheet | `INSURANCE_MANAGE` |
| POST | `/api/insurance/spreadsheets/:id/archive` | Архивирай | `INSURANCE_MANAGE` |
| POST | `/api/insurance/spreadsheets/:id/refresh` | Възстанови от архив | `INSURANCE_MANAGE` |
| POST | `/api/insurance/sync` | Принудителна синхронизация | `INSURANCE_MANAGE` |

### Push Нотификации

| Метод | Endpoint | Описание | Auth |
|-------|----------|---------|------|
| GET | `/api/push/vapid-public-key` | VAPID публичен ключ | ✓ |
| POST | `/api/push/subscribe` | Абонирай се | ✓ |
| DELETE | `/api/push/unsubscribe` | Откажи абонамент | ✓ |

### Нотификации

| Метод | Endpoint | Описание | Auth |
|-------|----------|---------|------|
| GET | `/api/notifications` | Моите нотификации | ✓ |
| PATCH | `/api/notifications/:id/read` | Маркирай като прочетена | ✓ |
| PATCH | `/api/notifications/read-all` | Маркирай всички | ✓ |
| DELETE | `/api/notifications` | Изчисти всички | ✓ |

### Admin Нотификации

| Метод | Endpoint | Описание | Permission |
|-------|----------|---------|------------|
| POST | `/api/admin-notifications/broadcast` | Broadcast нотификация | `USER_READ` |
| POST | `/api/admin-notifications/roles-list` | Роли за targeting | `USER_READ` |
| POST | `/api/admin-notifications/users-list` | Потребители за targeting | `USER_READ` |

### Одит Лог

| Метод | Endpoint | Описание | Permission |
|-------|----------|---------|------------|
| GET | `/api/audit-logs` | Одит записи | `AUDIT_READ` |
| GET | `/api/audit-logs/:id` | Детайли за запис | `AUDIT_READ` |
| GET | `/api/audit-logs/entity-types` | Типове entities | `AUDIT_READ` |
| GET | `/api/audit-logs/actions` | Типове действия | `AUDIT_READ` |
| POST | `/api/audit-logs/client-error` | Запис на client-side грешка | — (публичен) |

### Health Check

| Метод | Endpoint | Описание |
|-------|----------|---------|
| GET | `/api/health` | Статус на приложението |

---

## Сигурност

- **Passwords** — argon2id + HMAC pepper
- **Sessions** — HTTP-only cookies, CSRF token (custom header `X-CSRF-Token`)
- **Rate limiting** — Throttler: 100 req/min глобално, по-строги лимити за auth endpoints
- **Brute-force защита** — Exponential backoff, account lock след N неуспешни опита
- **Headers** — Helmet (CSP, HSTS, X-Frame-Options и др.)
- **Fingerprinting** — Device fingerprint header `X-Fingerprint` за допълнителна верификация

---

## Лиценз

Частен проект — всички права запазени.
