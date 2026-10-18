import { describe, it, expect, beforeEach } from 'vitest';
import {
  initMemoryDb,
  memoryFindUserByEmailOrUsername,
  memoryFindUserById,
  memoryCreateUser,
  memoryUpdateUserRole,
  memoryUpdateUserPassword,
  memoryDeleteUser,
  memoryCountAdmins,
  memoryListAllUsersWithDetails,
  memoryGetUserProfile,
  memoryUpsertUserProfile,
  memoryGetUserDeviceTags,
  memoryTagDeviceToUser,
  memoryRemoveDeviceTagFromUser,
  memoryRecordLoginAttempt,
  memoryGetPaginatedLogins,
  memorySaveAiInsight,
  memoryGetRecentAiInsights,
  memoryGetLatestAiInsight,
} from '@/lib/db/memory';

describe('In-Memory Database Store (Development Fallback)', () => {
  beforeEach(async () => {
    await initMemoryDb();
  });

  it('initializes and finds default admin user by email or username', async () => {
    const userByEmail = await memoryFindUserByEmailOrUsername('admin@omadanoc.com');
    expect(userByEmail).not.toBeNull();
    expect(userByEmail?.username).toBe('admin');
    expect(userByEmail?.role).toBe('ADMIN');

    const userByUsername = await memoryFindUserByEmailOrUsername('ADMIN');
    expect(userByUsername?.id).toBe(userByEmail?.id);

    const userById = await memoryFindUserById(userByEmail!.id);
    expect(userById?.email).toBe('admin@omadanoc.com');

    // Only the login lookup exposes the hash (admin routes serialize findUserById results)
    expect(userByEmail?.passwordHash).toBeTruthy();
    expect(userById).not.toHaveProperty('passwordHash');

    const nonExistent = await memoryFindUserByEmailOrUsername('nonexistent@user.com');
    expect(nonExistent).toBeNull();
  });

  it('creates, updates, and deletes users in memory', async () => {
    const newUser = await memoryCreateUser('testuser', 'test@example.com', 'hashed123', 'USER', 'Test Operator');
    expect(newUser.username).toBe('testuser');
    expect(newUser.email).toBe('test@example.com');
    expect(newUser.role).toBe('USER');
    expect(newUser).not.toHaveProperty('passwordHash');
    expect(newUser.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // The stored record still keeps the hash for login
    expect((await memoryFindUserByEmailOrUsername('testuser'))?.passwordHash).toBe('hashed123');

    const adminsBefore = await memoryCountAdmins();

    // Update role
    const updated = await memoryUpdateUserRole(newUser.id, 'ADMIN');
    expect(updated?.role).toBe('ADMIN');
    expect(updated).not.toHaveProperty('passwordHash');
    expect(await memoryCountAdmins()).toBe(adminsBefore + 1);

    // Update role for non-existent user
    const noRole = await memoryUpdateUserRole('fake-id', 'USER');
    expect(noRole).toBeNull();

    // Update password
    const pwUpdated = await memoryUpdateUserPassword(newUser.id, 'newhash456');
    expect(pwUpdated).toBe(true);

    // Update password for non-existent user
    const noPw = await memoryUpdateUserPassword('fake-id', 'newhash');
    expect(noPw).toBe(false);

    // List all users
    const allUsers = await memoryListAllUsersWithDetails();
    expect(allUsers.length).toBeGreaterThanOrEqual(2);

    // Delete user
    const deleted = await memoryDeleteUser(newUser.id);
    expect(deleted).toBe(true);

    // Delete non-existent user
    const noDel = await memoryDeleteUser('fake-id');
    expect(noDel).toBe(false);

    const check = await memoryFindUserById(newUser.id);
    expect(check).toBeNull();
  });

  it('manages user profiles in memory for existing and new users', async () => {
    const profile = await memoryGetUserProfile('00000000-0000-0000-0000-000000000001');
    expect(profile).not.toBeNull();
    expect(profile?.fullName).toBe('System Administrator');

    const updatedProfile = await memoryUpsertUserProfile('00000000-0000-0000-0000-000000000001', {
      jobTitle: 'Principal NOC Architect',
      department: 'Infrastructure',
    });
    expect(updatedProfile.jobTitle).toBe('Principal NOC Architect');
    expect(updatedProfile.department).toBe('Infrastructure');

    // Explicitly undefined keys (omitted form fields) must not blank existing values
    const partial = await memoryUpsertUserProfile('00000000-0000-0000-0000-000000000001', {
      fullName: undefined,
      jobTitle: undefined,
      theme: 'light',
    });
    expect(partial.fullName).toBe('System Administrator');
    expect(partial.jobTitle).toBe('Principal NOC Architect');
    expect(partial.theme).toBe('light');

    // Upsert profile for a new user without existing profile
    const newProfile = await memoryUpsertUserProfile('brand-new-user-id', {
      fullName: 'New Person',
      jobTitle: 'Junior Ops',
    });
    expect(newProfile.fullName).toBe('New Person');
    // Get non-existent profile
    const nonExistentProfile = await memoryGetUserProfile('completely-fake-id');
    expect(nonExistentProfile).toBeNull();
  });

  it('tags, retrieves, updates existing tags, and removes devices for users', async () => {
    // Check user with zero tags
    const emptyTags = await memoryGetUserDeviceTags('user-with-zero-tags');
    expect(emptyTags).toEqual([]);

    const tag = await memoryTagDeviceToUser('00000000-0000-0000-0000-000000000001', '00:11:22:33:44:55', 'Core Gateway');
    // Stored canonically in Omada's dashed notation
    expect(tag.macAddress).toBe('00-11-22-33-44-55');
    expect(tag.deviceName).toBe('Core Gateway');

    // Update existing tag deviceName (same MAC, different notation)
    const updatedTag = await memoryTagDeviceToUser('00000000-0000-0000-0000-000000000001', '00-11-22-33-44-55', 'Updated Gateway');
    expect(updatedTag.id).toBe(tag.id);
    expect(updatedTag.deviceName).toBe('Updated Gateway');

    const tags = await memoryGetUserDeviceTags('00000000-0000-0000-0000-000000000001');
    expect(tags.some((t) => t.macAddress === '00-11-22-33-44-55')).toBe(true);

    await expect(memoryTagDeviceToUser('00000000-0000-0000-0000-000000000001', 'not-a-mac')).rejects.toThrow('Invalid MAC');

    const removed = await memoryRemoveDeviceTagFromUser('00000000-0000-0000-0000-000000000001', '00:11:22:33:44:55');
    expect(removed).toBe(true);

    // Remove non-existent tag
    const removedNonExistent = await memoryRemoveDeviceTagFromUser('00000000-0000-0000-0000-000000000001', '99:99:99:99:99:99');
    expect(removedNonExistent).toBe(false);

    const tagsAfter = await memoryGetUserDeviceTags('00000000-0000-0000-0000-000000000001');
    expect(tagsAfter.some((t) => t.macAddress === '00-11-22-33-44-55')).toBe(false);
  });

  it('lists tagged devices per user and removes them with the user', async () => {
    const owner = await memoryCreateUser('tagowner', 'tagowner@example.com', 'hash');
    await memoryTagDeviceToUser(owner.id, 'aa:bb:cc:00:00:01', 'Phone');

    const listed = (await memoryListAllUsersWithDetails()).find((u) => u.id === owner.id);
    expect(listed?.taggedDevices.map((t) => t.macAddress)).toEqual(['AA-BB-CC-00-00-01']);

    expect(await memoryDeleteUser(owner.id)).toBe(true);
    expect(await memoryGetUserDeviceTags(owner.id)).toEqual([]);
  });

  it('records and paginates login audit history in memory', async () => {
    await memoryRecordLoginAttempt(null, 'admin@omadanoc.com', '127.0.0.1', 'Mozilla/5.0', 'SUCCESS', null);
    await memoryRecordLoginAttempt(null, 'unknown@omadanoc.com', '127.0.0.1', 'Mozilla/5.0', 'FAILED', 'Invalid password');

    const logins = await memoryGetPaginatedLogins(1, 10);
    expect(logins.total).toBeGreaterThanOrEqual(2);
    expect(logins.items.length).toBeGreaterThanOrEqual(2);
    expect(logins.items[0].email).toBe('unknown@omadanoc.com');
  });

  it('saves, retrieves recent, and gets latest AI insight in memory', async () => {
    const saved = await memorySaveAiInsight({
      triggeredByUserId: '00000000-0000-0000-0000-000000000001',
      healthScore: 92,
      previousScore: 88,
      scoreDelta: 4,
      trendDirection: 'IMPROVED',
      executiveSummary: 'Telemetry improved.',
      resolvedIssues: [],
      persistingIssues: [],
      newIssues: [],
      actionableSuggestions: [],
      metricsSnapshot: {},
    });

    expect(saved.id).toBeDefined();
    expect(saved.healthScore).toBe(92);

    const recent = await memoryGetRecentAiInsights(5);
    expect(recent.length).toBeGreaterThanOrEqual(1);
    expect(recent[0].id).toBe(saved.id);

    const latest = await memoryGetLatestAiInsight();
    expect(latest?.id).toBe(saved.id);
  });
});
