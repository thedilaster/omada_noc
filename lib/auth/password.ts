import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

// Valid cost-10 bcrypt hash of a random throwaway string; never matches a real password.
const DUMMY_PASSWORD_HASH = '$2b$10$Odr8lQ3ztDLc8A1lon.LDOC5YiPufsrUAURpBOCUged4tywDfNLOC';

/**
 * Generates a salted bcrypt hash for the provided plaintext password.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compares a plaintext password against a stored bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

/**
 * Burns one bcrypt comparison against a dummy hash so "unknown user" login attempts take
 * as long as "wrong password" ones (no user-enumeration timing oracle). Always false.
 */
export async function verifyDummyPassword(password: string): Promise<false> {
  await bcrypt.compare(String(password || ''), DUMMY_PASSWORD_HASH);
  return false;
}
