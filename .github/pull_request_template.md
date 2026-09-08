## What this changes

<!-- One or two sentences. What behaviour is different after this merges? -->

## Why

<!-- The problem, not the solution. If it fixes a bug, say how the bug showed
     up — that is what tells a reviewer whether the fix is the right one. -->

## Tests

<!-- Required. Every change to behaviour needs a test that fails without it.

     If you genuinely could not add one, say why here. "It is only a config
     change", "it is presentation only", "it needs a live payment provider" are
     all acceptable answers. "I will add it later" is not — that is how a
     codebase ends up with a payment path nobody tests. -->

- [ ] Added or updated tests, **and checked they fail without the change**
- [ ] No test added — reason:

## Checks

- [ ] `pnpm verify` passes locally (prisma generate → lint → typecheck → test → build)
- [ ] Schema change? A migration is included, and `prisma migrate diff` is clean
- [ ] New env var? Added to `.env.example` **and** to the deployment environment
- [ ] Touches money, auth, permissions or personal data? Say so here so it gets a closer read

## Anything a reviewer should know

<!-- Deliberate trade-offs, things left out on purpose, follow-up work. -->
