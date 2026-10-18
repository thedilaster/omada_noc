import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getDbPool,
  closeDbPool,
  isConnectionOrAuthError,
  activateMemoryFallback,
  isMemoryFallbackActive,
  isMemoryFallbackAllowed,
  shouldFallbackToMemory,
  resetMemoryFallback,
} from '@/lib/db/pool';
import { initDb, resetInitDbForTests } from '@/lib/db/schema';
import * as poolModule from '@/lib/db/pool';
import * as passwordModule from '@/lib/auth/password';

describe('Database Pool and Schema Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMemoryFallback();
    resetInitDbForTests();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await closeDbPool();
  });

  describe('Pool Management & Error Handling', () => {
    it('initializes and returns a singleton connection pool', async () => {
      const pool1 = getDbPool();
      const pool2 = getDbPool();
      expect(pool1).toBe(pool2);
      expect(pool1).toBeDefined();

      await closeDbPool();
      const pool3 = getDbPool();
      expect(pool3).toBeDefined();
      await closeDbPool();
    });

    it('identifies connection and auth errors accurately', () => {
      expect(isConnectionOrAuthError(null)).toBe(false);
      expect(isConnectionOrAuthError({ code: 'ECONNREFUSED' })).toBe(true);
      expect(isConnectionOrAuthError({ code: '28P01' })).toBe(true);
      expect(isConnectionOrAuthError({ code: '3D000' })).toBe(true);
      expect(isConnectionOrAuthError(new Error('password authentication failed for user postgres'))).toBe(true);
      expect(isConnectionOrAuthError(new Error('connection terminated unexpectedly'))).toBe(true);
      expect(isConnectionOrAuthError(new Error('syntax error at or near WHERE'))).toBe(false);
    });

    it('activates and resets memory fallback state', () => {
      expect(isMemoryFallbackActive()).toBe(false);
      activateMemoryFallback('Testing fallback');
      expect(isMemoryFallbackActive()).toBe(true);
      resetMemoryFallback();
      expect(isMemoryFallbackActive()).toBe(false);
    });

    it('only allows memory fallback outside production unless ALLOW_MEMORY_FALLBACK overrides it', () => {
      vi.stubEnv('ALLOW_MEMORY_FALLBACK', '');
      expect(isMemoryFallbackAllowed()).toBe(true); // NODE_ENV=test

      vi.stubEnv('NODE_ENV', 'production');
      expect(isMemoryFallbackAllowed()).toBe(false);

      vi.stubEnv('ALLOW_MEMORY_FALLBACK', 'true');
      expect(isMemoryFallbackAllowed()).toBe(true);

      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('ALLOW_MEMORY_FALLBACK', 'FALSE');
      expect(isMemoryFallbackAllowed()).toBe(false);
    });

    it('refuses to activate memory fallback when it is not allowed', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(activateMemoryFallback('db down')).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('memory fallback disabled'));
      expect(activateMemoryFallback()).toBe(false);
      expect(isMemoryFallbackActive()).toBe(false);

      // A flag set while allowed is ignored once fallback becomes disallowed
      vi.stubEnv('NODE_ENV', 'test');
      expect(activateMemoryFallback()).toBe(true);
      vi.stubEnv('NODE_ENV', 'production');
      expect(isMemoryFallbackActive()).toBe(false);
    });

    it('shouldFallbackToMemory only accepts connection/auth errors when fallback is allowed', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(shouldFallbackToMemory(new Error('syntax error'))).toBe(false);
      expect(isMemoryFallbackActive()).toBe(false);

      vi.stubEnv('NODE_ENV', 'production');
      expect(shouldFallbackToMemory({ code: 'ECONNREFUSED' })).toBe(false);

      vi.stubEnv('NODE_ENV', 'test');
      expect(shouldFallbackToMemory({ code: 'ECONNREFUSED', message: 'refused' })).toBe(true);
      expect(isMemoryFallbackActive()).toBe(true);
    });

    it('does not activate memory fallback from pool error events in production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const pool = getDbPool();
      const connErr = Object.assign(new Error('Connection terminated'), { code: 'ECONNREFUSED' });
      pool.listeners('error')[0](connErr);
      expect(isMemoryFallbackActive()).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('handles pool error events correctly', () => {
      const pool = getDbPool();
      const errorListeners = pool.listeners('error');
      expect(errorListeners.length).toBeGreaterThan(0);

      // Trigger connection error listener
      const connErr = new Error('Connection terminated');
      (connErr as any).code = 'ECONNREFUSED';
      errorListeners[0](connErr);
      expect(isMemoryFallbackActive()).toBe(true);

      // Trigger unexpected non-connection error listener
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const unexpectedErr = new Error('Unexpected pool corruption');
      errorListeners[0](unexpectedErr);
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('Schema Initialization & Auto-Seeding', () => {
    it('executes create table queries and seeds admin if user count is 0', async () => {
      const mockQuery = vi
        .fn()
        // 1. CREATE TABLE query
        .mockResolvedValueOnce({})
        // 2. SELECT COUNT(*) query (0 users)
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        // 3. INSERT user query
        .mockResolvedValueOnce({ rows: [{ id: 'seeded-admin-id' }] })
        // 4. INSERT profile query
        .mockResolvedValueOnce({});

      vi.spyOn(poolModule, 'getDbPool').mockReturnValue({ query: mockQuery } as any);
      vi.spyOn(passwordModule, 'hashPassword').mockResolvedValue('$2a$10$seededAdminHash');

      await initDb();

      expect(mockQuery).toHaveBeenCalledTimes(4);
      expect(mockQuery.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS users');
      expect(mockQuery.mock.calls[2][0]).toContain('INSERT INTO users');
      expect(mockQuery.mock.calls[2][0]).toContain('ON CONFLICT DO NOTHING');
      expect(mockQuery.mock.calls[3][0]).toContain('INSERT INTO user_profiles');
    });

    it('skips the profile insert when a concurrent seeder already created the admin', async () => {
      const mockQuery = vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        // ON CONFLICT DO NOTHING -> no row returned
        .mockResolvedValueOnce({ rows: [] });

      vi.spyOn(poolModule, 'getDbPool').mockReturnValue({ query: mockQuery } as any);
      vi.spyOn(passwordModule, 'hashPassword').mockResolvedValue('$2a$10$seededAdminHash');

      await initDb();
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it('memoizes initialization so concurrent and repeated calls share one run', async () => {
      const mockQuery = vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });
      vi.spyOn(poolModule, 'getDbPool').mockReturnValue({ query: mockQuery } as any);

      const first = initDb();
      const second = initDb();
      expect(second).toBe(first);
      await Promise.all([first, second]);
      await initDb();
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('rethrows DB failures in production and retries on the next call', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const connErr = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      const mockQuery = vi
        .fn()
        .mockRejectedValueOnce(connErr)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });
      vi.spyOn(poolModule, 'getDbPool').mockReturnValue({ query: mockQuery } as any);

      await expect(initDb()).rejects.toThrow('ECONNREFUSED');
      expect(isMemoryFallbackActive()).toBe(false);

      // The failed attempt is not memoized
      await expect(initDb()).resolves.toBeUndefined();
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it('falls back to the in-memory store in development when PostgreSQL is unreachable', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockQuery = vi.fn().mockRejectedValue(new Error(''));
      vi.spyOn(poolModule, 'getDbPool').mockReturnValue({ query: mockQuery } as any);

      await initDb();
      expect(isMemoryFallbackActive()).toBe(true);
    });

    it('skips seeding when users already exist in the database', async () => {
      const mockQuery = vi
        .fn()
        // 1. CREATE TABLE query
        .mockResolvedValueOnce({})
        // 2. SELECT COUNT(*) query (1 user exists)
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      vi.spyOn(poolModule, 'getDbPool').mockReturnValue({ query: mockQuery } as any);

      await initDb();

      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });
});
