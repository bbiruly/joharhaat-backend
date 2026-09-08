# Working on JoharHaat (API)

Read this before your first change. It is the shortest path to a PR that gets
merged, and it encodes decisions this codebase has already paid for once.

If you are an AI coding assistant: this file is your context, together with
`docs/ci.md` and `projectdetails.md` in the `joharhaat-website` repo — that file
documents both sides of the system.

---

## 1. What this is

The API for JoharHaat, a multi-vendor marketplace for Jharkhand — tribal artisan
collectives, self-help groups and farm producers. Money flows customer → escrow
→ vendor payout, with a 10% platform commission.

Express 5 · Prisma 7 · PostgreSQL (Neon) · Zod · Vitest · TypeScript ESM.

Three audiences behind one API: customers, vendors, and internal operators
whose access is permission-checked and audited.

## 2. Setup

```bash
pnpm install
cp .env.example .env     # fill in DATABASE_URL, DIRECT_URL, JWT_SECRET
pnpm prisma:generate
pnpm prisma:migrate:deploy
pnpm dev
```

Node 22, pnpm 11. `src/generated/prisma` is gitignored — `prisma:generate`
recreates it and must run after any schema change or fresh clone.

## 3. The loop

```
branch from main  →  change  →  test  →  pnpm verify  →  PR  →  CI green  →  merge
```

### Branch per change

Create a **new branch from an up-to-date `main`**, named after the work:

```
feat/razorpay-integration
fix/coupon-usage-limit
ci/coverage-thresholds
chore/upgrade-prisma
```

One branch per PR-sized unit. Do **not** keep adding commits to a branch whose
name no longer matches what is on it — this project did exactly that and ended
up with review moderation and CI setup on a branch called
`fix/phase0-admin-rbac-hardening`. Nobody could tell what a PR contained from
its title.

Pushing a fix to a PR branch that is **still open** is fine — that is the same
change, not a new one.

### Test what you change

Every change to behaviour needs a test, and the test must **fail without the
change**. Write it, watch it fail, then make it pass. A test that passes before
your fix is testing nothing.

```bash
pnpm test
```

The suite is fast because it is almost entirely **pure functions**. That is
deliberate and it is the pattern to follow: pull the decision out of the
service, export it, and test it without a database.

```ts
// service
export function assertCouponValid(input: CouponInput) { … }

// test
expect(codeOf({ ...valid, percent: 100 })).toBe('COUPON_PERCENT_INVALID');
```

Where a rule cannot be extracted, tests assert the **shape of the code** that
enforces it — see `tests/review.test.ts` checking that the entitlement gate runs
before the insert, or `tests/admin-audit.test.ts` checking that every audit
action goes through `codeOf()`. Crude, but it catches the class of regression
that matters.

**Tests must not read your `.env`.** `vitest.config.ts` supplies the three
variables that have no default. To confirm a green run is real, move your `.env`
aside and run the suite — that is what CI does. This is not hypothetical: the
first CI run failed for exactly this reason.

### Verify before you claim it works

```bash
pnpm verify   # prisma generate → lint → typecheck → test → build
```

CI runs the same list plus a migration-drift check. Green here means green
there.

### PR and merge

Fill in the PR template. CI must be green before merge; branch protection
enforces it. `docs/ci.md` has the exact settings and the reasoning.

---

## 4. Rules this codebase learned the hard way

### Every admin action is permission-checked and audited

`adminAccess(userId, permission)` gates the function, not just the route. An
audit pass once found **eleven** admin functions with no permission check at
all — a MODERATOR could read GMV and customer PII, a MARKETING admin could
approve vendors. Route-level `authorize(UserRole.ADMIN)` is the coarse gate; the
fine one lives in the service.

Write the audit row through `writeAudit`, keyed on a **status code** from
`src/config/status-codes.ts`. Never build `action` from a template literal —
two sites once did (`VENDOR_${status}`), so the table held a mix of stable codes
and free text, and a filter built on one convention hid every row written in the
other. `tests/admin-audit.test.ts` fails if it happens again.

### SUPER_ADMIN cannot be granted through the API

It can never be disabled or demoted through the API either, so one created that
way would be permanent. Both the route schema and `createTeamMember` refuse it;
granting it is the database's job. Do not "helpfully" add it back to an enum.

### Errors are sanitised, and carry a code

`ApiError(status, message, code)`. The message is safe to show; the code is what
the web app switches on. When you add a domain error, add its copy to
`codeCopy` in the website's `lib/admin/errors.ts` — otherwise the UI falls back
to generic copy chosen by HTTP status, which once mapped a "this MSME number is
taken" 409 to "someone else changed this record first" and sent operators
chasing a race condition that did not exist.

### Money is Decimal, and the server is the authority

Never `Number()` a price for arithmetic. Use `src/utils/money.ts` —
`money`, `sumMoney`, `allocateMoney`. Totals, tax and stock are computed
server-side and the client displays what it is given.

Coupon discounts are absorbed by the platform: `VendorOrder` has no discount
column, so the maker is paid on the undiscounted total. That is a business
decision, stated in `checkout.service.ts`.

### Reviews require a delivered order

`assertCanReview` — a review must carry a DELIVERED vendor order that contained
the product, on the caller's own account. "Verified buyer" is a fact about how
the row got there, not a label. `verifiedPurchase` is derived at read time,
never stored, never accepted from a client.

### Uploads are validated by key prefix

`objectKey` arrives from the browser. A review may only attach a key minted by
the review presign endpoint — otherwise a crafted request could attach someone
else's KYC certificate to a public product page.

### Schema changes need a migration

CI applies every migration to an empty database and fails if the schema has
drifted. Run `pnpm prisma:migrate:dev` — do not hand-edit generated SQL.

---

## 5. Conventions

- **ESM**: relative imports need the `.js` extension, even from `.ts`.
- `exactOptionalPropertyTypes` is on. `field?: string | undefined` is not the
  same as `field?: string`.
- Prisma `groupBy` loses its result typing inside `$transaction` — run those
  with `Promise.all` instead, and say why in a comment.
- Districts are `SCREAMING_SNAKE` enum values.
- Linting is `oxlint`. Not ESLint.
- Services own the rules; controllers only unwrap the request and wrap the
  response.

## 6. What is still mock

There is code for these, but they do not work. Do not build on them as if they
did, and do not describe the system as production-ready while they stand:

| | State |
|---|---|
| **Payments** | `confirmIntent` takes the outcome **from the client**. Any signed-in customer can produce a paid order without paying. No gateway, no signature verification, no real webhook. |
| **Object storage** | `mockObjectStorage` returns a URL and stores nothing. Product photos and KYC certificates go nowhere. |
| **Email** | Written to `emailOutbox`, logged by the worker, marked sent. Password reset is therefore unusable. |
| **SMS** | Same shape. Vendors receive no order alerts. |
| **Courier** | The shipping label says it is not connected to a provider. |

The background worker is a `setInterval` inside the API process with `.unref()`.
It releases expired stock reservations, so if the process dies, held stock
leaks. Moving it to its own process or a scheduled job is required before real
traffic.

Checkout and payments have **no integration tests**. They have been verified by
hand against a live API; nothing re-verifies them on every change. That is the
most valuable test work available and it should land alongside the real payment
provider.
