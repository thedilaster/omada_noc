import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, verifyDummyPassword } from '@/lib/auth/password';

describe('Password Security Module', () => {
  it('hashes a plaintext password and returns a valid bcrypt hash', async () => {
    const raw = 'SecretPassword123!';
    const hash = await hashPassword(raw);

    expect(hash).toBeDefined();
    expect(hash).not.toBe(raw);
    expect(hash.startsWith('$2')).toBe(true);
  });

  it('correctly verifies a matching password against its hash', async () => {
    const raw = 'AdminPass123!';
    const hash = await hashPassword(raw);

    const isMatch = await verifyPassword(raw, hash);
    expect(isMatch).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('CorrectPassword123!');
    const isMatch = await verifyPassword('WrongPassword', hash);
    expect(isMatch).toBe(false);
  });

  it('handles empty or missing parameters gracefully', async () => {
    expect(await verifyPassword('', '')).toBe(false);
    expect(await verifyPassword('something', '')).toBe(false);
  });

  it('runs a dummy bcrypt comparison that never succeeds (login timing parity)', async () => {
    expect(await verifyDummyPassword('AdminPass123!')).toBe(false);
    expect(await verifyDummyPassword('')).toBe(false);
  });
});
