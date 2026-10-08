import { describe, expect, it } from 'vitest';
import { requestLogRedaction } from '../src/utils/log-redaction.js';

describe('request log redaction', () => {
  it('censors bearer tokens, cookies and API keys', () => {
    expect(requestLogRedaction.paths).toEqual(expect.arrayContaining([
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.set-cookie',
      'req.headers.x-api-key',
    ]));
    expect(requestLogRedaction.censor).toBe('[REDACTED]');
  });
});
