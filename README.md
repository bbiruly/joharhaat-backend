# JoharHaat API

Production-oriented transactional API for JoharHaat's multi-vendor marketplace. It uses Node.js 22, Express, TypeScript, Prisma and Neon PostgreSQL without Docker.

## Neon configuration

Create a Neon development branch and copy both connection strings into `.env`:

- `DATABASE_URL`: pooled hostname (normally contains `-pooler`) for API runtime traffic.
- `DIRECT_URL`: direct hostname for Prisma migrations, seed and Studio.

Keep `sslmode=require` in both URLs. Never commit `.env` or database credentials.

## Setup and migrations

```bash
pnpm install
cp .env.example .env
pnpm prisma:generate
pnpm prisma:format
pnpm prisma:validate
pnpm prisma:migrate:dev --name init_joharhaat
pnpm prisma:seed
pnpm dev
```

`prisma.config.ts` deliberately points Prisma CLI operations at `DIRECT_URL`; the generated runtime client in `src/db/prisma.ts` uses `DATABASE_URL` through `@prisma/adapter-pg`.

Production releases must apply committed migrations before starting the new API build:

```bash
pnpm prisma:validate
pnpm prisma:migrate:deploy
pnpm build
pnpm start
```

Open Prisma Studio over the direct Neon connection:

```bash
pnpm prisma:studio
```

Use `prisma db push` only for disposable development databases. It is intentionally not a package script and must not replace versioned migrations in production.

## API routes

- `POST /api/v1/checkout` — customer JWT plus an `Idempotency-Key` header.
- `POST /api/v1/payouts/escrow/:vendorOrderId/release` — admin or system JWT.
- `GET /api/v1/products/search` — public filtered search.
- `GET /api/v1/health/live` — process liveness.
- `GET /api/v1/health/ready` — database readiness.
- `/api/v1/auth/*` — registration, login, rotating refresh, logout and password recovery.
- `/api/v1/me`, `/addresses`, `/cart`, `/wishlist`, `/orders` — customer account and commerce resources.
- `/api/v1/categories`, `/districts`, `/haats`, `/products/:id` — public catalog discovery.
- `/api/v1/payments/*` — mock payment intent, confirmation and signed webhook lifecycle.
- `/api/v1/vendor/*` and `/api/v1/vendor-applications` — verified vendor operations and public KYC onboarding.
- `/api/v1/admin/*` — analytics, Haat operations, abandoned-cart actions and vendor moderation.
- `/api/docs` and `/api/openapi.json` — interactive and machine-readable API documentation.

Seeded development accounts use password `JoharHaat123`: `asha@example.test`, `vendor@example.test`, and `admin@example.test`. These credentials are demo-only and must never be used in production.

Sensitive KYC policy: raw Aadhaar numbers, Aadhaar files and complete bank account numbers are not accepted or persisted. Vendor applications retain verification state/reference, IFSC, account-holder name and bank last four only.

JWTs must contain `sub` and a `role` claim (`CUSTOMER`, `VENDOR`, `ADMIN`, or `SYSTEM`) and match the configured issuer and audience. Login/token issuance, payment capture, real courier integrations and real SMS delivery are intentionally outside this transactional core.

## Transaction guarantees

Checkout and payout release use serializable interactive transactions. Checkout locks variants in sorted order before validating authoritative prices and stock. Inventory, order splits, status logs and SMS outbox jobs commit atomically. SMS processing starts only after commit. Escrow release locks the suborder and vendor, then relies on a unique wallet-ledger key to make concurrent releases idempotent.

Run local checks with:

```bash
pnpm typecheck
pnpm test
pnpm build
```
