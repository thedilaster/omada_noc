import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as dbQueries from '@/lib/db/queries';
import * as sessionModule from '@/lib/auth/session';
import { GET as getUsersHandler, POST as createUserHandler } from '@/app/api/admin/users/route';
import { PUT as updateUserHandler, DELETE as deleteUserHandler } from '@/app/api/admin/users/[id]/route';
import {
  GET as getDevicesHandler,
  POST as addDeviceHandler,
  DELETE as removeDeviceHandler,
} from '@/app/api/admin/users/[id]/devices/route';
import { GET as getLoginsHandler } from '@/app/api/admin/logins/route';
import { UserRecord } from '@/types/auth';

const user = (id: string, role: 'ADMIN' | 'USER' = 'USER'): UserRecord => ({
  id,
  username: id,
  email: `${id}@test.com`,
  role,
  createdAt: '',
  updatedAt: '',
});

const ADMIN_SESSION = {
  userId: 'u-admin',
  username: 'admin',
  email: 'admin@omadanoc.com',
  role: 'ADMIN' as const,
  lastActive: Date.now(),
};

/**
 * Mocks findUserById from an id -> record table; the session admin always exists as ADMIN
 * unless overridden, since requireAdmin() re-checks the caller's role in the database.
 */
const mockUsers = (records: Record<string, UserRecord | null> = {}) =>
  vi.spyOn(dbQueries, 'findUserById').mockImplementation(async (id: string) => {
    const table: Record<string, UserRecord | null> = { 'u-admin': user('u-admin', 'ADMIN'), ...records };
    return id in table ? table[id] : null;
  });

describe('Admin API Route Handlers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('RBAC Guards', () => {
    it('returns 403 Forbidden for non-admin users across all routes', async () => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
        userId: 'u-user',
        username: 'regular_user',
        email: 'user@test.com',
        role: 'USER',
        lastActive: Date.now(),
      });
      mockUsers({ 'u-user': user('u-user', 'USER') });

      expect((await getUsersHandler()).status).toBe(403);
      expect((await createUserHandler(new Request('http://localhost', { method: 'POST', body: '{}' }))).status).toBe(403);
      expect((await updateUserHandler(new Request('http://localhost', { method: 'PUT', body: '{}' }), { params: Promise.resolve({ id: '1' }) })).status).toBe(403);
      expect((await deleteUserHandler(new Request('http://localhost', { method: 'DELETE' }), { params: Promise.resolve({ id: '1' }) })).status).toBe(403);
      expect((await getDevicesHandler(new Request('http://localhost'), { params: Promise.resolve({ id: '1' }) })).status).toBe(403);
      expect((await addDeviceHandler(new Request('http://localhost', { method: 'POST', body: '{}' }), { params: Promise.resolve({ id: '1' }) })).status).toBe(403);
      expect((await removeDeviceHandler(new Request('http://localhost', { method: 'DELETE' }), { params: Promise.resolve({ id: '1' }) })).status).toBe(403);
      expect((await getLoginsHandler(new Request('http://localhost/api/admin/logins'))).status).toBe(403);
    });

    it('rejects a JWT that still claims ADMIN after the account was demoted in the database', async () => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(ADMIN_SESSION);
      mockUsers({ 'u-admin': user('u-admin', 'USER') });
      const listSpy = vi.spyOn(dbQueries, 'listAllUsersWithDetails').mockResolvedValue([]);

      const res = await getUsersHandler();
      expect(res.status).toBe(403);
      expect(listSpy).not.toHaveBeenCalled();
    });

    it('returns 401 when there is no session or the admin account was deleted', async () => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(null);
      expect((await getUsersHandler()).status).toBe(401);

      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(ADMIN_SESSION);
      mockUsers({ 'u-admin': null });
      const res = await getUsersHandler();
      expect(res.status).toBe(401);
      expect((await res.json()).error).toContain('no longer exists');
    });
  });

  describe('User Management Routes (/api/admin/users)', () => {
    beforeEach(() => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(ADMIN_SESSION);
      mockUsers();
    });

    it('lists all users for admin', async () => {
      vi.spyOn(dbQueries, 'listAllUsersWithDetails').mockResolvedValue([
        {
          id: 'u-1',
          username: 'user1',
          email: 'u1@test.com',
          role: 'USER',
          createdAt: '',
          updatedAt: '',
          taggedDevices: [],
        },
      ]);

      const res = await getUsersHandler();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.users).toHaveLength(1);
    });

    it('handles unexpected exceptions and returns 500 on user list and create', async () => {
      vi.spyOn(dbQueries, 'listAllUsersWithDetails').mockRejectedValue(new Error('DB read failure'));
      expect((await getUsersHandler()).status).toBe(500);

      vi.spyOn(dbQueries, 'findUserByEmailOrUsername').mockRejectedValue(new Error('DB write failure'));
      const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ username: 'a', email: 'a@b.com', password: 'password123' }) });
      expect((await createUserHandler(req)).status).toBe(500);
    });

    it('creates a new user for admin', async () => {
      vi.spyOn(dbQueries, 'findUserByEmailOrUsername').mockResolvedValue(null);
      vi.spyOn(dbQueries, 'createUser').mockResolvedValue({
        id: 'new-u',
        username: 'newuser',
        email: 'new@test.com',
        role: 'USER',
        createdAt: '',
        updatedAt: '',
      });

      const req = new Request('http://localhost/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: 'newuser',
          email: 'new@test.com',
          password: 'Password123!',
          role: 'USER',
          fullName: 'New User',
        }),
      });

      const res = await createUserHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('validates required fields, password length, and duplicate users on create', async () => {
      // 1. Missing fields
      const req1 = new Request('http://localhost/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username: '', email: '', password: '' }),
      });
      expect((await createUserHandler(req1)).status).toBe(400);

      // 2. Short password
      const req2 = new Request('http://localhost/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username: 'u', email: 'u@test.com', password: 'short' }),
      });
      expect((await createUserHandler(req2)).status).toBe(400);

      // 3. Duplicate user (email or username)
      vi.spyOn(dbQueries, 'findUserByEmailOrUsername').mockImplementation(async (identifier: string) => {
        if (identifier === 'dup_user' || identifier === 'dup@test.com') {
          return { id: 'existing', username: 'dup_user', email: 'dup@test.com' } as any;
        }
        return null;
      });

      const req3 = new Request('http://localhost/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username: 'dup_user', email: 'other@test.com', password: 'Password123!' }),
      });
      expect((await createUserHandler(req3)).status).toBe(409);

      const req4 = new Request('http://localhost/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username: 'unique_user', email: 'dup@test.com', password: 'Password123!' }),
      });
      expect((await createUserHandler(req4)).status).toBe(409);
    });
  });

  describe('User Update & Delete (/api/admin/users/[id])', () => {
    beforeEach(() => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(ADMIN_SESSION);
      mockUsers();
    });

    it('updates user role and password', async () => {
      mockUsers({ 'u-target': user('u-target', 'USER') });
      const roleSpy = vi.spyOn(dbQueries, 'updateUserRole').mockResolvedValue({} as any);
      const pwSpy = vi.spyOn(dbQueries, 'updateUserPassword').mockResolvedValue(true);

      const req = new Request('http://localhost/api/admin/users/u-target', {
        method: 'PUT',
        body: JSON.stringify({ role: 'ADMIN', newPassword: 'NewPassword123!' }),
      });

      const res = await updateUserHandler(req, { params: Promise.resolve({ id: 'u-target' }) });
      expect(res.status).toBe(200);
      expect(roleSpy).toHaveBeenCalledWith('u-target', 'ADMIN');
      expect(pwSpy).toHaveBeenCalled();
    });

    it('handles not found and short password validation on update', async () => {
      const req1 = new Request('http://localhost', { method: 'PUT', body: JSON.stringify({ role: 'ADMIN' }) });
      expect((await updateUserHandler(req1, { params: Promise.resolve({ id: 'none' }) })).status).toBe(404);

      mockUsers({ '1': user('1') });
      const req2 = new Request('http://localhost', { method: 'PUT', body: JSON.stringify({ newPassword: 'short' }) });
      expect((await updateUserHandler(req2, { params: Promise.resolve({ id: '1' }) })).status).toBe(400);
    });

    it('validates the new password before applying a role change', async () => {
      mockUsers({ 'u-target': user('u-target', 'USER') });
      const roleSpy = vi.spyOn(dbQueries, 'updateUserRole').mockResolvedValue({} as any);

      const req = new Request('http://localhost', {
        method: 'PUT',
        body: JSON.stringify({ role: 'ADMIN', newPassword: 'short' }),
      });
      expect((await updateUserHandler(req, { params: Promise.resolve({ id: 'u-target' }) })).status).toBe(400);
      expect(roleSpy).not.toHaveBeenCalled();
    });

    it('prevents an administrator from changing their own role but allows a self password reset', async () => {
      const roleSpy = vi.spyOn(dbQueries, 'updateUserRole').mockResolvedValue({} as any);
      const pwSpy = vi.spyOn(dbQueries, 'updateUserPassword').mockResolvedValue(true);

      const demote = new Request('http://localhost', { method: 'PUT', body: JSON.stringify({ role: 'USER' }) });
      const res = await updateUserHandler(demote, { params: Promise.resolve({ id: 'u-admin' }) });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('your own');
      expect(roleSpy).not.toHaveBeenCalled();

      // The edit modal always resends the current role; that is not a role change
      const reset = new Request('http://localhost', {
        method: 'PUT',
        body: JSON.stringify({ role: 'ADMIN', newPassword: 'NewPassword123!' }),
      });
      expect((await updateUserHandler(reset, { params: Promise.resolve({ id: 'u-admin' }) })).status).toBe(200);
      expect(roleSpy).not.toHaveBeenCalled();
      expect(pwSpy).toHaveBeenCalledWith('u-admin', expect.any(String));
    });

    it('refuses to demote the last remaining administrator', async () => {
      mockUsers({ 'u-other-admin': user('u-other-admin', 'ADMIN') });
      const roleSpy = vi.spyOn(dbQueries, 'updateUserRole').mockResolvedValue({} as any);
      vi.spyOn(dbQueries, 'countAdmins').mockResolvedValue(1);

      const req = new Request('http://localhost', { method: 'PUT', body: JSON.stringify({ role: 'USER' }) });
      const res = await updateUserHandler(req, { params: Promise.resolve({ id: 'u-other-admin' }) });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('last remaining administrator');
      expect(roleSpy).not.toHaveBeenCalled();

      // With another admin left, demotion proceeds
      vi.spyOn(dbQueries, 'countAdmins').mockResolvedValue(2);
      const req2 = new Request('http://localhost', { method: 'PUT', body: JSON.stringify({ role: 'USER' }) });
      expect((await updateUserHandler(req2, { params: Promise.resolve({ id: 'u-other-admin' }) })).status).toBe(200);
      expect(roleSpy).toHaveBeenCalledWith('u-other-admin', 'USER');
    });

    it('handles unexpected exceptions and returns 500 on update and delete', async () => {
      vi.spyOn(dbQueries, 'findUserById').mockRejectedValue(new Error('Crash'));
      expect((await updateUserHandler(new Request('http://localhost', { method: 'PUT', body: '{}' }), { params: Promise.resolve({ id: '1' }) })).status).toBe(500);

      mockUsers({ '1': user('1') });
      vi.spyOn(dbQueries, 'deleteUser').mockRejectedValue(new Error('Crash'));
      expect((await deleteUserHandler(new Request('http://localhost', { method: 'DELETE' }), { params: Promise.resolve({ id: '1' }) })).status).toBe(500);
    });

    it('prevents administrator self-deletion and handles delete 404', async () => {
      const deleteSpy = vi.spyOn(dbQueries, 'deleteUser').mockResolvedValue(true);
      const req = new Request('http://localhost/api/admin/users/u-admin', { method: 'DELETE' });
      const res = await deleteUserHandler(req, { params: Promise.resolve({ id: 'u-admin' }) });
      expect(res.status).toBe(400);
      expect(deleteSpy).not.toHaveBeenCalled();

      const req2 = new Request('http://localhost', { method: 'DELETE' });
      expect((await deleteUserHandler(req2, { params: Promise.resolve({ id: 'nonexistent' }) })).status).toBe(404);

      // Row vanished between lookup and delete
      mockUsers({ 'u-racy': user('u-racy') });
      vi.spyOn(dbQueries, 'deleteUser').mockResolvedValue(false);
      expect((await deleteUserHandler(new Request('http://localhost', { method: 'DELETE' }), { params: Promise.resolve({ id: 'u-racy' }) })).status).toBe(404);
    });

    it('refuses to delete the last remaining administrator', async () => {
      mockUsers({ 'u-other-admin': user('u-other-admin', 'ADMIN') });
      const deleteSpy = vi.spyOn(dbQueries, 'deleteUser').mockResolvedValue(true);
      vi.spyOn(dbQueries, 'countAdmins').mockResolvedValue(1);

      const res = await deleteUserHandler(new Request('http://localhost', { method: 'DELETE' }), {
        params: Promise.resolve({ id: 'u-other-admin' }),
      });
      expect(res.status).toBe(400);
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('deletes target user', async () => {
      mockUsers({ 'u-target': user('u-target') });
      vi.spyOn(dbQueries, 'deleteUser').mockResolvedValue(true);
      const req = new Request('http://localhost/api/admin/users/u-target', { method: 'DELETE' });
      const res = await deleteUserHandler(req, { params: Promise.resolve({ id: 'u-target' }) });
      expect(res.status).toBe(200);
    });
  });

  describe('Device Tagging Routes (/api/admin/users/[id]/devices)', () => {
    beforeEach(() => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(ADMIN_SESSION);
      mockUsers();
    });

    it('gets, adds, and removes device tags with validation', async () => {
      vi.spyOn(dbQueries, 'getUserDeviceTags').mockResolvedValue([
        {
          id: 'tag-1',
          userId: 'u-target',
          macAddress: 'AA:BB:CC:DD:EE:FF',
          deviceName: 'iPad',
          createdAt: '',
        },
      ]);
      vi.spyOn(dbQueries, 'tagDeviceToUser').mockResolvedValue({
        id: 'tag-1',
        userId: 'u-target',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        createdAt: '',
      });
      vi.spyOn(dbQueries, 'removeDeviceTagFromUser').mockResolvedValue(true);

      const getRes = await getDevicesHandler(new Request('http://localhost'), {
        params: Promise.resolve({ id: 'u-target' }),
      });
      expect(getRes.status).toBe(200);

      // Missing MAC on add
      const badAddReq = new Request('http://localhost', { method: 'POST', body: JSON.stringify({}) });
      expect((await addDeviceHandler(badAddReq, { params: Promise.resolve({ id: '1' }) })).status).toBe(400);

      // Valid add
      mockUsers({ 'u-target': user('u-target') });
      const postReq = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ macAddress: 'AA:BB:CC:DD:EE:FF', deviceName: 'iPad' }),
      });
      const postRes = await addDeviceHandler(postReq, { params: Promise.resolve({ id: 'u-target' }) });
      expect(postRes.status).toBe(200);
      expect(dbQueries.tagDeviceToUser).toHaveBeenCalledWith('u-target', 'AA:BB:CC:DD:EE:FF', 'iPad');

      // Missing MAC on remove
      const badDelReq = new Request('http://localhost', { method: 'DELETE' });
      expect((await removeDeviceHandler(badDelReq, { params: Promise.resolve({ id: '1' }) })).status).toBe(400);

      // Valid remove
      const delReq = new Request('http://localhost?mac=AA:BB:CC:DD:EE:FF', { method: 'DELETE' });
      const delRes = await removeDeviceHandler(delReq, { params: Promise.resolve({ id: 'u-target' }) });
      expect(delRes.status).toBe(200);
    });

    it('handles unexpected exceptions and returns 500 on device tagging routes', async () => {
      vi.spyOn(dbQueries, 'getUserDeviceTags').mockRejectedValue(new Error('Fail'));
      expect((await getDevicesHandler(new Request('http://localhost'), { params: Promise.resolve({ id: '1' }) })).status).toBe(500);

      mockUsers({ '1': user('1') });
      vi.spyOn(dbQueries, 'tagDeviceToUser').mockRejectedValue(new Error('Fail'));
      expect((await addDeviceHandler(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ macAddress: 'AA-BB-CC-DD-EE-FF' }) }), { params: Promise.resolve({ id: '1' }) })).status).toBe(500);

      vi.spyOn(dbQueries, 'removeDeviceTagFromUser').mockRejectedValue(new Error('Fail'));
      expect((await removeDeviceHandler(new Request('http://localhost?mac=AA', { method: 'DELETE' }), { params: Promise.resolve({ id: '1' }) })).status).toBe(500);
    });
  });

  describe('Device tag validation', () => {
    beforeEach(() => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(ADMIN_SESSION);
      mockUsers({ 'u-target': user('u-target') });
    });

    it('rejects MAC addresses that are not 12 hex digits with 400', async () => {
      const tagSpy = vi.spyOn(dbQueries, 'tagDeviceToUser').mockResolvedValue({} as any);
      for (const macAddress of ['AA', 'AA:BB:CC:DD:EE:FF:00', 'ZZ:ZZ:ZZ:ZZ:ZZ:ZZ', 12345]) {
        const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ macAddress }) });
        const res = await addDeviceHandler(req, { params: Promise.resolve({ id: 'u-target' }) });
        expect(res.status).toBe(400);
      }
      expect(tagSpy).not.toHaveBeenCalled();
    });

    it('returns 404 when tagging a device to a nonexistent user', async () => {
      const tagSpy = vi.spyOn(dbQueries, 'tagDeviceToUser').mockResolvedValue({} as any);
      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ macAddress: '30-68-93-E8-29-54' }),
      });
      const res = await addDeviceHandler(req, { params: Promise.resolve({ id: 'u-missing' }) });
      expect(res.status).toBe(404);
      expect(tagSpy).not.toHaveBeenCalled();
    });

    it('accepts dashed Omada-style MACs and defaults the device name', async () => {
      const tagSpy = vi.spyOn(dbQueries, 'tagDeviceToUser').mockResolvedValue({ macAddress: '30-68-93-E8-29-54' } as any);
      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ macAddress: '30-68-93-e8-29-54' }),
      });
      expect((await addDeviceHandler(req, { params: Promise.resolve({ id: 'u-target' }) })).status).toBe(200);
      expect(tagSpy).toHaveBeenCalledWith('u-target', '30-68-93-e8-29-54', '');
    });
  });

  describe('Login Audit Route (/api/admin/logins)', () => {
    beforeEach(() => {
      mockUsers();
    });

    it('returns paginated login audits (10 per page)', async () => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(ADMIN_SESSION);

      vi.spyOn(dbQueries, 'getPaginatedLogins').mockResolvedValue({
        items: [
          {
            id: 'l-1',
            userId: 'u-1',
            email: 'user@test.com',
            ipAddress: '127.0.0.1',
            userAgent: 'Mozilla',
            loginStatus: 'SUCCESS',
            failureReason: null,
            createdAt: '',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      });

      const req = new Request('http://localhost/api/admin/logins?page=1&pageSize=10');
      const res = await getLoginsHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.items).toHaveLength(1);
      expect(dbQueries.getPaginatedLogins).toHaveBeenCalledWith(1, 10);
    });

    it('sanitizes non-numeric and out-of-range pagination parameters', async () => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(ADMIN_SESSION);
      const pageSpy = vi.spyOn(dbQueries, 'getPaginatedLogins').mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      });

      const cases: Array<[string, number, number]> = [
        ['?page=abc&pageSize=xyz', 1, 10],
        ['?page=-4&pageSize=0', 1, 1],
        ['?page=3&pageSize=100000', 3, 100],
        ['?page=2.7&pageSize=25', 2, 25],
        ['', 1, 10],
      ];
      for (const [query, page, pageSize] of cases) {
        const res = await getLoginsHandler(new Request(`http://localhost/api/admin/logins${query}`));
        expect(res.status).toBe(200);
        expect(pageSpy).toHaveBeenLastCalledWith(page, pageSize);
      }
    });

    it('handles unexpected exceptions and returns 500 on login audits', async () => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(ADMIN_SESSION);
      vi.spyOn(dbQueries, 'getPaginatedLogins').mockRejectedValue(new Error('Audit fail'));

      const res = await getLoginsHandler(new Request('http://localhost/api/admin/logins'));
      expect(res.status).toBe(500);
    });
  });
});
