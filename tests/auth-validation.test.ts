import { describe, expect, it } from 'vitest';
import { registerSchema } from '../src/schemas/auth.schema.js';

describe('auth validation', () => {
  it('accepts a strong password and Indian mobile', () => expect(registerSchema.parse({ name: 'Asha Munda', email: 'ASHA@example.test', mobile: '9876543210', password: 'JoharHaat123' }).email).toBe('asha@example.test'));
  it('rejects weak passwords and invalid mobile numbers', () => { expect(() => registerSchema.parse({ name: 'Asha', email: 'a@example.test', mobile: '123', password: 'weak' })).toThrow(); });
});
