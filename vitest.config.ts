import { defineConfig } from 'vitest/config';

/**
 * Test-run environment.
 *
 * `src/config/env.ts` validates `process.env` at import time and throws if
 * `DATABASE_URL`, `DIRECT_URL` or `JWT_SECRET` is missing — everything else in
 * the schema has a default. It also does `import 'dotenv/config'`, so on a
 * developer machine a local `.env` silently satisfies it.
 *
 * That is why the suite passed locally and failed on CI: eleven test files do
 * nothing but import a service, that service imports `env.ts`, and with no
 * `.env` in the runner the import threw before a single test ran.
 *
 * Setting them here makes the suite self-contained — it passes on CI, on a
 * fresh clone, and for anyone who has never created a `.env`. These are not
 * secrets and are not connected to: the tests that use them are pure-function
 * tests, and nothing in the suite opens a database connection. Any test that
 * genuinely needs a real database should take it from the CI service
 * explicitly rather than inheriting whatever a laptop happens to hold.
 */
export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      DIRECT_URL: 'postgresql://test:test@localhost:5432/test',
      // env.ts requires at least 32 characters.
      JWT_SECRET: 'test-only-jwt-secret-not-used-for-anything-real',
    },
    coverage: { reporter: ['text', 'json', 'html'] },
  },
});
