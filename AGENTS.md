# JoharHaat API — start here

**Read `CONTRIBUTING.md` before making any change.** It carries the working
agreement for this repository: how to branch, the testing standard, and a set of
rules that exist because breaking them already caused real problems here.

Read it in full once per session before you edit anything. It is short.

Also worth loading:

- `docs/ci.md` — what CI runs, why, and how merges are gated.
- `projectdetails.md` in the sibling `joharhaat-website` repo — the structural
  reference for **both** sides of the system, plus the phase log of what has
  been done and what is planned.

## The parts most often got wrong

- **Do not describe this system as production-ready.** Payments, object
  storage, email, SMS and courier are all mock. `CONTRIBUTING.md` §6 lists
  exactly what does not work. Payment confirmation currently takes its outcome
  from the client.
- **Every behaviour change needs a test that fails without it.** Write it,
  watch it fail, then make it pass.
- **New branch from `main` for each piece of work**, named after the work.
  Never keep piling commits onto a branch whose name no longer fits.
- **Verify in conditions that match CI**, not conditions that flatter you. Move
  your `.env` aside before trusting a green test run — the first CI run here
  failed for precisely that reason.
- Run `pnpm verify` before opening a PR. It is the same list CI runs.
