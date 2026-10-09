import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('../src/middleware/error-handler.ts', import.meta.url)), 'utf8');

describe('database connection error mapping', () => {
  it('returns a retryable service-unavailable response for Prisma P1001', () => {
    expect(source).toContain("error.code === 'P1001'");
    expect(source).toContain("new ApiError(503");
    expect(source).toContain("'DATABASE_UNAVAILABLE'");
  });
});
