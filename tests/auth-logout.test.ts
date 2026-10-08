import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const controller = readFileSync(
  fileURLToPath(new URL('../src/controllers/auth.controller.ts', import.meta.url)),
  'utf8',
);

describe('logout controller', () => {
  it('clears the refresh cookie and returns 204 even if session revocation fails', () => {
    expect(controller).toMatch(
      /try\s*\{\s*await auth\.logout\(readCookie\(request\)\);\s*\}\s*catch\s*\(error\)\s*\{[\s\S]*?request\.log\?\.error\([\s\S]*?\}\s*response\.clearCookie\(cookieName, \{ path: '\/api\/v1\/auth' \}\)\.status\(204\)\.end\(\);/,
    );
  });
});
