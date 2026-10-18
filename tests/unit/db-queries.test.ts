import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as poolModule from '@/lib/db/pool';
import {
  findUserByEmailOrUsername,
  findUserById,
  createUser,
  updateUserRole,
  updateUserPassword,
  deleteUser,
  countAdmins,
  listAllUsersWithDetails,
  getUserProfile,
  upsertUserProfile,
  getUserDeviceTags,
  tagDeviceToUser,
  removeDeviceTagFromUser,
  recordLoginAttempt,
  getPaginatedLogins,
  saveAiInsight,
  getRecentAiInsights,
  getLatestAiInsight,
  resetDbFallbackForTests,
} from '@/lib/db/queries';

const UID = '11111111-2222-4333-8444-555555555555';

describe('PostgreSQL Database Queries Repository', () => {
  const mockQuery = vi.fn();
  const mockClientQuery = vi.fn();
  const mockRelease = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetDbFallbackForTests();
    vi.spyOn(poolModule, 'getDbPool').mockReturnValue({
      query: mockQuery,
      connect: async () => ({
        query: mockClientQuery,
        release: mockRelease,
      }),
    } as any);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetDbFallbackForTests();
  });

  describe('Error Handling', () => {
    it('rethrows non-connection errors across query functions', async () => {
      const syntaxError = new Error('syntax error at or near WHERE');
      mockQuery.mockRejectedValue(syntaxError);

      await expect(findUserByEmailOrUsername('admin')).rejects.toThrow('syntax error');
      await expect(findUserById(UID)).rejects.toThrow('syntax error');
      await expect(updateUserRole(UID, 'ADMIN')).rejects.toThrow('syntax error');
      await expect(updateUserPassword(UID, 'pw')).rejects.toThrow('syntax error');
      await expect(deleteUser(UID)).rejects.toThrow('syntax error');
      await expect(listAllUsersWithDetails()).rejects.toThrow('syntax error');
      await expect(getUserProfile(UID)).rejects.toThrow('syntax error');
      await expect(upsertUserProfile(UID, { fullName: 'name' })).rejects.toThrow('syntax error');
      await expect(getUserDeviceTags(UID)).rejects.toThrow('syntax error');
      await expect(tagDeviceToUser(UID, 'AA:BB:CC:DD:EE:FF', 'label')).rejects.toThrow('syntax error');
      await expect(removeDeviceTagFromUser(UID, 'AA:BB:CC:DD:EE:FF')).rejects.toThrow('syntax error');
      await expect(getPaginatedLogins(1, 10)).rejects.toThrow('syntax error');
      await expect(
        saveAiInsight({
          triggeredByUserId: UID,
          healthScore: 90,
          previousScore: null,
          scoreDelta: 0,
          trendDirection: 'INITIAL',
          executiveSummary: '',
          resolvedIssues: [],
          persistingIssues: [],
          newIssues: [],
          actionableSuggestions: [],
          metricsSnapshot: {},
        })
      ).rejects.toThrow('syntax error');
      await expect(getRecentAiInsights(5)).rejects.toThrow('syntax error');
      await expect(getLatestAiInsight()).rejects.toThrow('syntax error');
      await expect(countAdmins()).rejects.toThrow('syntax error');
    });

    it('rethrows connection errors instead of falling back to memory in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('ALLOW_MEMORY_FALLBACK', '');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const connErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
      mockQuery.mockRejectedValue(connErr);

      await expect(findUserByEmailOrUsername('admin@omadanoc.com')).rejects.toThrow('ECONNREFUSED');
      await expect(findUserById(UID)).rejects.toThrow('ECONNREFUSED');
      await expect(countAdmins()).rejects.toThrow('ECONNREFUSED');
      expect(poolModule.isMemoryFallbackActive()).toBe(false);

      // The audit write still never crashes the login flow
      await expect(
        recordLoginAttempt(null, 'admin@omadanoc.com', '127.0.0.1', 'UA', 'FAILED', 'x')
      ).resolves.toBeUndefined();
    });

    it('switches to the memory store from every query catch block on connection errors in dev', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const connErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
      mockQuery.mockRejectedValue(connErr);
      const ADMIN_ID = '00000000-0000-0000-0000-000000000001';

      // Reset before each call so every function takes its own catch -> fallback path
      const viaCatch = async <T>(fn: () => Promise<T>): Promise<T> => {
        resetDbFallbackForTests();
        const result = await fn();
        expect(poolModule.isMemoryFallbackActive()).toBe(true);
        return result;
      };

      expect((await viaCatch(() => findUserById(ADMIN_ID)))?.role).toBe('ADMIN');
      expect((await viaCatch(() => findUserByEmailOrUsername('admin')))?.id).toBe(ADMIN_ID);
      expect(await viaCatch(() => updateUserRole(ADMIN_ID, 'ADMIN'))).not.toBeNull();
      expect(await viaCatch(() => updateUserPassword(UID, 'hash'))).toBe(false);
      expect(await viaCatch(() => deleteUser(UID))).toBe(false);
      expect((await viaCatch(() => listAllUsersWithDetails())).length).toBeGreaterThanOrEqual(1);
      expect(await viaCatch(() => getUserProfile(ADMIN_ID))).not.toBeNull();
      expect((await viaCatch(() => upsertUserProfile(ADMIN_ID, { department: 'NOC' }))).department).toBe('NOC');
      expect((await viaCatch(() => tagDeviceToUser(ADMIN_ID, '02:00:00:00:00:01'))).macAddress).toBe('02-00-00-00-00-01');
      expect(await viaCatch(() => getUserDeviceTags(ADMIN_ID))).toHaveLength(1);
      expect(await viaCatch(() => removeDeviceTagFromUser(ADMIN_ID, '02-00-00-00-00-01'))).toBe(true);
      await viaCatch(() => recordLoginAttempt(null, 'x@test.com', '127.0.0.1', 'UA', 'FAILED', 'x'));
      expect((await viaCatch(() => getPaginatedLogins(1, 10))).total).toBeGreaterThanOrEqual(1);
      const insight = await viaCatch(() =>
        saveAiInsight({
          triggeredByUserId: ADMIN_ID,
          healthScore: 77,
          previousScore: null,
          scoreDelta: 0,
          trendDirection: 'INITIAL',
          executiveSummary: 'catch path',
          resolvedIssues: [],
          persistingIssues: [],
          newIssues: [],
          actionableSuggestions: [],
          metricsSnapshot: {},
        })
      );
      expect((await viaCatch(() => getRecentAiInsights(1)))[0].id).toBe(insight.id);
      expect((await viaCatch(() => getLatestAiInsight()))?.id).toBe(insight.id);

      // createUser fails at pool.connect()
      vi.spyOn(poolModule, 'getDbPool').mockReturnValue({
        query: mockQuery,
        connect: async () => {
          throw connErr;
        },
      } as any);
      const created = await viaCatch(() => createUser('catchuser', 'catch@test.com', 'hash'));
      expect(created.username).toBe('catchuser');
    });

    it('honours ALLOW_MEMORY_FALLBACK in both directions', async () => {
      const connErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
      mockQuery.mockRejectedValue(connErr);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.stubEnv('ALLOW_MEMORY_FALLBACK', 'false');
      await expect(findUserByEmailOrUsername('admin')).rejects.toThrow('ECONNREFUSED');

      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('ALLOW_MEMORY_FALLBACK', 'true');
      const admin = await findUserByEmailOrUsername('admin');
      expect(admin?.role).toBe('ADMIN');
      expect(poolModule.isMemoryFallbackActive()).toBe(true);
      expect(await countAdmins()).toBeGreaterThanOrEqual(1);
    });
  });

  describe('User Queries', () => {
    it('findUserByEmailOrUsername returns user when found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'uuid-1',
            username: 'admin',
            email: 'admin@omadanoc.com',
            passwordHash: 'hashed123',
            role: 'ADMIN',
          },
        ],
      });

      const user = await findUserByEmailOrUsername('admin@omadanoc.com');
      expect(user).toBeDefined();
      expect(user?.username).toBe('admin');
      expect(mockQuery).toHaveBeenCalled();
    });

    it('findUserByEmailOrUsername returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const user = await findUserByEmailOrUsername('nonexistent');
      expect(user).toBeNull();
    });

    it('findUserById returns user or null', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: UID, username: 'admin', email: 'admin@omada.com', role: 'ADMIN' }],
      });

      const user = await findUserById(UID);
      expect(user?.id).toBe(UID);

      mockQuery.mockResolvedValueOnce({ rows: [] });
      expect(await findUserById(UID)).toBeNull();
    });

    it('short-circuits malformed (non-UUID) ids without querying Postgres', async () => {
      expect(await findUserById('not-a-uuid')).toBeNull();
      expect(await updateUserRole('1', 'ADMIN')).toBeNull();
      expect(await updateUserPassword("1' OR '1'='1", 'hash')).toBe(false);
      expect(await deleteUser('')).toBe(false);
      expect(await getUserProfile('abc')).toBeNull();
      expect(await getUserDeviceTags('abc')).toEqual([]);
      expect(await removeDeviceTagFromUser('abc', 'AA-BB-CC-DD-EE-FF')).toBe(false);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('countAdmins counts ADMIN accounts', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] });
      expect(await countAdmins()).toBe(2);
      expect(mockQuery.mock.calls[0][0]).toContain("role = 'ADMIN'");

      mockQuery.mockResolvedValueOnce({ rows: [] });
      expect(await countAdmins()).toBe(0);
    });

    it('createUser creates user and default profile inside transaction', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'new-uuid', username: 'jdoe', email: 'jdoe@test.com', role: 'USER' }],
        }) // INSERT user
        .mockResolvedValueOnce({}) // INSERT profile
        .mockResolvedValueOnce({}); // COMMIT

      const user = await createUser('jdoe', 'jdoe@test.com', 'hashedpass', 'USER', 'John Doe');
      expect(user.id).toBe('new-uuid');
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('createUser rolls back on error', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('Duplicate key violation')); // INSERT fails

      await expect(
        createUser('duplicate', 'dup@test.com', 'hash', 'USER')
      ).rejects.toThrow('Duplicate key violation');

      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('updateUserRole updates role', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: UID, role: 'ADMIN' }],
      });

      const res = await updateUserRole(UID, 'ADMIN');
      expect(res?.role).toBe('ADMIN');
    });

    it('updateUserPassword updates password hash', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      const success = await updateUserPassword(UID, 'newhash');
      expect(success).toBe(true);
    });

    it('deleteUser deletes user', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      const success = await deleteUser(UID);
      expect(success).toBe(true);
    });

    it('listAllUsersWithDetails aggregates users and tagged devices', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'u1',
              username: 'user1',
              email: 'u1@test.com',
              role: 'USER',
              fullName: 'User One',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'tag1',
              userId: 'u1',
              macAddress: 'AA:BB:CC:DD:EE:01',
              deviceName: 'Work Laptop',
            },
          ],
        });

      const users = await listAllUsersWithDetails();
      expect(users).toHaveLength(1);
      expect(users[0].taggedDevices).toHaveLength(1);
      expect(users[0].taggedDevices[0].macAddress).toBe('AA:BB:CC:DD:EE:01');
    });
  });

  describe('Profile Queries', () => {
    it('getUserProfile returns profile or null', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p1', userId: 'u1', fullName: 'Jane Doe', theme: 'dark' }],
      });

      const profile = await getUserProfile(UID);
      expect(profile?.fullName).toBe('Jane Doe');
    });

    it('upsertUserProfile inserts or updates profile', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p1', userId: 'u1', fullName: 'Updated Name', theme: 'dark' }],
      });

      const profile = await upsertUserProfile(UID, { fullName: 'Updated Name' });
      expect(profile.fullName).toBe('Updated Name');

      // Partial updates must keep omitted columns: DO UPDATE uses the raw params, not EXCLUDED
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('full_name = COALESCE($2, user_profiles.full_name)');
      expect(sql).toContain('theme = COALESCE($6, user_profiles.theme)');
      expect(sql).not.toContain('COALESCE(EXCLUDED.');
      expect(params).toEqual([UID, 'Updated Name', null, null, null, null]);
    });
  });

  describe('Device Tagging Queries', () => {
    it('getUserDeviceTags returns tags list', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't1', userId: 'u1', macAddress: 'AA:BB:CC:DD:EE:FF' }],
      });

      const tags = await getUserDeviceTags(UID);
      expect(tags).toHaveLength(1);
    });

    it('tagDeviceToUser stores the MAC canonically and inserts tag', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't1', userId: UID, macAddress: 'AA-BB-CC-DD-EE-FF', deviceName: 'My iPad' }],
      });

      const tag = await tagDeviceToUser(UID, ' aa:bb:cc:dd:ee:ff ', 'My iPad');
      expect(tag.macAddress).toBe('AA-BB-CC-DD-EE-FF');
      expect(mockQuery.mock.calls[0][1]).toEqual([UID, 'AA-BB-CC-DD-EE-FF', 'My iPad']);
    });

    it('tagDeviceToUser rejects MACs that are not 12 hex digits', async () => {
      await expect(tagDeviceToUser(UID, 'AA:BB', 'x')).rejects.toThrow('Invalid MAC address');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('removeDeviceTagFromUser deletes tag by user and separator-insensitive MAC', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      const success = await removeDeviceTagFromUser(UID, 'aa:bb:cc:dd:ee:ff');
      expect(success).toBe(true);
      expect(mockQuery.mock.calls[0][0]).toContain("REGEXP_REPLACE(mac_address, '[^a-fA-F0-9]', '', 'g')");
      expect(mockQuery.mock.calls[0][1]).toEqual([UID, 'AABBCCDDEEFF']);
    });
  });

  describe('Login Audit Queries', () => {
    it('recordLoginAttempt inserts login record', async () => {
      mockQuery.mockResolvedValueOnce({});
      await recordLoginAttempt('u1', 'user@test.com', '127.0.0.1', 'Mozilla', 'SUCCESS', null);
      expect(mockQuery).toHaveBeenCalled();
    });

    it('recordLoginAttempt catches non-connection errors gracefully without throwing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockQuery.mockRejectedValueOnce(new Error('Audit table disk full'));
      await recordLoginAttempt('u1', 'user@test.com', '127.0.0.1', 'Mozilla', 'FAILED', 'Disk issue');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('getPaginatedLogins returns 10 items per page with totals', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '25' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'l1',
              email: 'admin@test.com',
              ipAddress: '127.0.0.1',
              loginStatus: 'SUCCESS',
            },
          ],
        });

      const res = await getPaginatedLogins(1, 10);
      expect(res.total).toBe(25);
      expect(res.totalPages).toBe(3);
      expect(res.items).toHaveLength(1);
    });
  });

  describe('AI Insights History Queries', () => {
    it('saveAiInsight executes insert query with parameterized values', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ins-1',
            createdAt: '2026-08-28T12:00:00Z',
            triggeredByUserId: 'u1',
            healthScore: 90,
            previousScore: 85,
            scoreDelta: 5,
            trendDirection: 'IMPROVED',
            executiveSummary: 'Telemetry improved.',
            resolvedIssues: [],
            persistingIssues: [],
            newIssues: [],
            actionableSuggestions: [],
            metricsSnapshot: {},
          },
        ],
      });

      const res = await saveAiInsight({
        triggeredByUserId: 'u1',
        healthScore: 90,
        previousScore: 85,
        scoreDelta: 5,
        trendDirection: 'IMPROVED',
        executiveSummary: 'Telemetry improved.',
        resolvedIssues: [],
        persistingIssues: [],
        newIssues: [],
        actionableSuggestions: [],
        metricsSnapshot: {},
      });

      expect(res.id).toBe('ins-1');
      expect(mockQuery).toHaveBeenCalled();
    });

    it('getRecentAiInsights and getLatestAiInsight fetch history records', async () => {
      const mockRows = [
        {
          id: 'ins-1',
          createdAt: '2026-08-28T12:00:00Z',
          healthScore: 90,
          scoreDelta: 5,
          trendDirection: 'IMPROVED',
        },
      ];

      mockQuery.mockResolvedValueOnce({ rows: mockRows });
      const recent = await getRecentAiInsights(5);
      expect(recent).toHaveLength(1);

      mockQuery.mockResolvedValueOnce({ rows: mockRows });
      const latest = await getLatestAiInsight();
      expect(latest?.id).toBe('ins-1');

      // Test empty latest
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const emptyLatest = await getLatestAiInsight();
      expect(emptyLatest).toBeNull();
    });

    it('falls back to memory store on connection errors in saveAiInsight, getRecentAiInsights, and getLatestAiInsight', async () => {
      resetDbFallbackForTests();
      const connErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
        code: 'ECONNREFUSED',
      });
      mockQuery.mockRejectedValue(connErr);

      // countAdmins switches to memory from its own catch block
      expect(await countAdmins()).toBeGreaterThanOrEqual(1);
      expect(poolModule.isMemoryFallbackActive()).toBe(true);
      resetDbFallbackForTests();

      const saved = await saveAiInsight({
        triggeredByUserId: 'u-mem-1',
        healthScore: 88,
        previousScore: 80,
        scoreDelta: 8,
        trendDirection: 'IMPROVED',
        executiveSummary: 'Saved to memory fallback',
        resolvedIssues: [],
        persistingIssues: [],
        newIssues: [],
        actionableSuggestions: [],
        metricsSnapshot: { engineType: 'DEEPSEEK_AGENT', llmModel: 'deepseek-r1:7b' },
      });

      expect(saved.healthScore).toBe(88);
      expect(saved.engineType).toBe('DEEPSEEK_AGENT');

      const recent = await getRecentAiInsights(5);
      expect(recent.length).toBeGreaterThanOrEqual(1);
      expect(recent[0].healthScore).toBe(88);

      const latest = await getLatestAiInsight();
      expect(latest).toBeDefined();
      expect(latest?.healthScore).toBe(88);
    });
  });
});
