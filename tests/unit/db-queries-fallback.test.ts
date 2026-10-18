import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as poolModule from '@/lib/db/pool';
import {
  findUserByEmailOrUsername,
  findUserById,
  createUser,
  updateUserRole,
  updateUserPassword,
  deleteUser,
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
import { initDb, resetInitDbForTests } from '@/lib/db/schema';

describe('Database Queries with Connection and Auth Failure Fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbFallbackForTests();
    resetInitDbForTests();
  });

  it('transparently initializes and falls back to in-memory store on connection refusal', async () => {
    const connError = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    (connError as any).code = 'ECONNREFUSED';

    const mockPool = {
      query: vi.fn().mockRejectedValue(connError),
      connect: vi.fn().mockRejectedValue(connError),
      on: vi.fn(),
    };

    vi.spyOn(poolModule, 'getDbPool').mockReturnValue(mockPool as any);

    await initDb();

    // 1. findUserByEmailOrUsername
    const admin = await findUserByEmailOrUsername('admin@omadanoc.com');
    expect(admin).not.toBeNull();
    expect(admin?.role).toBe('ADMIN');

    // 2. findUserById
    const userById = await findUserById(admin!.id);
    expect(userById?.email).toBe('admin@omadanoc.com');

    // 3. createUser (memory ids are real UUIDs, and no hash leaks into API responses)
    const newUser = await createUser('devuser', 'dev@omadanoc.com', 'hashedpwd', 'USER', 'Dev User');
    expect(newUser.username).toBe('devuser');
    expect(newUser).not.toHaveProperty('passwordHash');
    expect((await findUserById(newUser.id))?.username).toBe('devuser');

    // 4. updateUserRole
    const updatedRole = await updateUserRole(newUser.id, 'ADMIN');
    expect(updatedRole?.role).toBe('ADMIN');

    // 5. updateUserPassword
    const pwUpdated = await updateUserPassword(newUser.id, 'newhash');
    expect(pwUpdated).toBe(true);

    // 6. listAllUsersWithDetails
    const users = await listAllUsersWithDetails();
    expect(users.length).toBeGreaterThanOrEqual(2);

    // 7. getUserProfile & upsertUserProfile
    const profile = await getUserProfile(admin!.id);
    expect(profile).not.toBeNull();
    const updatedProfile = await upsertUserProfile(admin!.id, { jobTitle: 'Lead Dev' });
    expect(updatedProfile.jobTitle).toBe('Lead Dev');

    // 8. tagDeviceToUser, getUserDeviceTags, removeDeviceTagFromUser
    const tag = await tagDeviceToUser(newUser.id, 'AA:BB:CC:DD:EE:01', 'Dev Laptop');
    expect(tag.macAddress).toBe('AA-BB-CC-DD-EE-01');
    const tags = await getUserDeviceTags(newUser.id);
    expect(tags.length).toBe(1);
    const removed = await removeDeviceTagFromUser(newUser.id, 'aa-bb-cc-dd-ee-01');
    expect(removed).toBe(true);

    // 9. recordLoginAttempt & getPaginatedLogins
    await recordLoginAttempt(admin!.id, 'admin@omadanoc.com', '127.0.0.1', 'Vitest', 'SUCCESS', null);
    const logins = await getPaginatedLogins(1, 10);
    expect(logins.items.length).toBeGreaterThanOrEqual(1);

    // 10. deleteUser
    const deleted = await deleteUser(newUser.id);
    expect(deleted).toBe(true);

    // 11. saveAiInsight, getRecentAiInsights, getLatestAiInsight fallback
    const insight = await saveAiInsight({
      triggeredByUserId: admin!.id,
      healthScore: 95,
      previousScore: null,
      scoreDelta: 0,
      trendDirection: 'INITIAL',
      executiveSummary: 'Fallback insight test.',
      resolvedIssues: [],
      persistingIssues: [],
      newIssues: [],
      actionableSuggestions: [],
      metricsSnapshot: {},
    });
    expect(insight.healthScore).toBe(95);

    const recent = await getRecentAiInsights(5);
    expect(recent.length).toBeGreaterThanOrEqual(1);

    const latest = await getLatestAiInsight();
    expect(latest?.id).toBe(insight.id);
  });

  it('transparently falls back to in-memory store on password authentication failure in dev', async () => {
    const authError = new Error('password authentication failed for user "postgres"');
    (authError as any).code = '28P01';

    const mockPool = {
      query: vi.fn().mockRejectedValue(authError),
      connect: vi.fn().mockRejectedValue(authError),
      on: vi.fn(),
    };

    vi.spyOn(poolModule, 'getDbPool').mockReturnValue(mockPool as any);

    await initDb();

    const admin = await findUserByEmailOrUsername('admin@omadanoc.com');
    expect(admin).not.toBeNull();
    expect(admin?.email).toBe('admin@omadanoc.com');
    expect(admin?.role).toBe('ADMIN');
  });

  it('does not switch to the in-memory store when fallback is disallowed (production)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_MEMORY_FALLBACK', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const connError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    vi.spyOn(poolModule, 'getDbPool').mockReturnValue({
      query: vi.fn().mockRejectedValue(connError),
      connect: vi.fn().mockRejectedValue(connError),
      on: vi.fn(),
    } as any);

    await expect(initDb()).rejects.toThrow('ECONNREFUSED');
    expect(poolModule.isMemoryFallbackActive()).toBe(false);
    // The well-known default admin must not become a valid login
    await expect(findUserByEmailOrUsername('admin@omadanoc.com')).rejects.toThrow('ECONNREFUSED');
    vi.unstubAllEnvs();
  });
});
