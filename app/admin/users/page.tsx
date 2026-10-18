'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ProfileWidget from '@/app/components/ProfileWidget';
import InactivityTracker from '@/app/components/InactivityTracker';
import { UserWithDetails, UserLoginRecord } from '@/types/auth';
import { OmadaClientDevice } from '@/types/omada';
import { normalizeMac } from '@/lib/omada/formatters';

export default function AdminUsersPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'logins'>('users');
  const [users, setUsers] = useState<UserWithDetails[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [taggingUser, setTaggingUser] = useState<UserWithDetails | null>(null);
  const [editingUser, setEditingUser] = useState<UserWithDetails | null>(null);

  // Create User Form State
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newRole, setNewRole] = useState<'ADMIN' | 'USER'>('USER');

  // Edit User State
  const [editRole, setEditRole] = useState<'ADMIN' | 'USER'>('USER');
  const [resetPassword, setResetPassword] = useState('');

  // Device Tagging State
  const [discoveredDevices, setDiscoveredDevices] = useState<OmadaClientDevice[]>([]);
  const [manualMac, setManualMac] = useState('');
  const [manualName, setManualName] = useState('');
  const [loadingDiscovered, setLoadingDiscovered] = useState(false);

  // Paginated Logins State (10/page)
  const [logins, setLogins] = useState<UserLoginRecord[]>([]);
  const [loginPage, setLoginPage] = useState(1);
  const [totalLoginPages, setTotalLoginPages] = useState(1);
  const [totalLogins, setTotalLogins] = useState(0);
  const [loadingLogins, setLoadingLogins] = useState(false);

  // Alerts
  const router = useRouter();
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch Users
  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.status === 403 || res.status === 401) {
        router.push('/');
        return;
      }
      const data = await res.json();
      if (data.users) {
        setUsers(data.users);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoadingUsers(false);
    }
  }, [router]);

  // Fetch Logins (10 per page)
  const loadLogins = useCallback(async (page: number) => {
    setLoadingLogins(true);
    try {
      const res = await fetch(`/api/admin/logins?page=${page}&pageSize=10`);
      if (res.ok) {
        const data = await res.json();
        setLogins(data.items || []);
        setTotalLoginPages(data.totalPages || 1);
        setTotalLogins(data.total || 0);
        setLoginPage(page);
      }
    } catch (err) {
      console.error('Error loading login history:', err);
    } finally {
      setLoadingLogins(false);
    }
  }, []);

  // Fetch Discovered Devices from Omada for Live Tagging
  const loadDiscoveredDevices = useCallback(async () => {
    setLoadingDiscovered(true);
    try {
      const res = await fetch('/api/telemetry?all=true');
      if (res.ok) {
        const data = await res.json();
        setDiscoveredDevices(data.allClients || data.topClients || []);
      }
    } catch (err) {
      console.error('Error loading discovered devices:', err);
    } finally {
      setLoadingDiscovered(false);
    }
  }, []);

  useEffect(() => {
    async function initAdminData() {
      try {
        const [usersRes, loginsRes, telemetryRes] = await Promise.all([
          fetch('/api/admin/users'),
          fetch('/api/admin/logins?page=1&pageSize=10'),
          fetch('/api/telemetry?all=true'),
        ]);

        if (usersRes.status === 403 || usersRes.status === 401) {
          router.push('/');
          return;
        }

        if (usersRes.ok) {
          const userData = await usersRes.json();
          if (userData.users) setUsers(userData.users);
        }

        if (loginsRes.ok) {
          const loginsData = await loginsRes.json();
          setLogins(loginsData.items || []);
          setTotalLoginPages(loginsData.totalPages || 1);
          setTotalLogins(loginsData.total || 0);
        }

        if (telemetryRes.ok) {
          const telemetryData = await telemetryRes.json();
          setDiscoveredDevices(telemetryData.allClients || telemetryData.topClients || []);
        }
      } catch (err) {
        console.error('Failed to load admin initial data:', err);
      } finally {
        setLoadingUsers(false);
        setLoadingLogins(false);
        setLoadingDiscovered(false);
      }
    }

    initAdminData();
  }, [router]);

  // Handle Create User
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlertMsg(null);

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername,
          email: newEmail,
          password: newPassword,
          role: newRole,
          fullName: newFullName,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');

      setAlertMsg({ type: 'success', text: `User ${newUsername} created successfully!` });
      setShowCreateModal(false);
      setNewUsername('');
      setNewEmail('');
      setNewPassword('');
      setNewFullName('');
      setNewRole('USER');
      loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error creating user';
      setAlertMsg({ type: 'error', text: msg });
    }
  };

  // Handle Update User (Role / Password)
  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setAlertMsg(null);

    try {
      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: editRole,
          ...(resetPassword && { newPassword: resetPassword }),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update user');

      setAlertMsg({ type: 'success', text: `User ${editingUser.username} updated successfully!` });
      setEditingUser(null);
      setResetPassword('');
      loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error updating user';
      setAlertMsg({ type: 'error', text: msg });
    }
  };

  // Handle Delete User
  const handleDeleteUser = async (userId: string, username: string) => {
    if (!confirm(`Are you sure you want to permanently delete user "${username}"?`)) return;
    setAlertMsg(null);

    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete user');

      setAlertMsg({ type: 'success', text: `User ${username} deleted successfully!` });
      loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error deleting user';
      setAlertMsg({ type: 'error', text: msg });
    }
  };

  // Handle Tag Device
  const handleTagDevice = async (mac: string, name: string) => {
    if (!taggingUser) return;
    try {
      const res = await fetch(`/api/admin/users/${taggingUser.id}/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ macAddress: mac, deviceName: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to tag device');

      // Refresh tagging user state
      const updatedTagsRes = await fetch(`/api/admin/users/${taggingUser.id}/devices`);
      const updatedTagsData = await updatedTagsRes.json();
      setTaggingUser({
        ...taggingUser,
        taggedDevices: updatedTagsData.devices || [],
      });
      loadUsers();
      setManualMac('');
      setManualName('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error tagging device';
      setAlertMsg({ type: 'error', text: msg });
    }
  };

  // Handle Remove Tag
  const handleRemoveTag = async (mac: string) => {
    if (!taggingUser) return;
    try {
      const res = await fetch(`/api/admin/users/${taggingUser.id}/devices?mac=${encodeURIComponent(mac)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to remove device tag');

      const updatedTagsRes = await fetch(`/api/admin/users/${taggingUser.id}/devices`);
      const updatedTagsData = await updatedTagsRes.json();
      setTaggingUser({
        ...taggingUser,
        taggedDevices: updatedTagsData.devices || [],
      });
      loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error removing tag';
      setAlertMsg({ type: 'error', text: msg });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      <InactivityTracker />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link
              href="/"
              className="flex items-center space-x-2 text-slate-400 hover:text-cyan-400 text-xs font-semibold transition-colors"
            >
              <span>← Back to Dashboard</span>
            </Link>
            <span className="text-slate-700">|</span>
            <div className="flex items-center space-x-2">
              <span className="text-sm">👥</span>
              <span className="font-bold text-sm text-slate-200">User Management & Security Audits</span>
            </div>
          </div>
          <ProfileWidget align="right" />
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white font-mono">Administration & Access Control</h1>
            <p className="text-xs text-slate-400 mt-1">
              Manage accounts, multi-tenant hardware device tagging, and review paginated authentication audit logs.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {activeTab === 'users' && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-xs shadow-lg shadow-cyan-500/20 flex items-center space-x-1.5 transition-all"
              >
                <span>+</span>
                <span>Create New User</span>
              </button>
            )}
          </div>
        </div>

        {/* Alerts */}
        {alertMsg && (
          <div
            className={`mb-6 p-4 rounded-xl text-xs flex items-center justify-between ${
              alertMsg.type === 'success'
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
            }`}
          >
            <div className="flex items-center space-x-2">
              <span>{alertMsg.type === 'success' ? '✅' : '⚠️'}</span>
              <span>{alertMsg.text}</span>
            </div>
            <button onClick={() => setAlertMsg(null)} className="text-slate-400 hover:text-white font-bold">
              ×
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 mb-6">
          <button
            onClick={() => setActiveTab('users')}
            className={`pb-3 px-4 text-xs font-bold transition-all relative ${
              activeTab === 'users' ? 'text-cyan-400 border-b-2 border-cyan-500' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            👤 User Directory ({users.length})
          </button>
          <button
            onClick={() => setActiveTab('logins')}
            className={`pb-3 px-4 text-xs font-bold transition-all relative ${
              activeTab === 'logins' ? 'text-cyan-400 border-b-2 border-cyan-500' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🛡️ Login Audit Trail ({totalLogins})
          </button>
        </div>

        {/* Tab 1: User Directory */}
        {activeTab === 'users' && (
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
            {loadingUsers ? (
              <div className="p-12 text-center text-slate-400 text-xs flex items-center justify-center space-x-2">
                <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
                <span>Loading users...</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950/80 text-slate-400 font-semibold border-b border-slate-800">
                    <tr>
                      <th className="py-3.5 px-4">User</th>
                      <th className="py-3.5 px-4">Email</th>
                      <th className="py-3.5 px-4">Role</th>
                      <th className="py-3.5 px-4">Tagged Devices</th>
                      <th className="py-3.5 px-4">Created Date</th>
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-100">{u.profile?.fullName || u.username}</div>
                          <div className="text-[11px] text-slate-400 font-mono">@{u.username}</div>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-300">{u.email}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider ${
                              u.role === 'ADMIN'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => {
                              setTaggingUser(u);
                              loadDiscoveredDevices();
                            }}
                            className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs border border-slate-700 transition-colors"
                          >
                            <span>🏷️</span>
                            <span>{u.taggedDevices.length} Tagged</span>
                            <span className="text-cyan-400 text-[10px]">Edit</span>
                          </button>
                        </td>
                        <td className="py-3 px-4 text-slate-400 text-[11px] font-mono">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right space-x-2">
                          <button
                            onClick={() => {
                              setEditingUser(u);
                              setEditRole(u.role);
                              setResetPassword('');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteUser(u.id, u.username)}
                            className="px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-xs text-rose-300 border border-rose-800/40"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Login Audit Trail (10 per page) */}
        {activeTab === 'logins' && (
          <div className="bg-slate-900/90 rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
            {loadingLogins ? (
              <div className="p-12 text-center text-slate-400 text-xs flex items-center justify-center space-x-2">
                <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
                <span>Loading login audits...</span>
              </div>
            ) : (
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950/80 text-slate-400 font-semibold border-b border-slate-800">
                      <tr>
                        <th className="py-3.5 px-4">Timestamp</th>
                        <th className="py-3.5 px-4">Attempted Email</th>
                        <th className="py-3.5 px-4">IP Address</th>
                        <th className="py-3.5 px-4">Status</th>
                        <th className="py-3.5 px-4">Failure Reason / Notes</th>
                        <th className="py-3.5 px-4">User Agent</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {logins.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                            {new Date(log.createdAt).toLocaleString()}
                          </td>
                          <td className="py-3 px-4 font-mono font-medium text-slate-200">{log.email}</td>
                          <td className="py-3 px-4 font-mono text-cyan-400">{log.ipAddress}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider ${
                                log.loginStatus === 'SUCCESS'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              }`}
                            >
                              {log.loginStatus}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-[11px] text-slate-400">{log.failureReason || '—'}</td>
                          <td className="py-3 px-4 text-[10px] text-slate-500 truncate max-w-xs">{log.userAgent}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls (10/page) */}
                <div className="p-4 border-t border-slate-800/80 flex items-center justify-between bg-slate-950/60 text-xs">
                  <div className="text-slate-400">
                    Showing Page <span className="font-semibold text-slate-200">{loginPage}</span> of{' '}
                    <span className="font-semibold text-slate-200">{totalLoginPages}</span> ({totalLogins} total events)
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      disabled={loginPage <= 1}
                      onClick={() => loadLogins(loginPage - 1)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-200 border border-slate-700"
                    >
                      ← Previous
                    </button>
                    <button
                      disabled={loginPage >= totalLoginPages}
                      onClick={() => loadLogins(loginPage + 1)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-200 border border-slate-700"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modal 1: Create User */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <h2 className="text-base font-bold text-white mb-4">Create New Account</h2>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Username</label>
                <input
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="e.g. jdoe"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Full Name</label>
                <input
                  type="text"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="jdoe@example.com"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Access Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'ADMIN' | 'USER')}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:ring-2 focus:ring-cyan-500/50"
                >
                  <option value="USER">USER (Standard - Scoped by Tagged Devices)</option>
                  <option value="ADMIN">ADMIN (Full Access to All Telemetry & Admin)</option>
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-xs font-semibold text-white shadow-lg shadow-cyan-500/20"
                >
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Edit User (Role & Password) */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <h2 className="text-base font-bold text-white mb-1">Edit Account: @{editingUser.username}</h2>
            <p className="text-xs text-slate-400 mb-4">{editingUser.email}</p>

            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Access Role</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as 'ADMIN' | 'USER')}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:ring-2 focus:ring-cyan-500/50"
                >
                  <option value="USER">USER (Standard)</option>
                  <option value="ADMIN">ADMIN (Superuser)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Reset Password (Optional)</label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Leave blank to keep unchanged"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-xs font-semibold text-white shadow-lg shadow-cyan-500/20"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Device Tagging Matrix */}
      {taggingUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-base font-bold text-white flex items-center space-x-2">
                  <span>🏷️</span>
                  <span>Device Tagging: @{taggingUser.username}</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Assign physical hardware devices to scope this user&apos;s telemetry view.
                </p>
              </div>
              <button onClick={() => setTaggingUser(null)} className="text-slate-400 hover:text-white font-bold text-lg">
                ×
              </button>
            </div>

            <div className="overflow-y-auto py-4 space-y-6 flex-1 pr-1">
              {/* Currently Tagged Devices */}
              <div>
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Currently Tagged Devices ({taggingUser.taggedDevices.length})
                </h3>
                {taggingUser.taggedDevices.length === 0 ? (
                  <div className="p-3 bg-slate-950/60 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-400">
                    No devices currently tagged. (User sees all devices by default policy).
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/60 border border-slate-800 rounded-xl overflow-hidden">
                    {taggingUser.taggedDevices.map((d) => (
                      <div key={d.id} className="p-3 bg-slate-950/60 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-slate-200">{d.deviceName || 'Tagged Device'}</p>
                          <p className="text-[11px] font-mono text-cyan-400">{d.macAddress}</p>
                        </div>
                        <button
                          onClick={() => handleRemoveTag(d.macAddress)}
                          className="px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-xs text-rose-300 border border-rose-800/40"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tag from Discovered Omada Devices */}
              <div>
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Tag from Live Discovered Omada Devices ({discoveredDevices.length} available)
                </h3>
                {loadingDiscovered ? (
                  <p className="text-xs text-slate-400">Loading discovered devices...</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto border border-slate-800 rounded-xl divide-y divide-slate-800/60 bg-slate-950/60">
                    {discoveredDevices.map((dev) => {
                      const isAlreadyTagged = taggingUser.taggedDevices.some(
                        (t) => normalizeMac(t.macAddress) === normalizeMac(dev.mac)
                      );
                      const name = dev.name || dev.hostName || 'Unnamed Device';
                      return (
                        <div key={dev.mac} className="p-2.5 flex items-center justify-between hover:bg-slate-800/30">
                          <div>
                            <p className="text-xs font-medium text-slate-200">{name}</p>
                            <p className="text-[10px] font-mono text-slate-400">
                              {dev.ip} • {dev.mac} • {dev.wireless ? `📶 Wi-Fi (${dev.ssid})` : '🔌 Wired'}
                            </p>
                          </div>
                          <button
                            disabled={isAlreadyTagged}
                            onClick={() => handleTagDevice(dev.mac, name)}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-800/50 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {isAlreadyTagged ? 'Tagged ✓' : '+ Tag'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Manual MAC Tagging */}
              <div>
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Manually Tag Device by MAC
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={manualMac}
                    onChange={(e) => setManualMac(e.target.value)}
                    placeholder="MAC: AA:BB:CC:DD:EE:FF"
                    className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                  />
                  <input
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Label: e.g. James's Workstation"
                    className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100"
                  />
                </div>
                <button
                  type="button"
                  disabled={!manualMac}
                  onClick={() => handleTagDevice(manualMac, manualName)}
                  className="mt-2 w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 disabled:opacity-40"
                >
                  + Add Manual MAC Tag
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-800">
              <button
                onClick={() => setTaggingUser(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
