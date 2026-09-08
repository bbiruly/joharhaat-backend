# CI, and how merges are gated

Both repositories are on GitHub, so this uses **GitHub Actions**. Moving to
GitLab CI would mean migrating both repos for no benefit — GitLab CI is the
better choice only when the code already lives on GitLab.

## What runs, and when

`.github/workflows/ci.yml` runs on **every pull request** and on **pushes to
main**. Two jobs:

| Job | Steps |
|---|---|
| **verify** | install → `prisma generate` → `prisma validate` → lint → typecheck → test → build |
| **migrations** | spins up a throwaway Postgres, applies every migration to it, then fails if the schema has drifted from the migrations |

The migrations job exists because a schema edit without a matching migration
passes every other check and then fails on deploy, against the production
database. `prisma migrate diff --exit-code` returns 2 when they disagree. That
was verified both ways before shipping: 0 on a clean tree, 2 after adding a
column to the schema with no migration.

CI needs **no secrets and no live database**. `prisma generate` reads a
datasource URL from `prisma.config.ts` but never connects, so placeholders are
enough. A pipeline that depends on a real database is a pipeline that goes red
for reasons unrelated to the change.

The same pipeline is one command locally:

```bash
pnpm verify
```

Run it before opening a PR. If it passes locally it passes in CI — that is the
point of them being the same list.

## Making the checks block a merge

The workflow alone does not stop anyone merging a red PR. That comes from
branch protection, which has to be switched on in the GitHub UI once per repo.
It cannot be committed to the repository.

**Settings → Branches → Add branch ruleset** (or *Add rule* on older UI), for
`main`, on **both** `joharhaat-backend` and `joharhaat-website`:

- ✅ **Require a pull request before merging**
  - Required approvals: **1**
  - ✅ Dismiss stale approvals when new commits are pushed
    *(otherwise an approval from three commits ago still counts)*
- ✅ **Require status checks to pass before merging**
  - ✅ Require branches to be up to date before merging
  - Select these checks (they appear in the list after CI has run once):
    - backend: `Lint, typecheck, test, build` and `Migrations are complete`
    - website: `Lint, typecheck, test, build`
- ✅ **Require conversation resolution before merging**
- ✅ **Block force pushes**
- ✅ **Do not allow bypassing the above settings**
  *(without this, an admin — including you — merges past a red build by
  accident, which is exactly when it matters most)*

The status checks only appear in that list **after the workflow has run at
least once** on the repo. So: push this, open one PR, let CI run, then set the
rules.

## Why the PR template asks about tests

`.github/pull_request_template.md` asks for a test and, if there is none, for
the reason. CI cannot tell whether a change *should* have had a test — only a
person can. Making the answer a required line in every PR is what keeps
"I will add it later" from being the silent default.

A coverage threshold was deliberately **not** added yet. Current coverage is
mostly pure functions; a threshold set at today's level would pass without
meaning anything, and one set higher would fail every PR until the gap is
closed. Add it once the checkout and payment paths have integration tests —
that is the coverage that matters.

## Known gap

The highest-risk code in this repository — checkout, payment intents, stock
reservation — has **no integration tests**. It has been verified by hand
against a live API, but nothing re-verifies it on every change. Closing that is
the most valuable test work available, and it should happen alongside the real
payment provider integration rather than against the current mock.
