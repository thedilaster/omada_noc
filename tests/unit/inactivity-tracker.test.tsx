import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import InactivityTracker, { LAST_ACTIVITY_STORAGE_KEY } from '@/app/components/InactivityTracker';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
let mockPathname = '/';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  usePathname: () => mockPathname,
}));

describe('InactivityTracker Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockPathname = '/';
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  const minutes = (n: number) => n * 60 * 1000;

  const advance = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  };

  // Simulates another tab recording activity (the browser fires `storage` only in other tabs)
  const activityInOtherTab = (key = LAST_ACTIVITY_STORAGE_KEY) => {
    const now = String(Date.now());
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, now);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: now }));
  };

  it('triggers inactivity logout after 15 minutes of user silence and redirects via router', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    render(<InactivityTracker />);

    // Advance time by 14 minutes (no timeout yet)
    await act(async () => {
      vi.advanceTimersByTime(14 * 60 * 1000);
    });
    expect(global.fetch).not.toHaveBeenCalled();

    // User moves mouse (resets timer)
    fireEvent.mouseMove(window);

    // Advance another 10 minutes
    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });
    expect(global.fetch).not.toHaveBeenCalled();

    // Advance remaining 5+ minutes (total 15 min without activity)
    await act(async () => {
      vi.advanceTimersByTime(6 * 60 * 1000);
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(mockPush).toHaveBeenCalledWith('/login?reason=inactivity');
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('records activity in localStorage for other tabs', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    render(<InactivityTracker />);
    const mountedAt = Number(window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY));
    expect(mountedAt).toBe(Date.now());

    // Writes are throttled to once per second
    await advance(500);
    fireEvent.mouseMove(window);
    expect(Number(window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY))).toBe(mountedAt);
    await advance(1000);
    fireEvent.keyDown(window);
    expect(Number(window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY))).toBe(Date.now());
  });

  it('does not log out while another tab is active (storage event)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    render(<InactivityTracker />);

    await advance(minutes(14));
    activityInOtherTab();
    // Unrelated keys are ignored
    window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-key', newValue: '1' }));

    await advance(minutes(2)); // 16 min since this tab's own activity
    expect(global.fetch).not.toHaveBeenCalled();

    await advance(minutes(13)); // 15 min since the other tab's activity
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(mockPush).toHaveBeenCalledWith('/login?reason=inactivity');
  });

  it('re-checks shared activity before logging out even if the storage event was missed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    render(<InactivityTracker />);

    await advance(minutes(10));
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));

    await advance(minutes(5)); // local deadline reached, but other tab was active 5 min ago
    expect(global.fetch).not.toHaveBeenCalled();

    await advance(minutes(10));
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
  });

  it('ignores future or malformed shared timestamps', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    render(<InactivityTracker />);

    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now() + minutes(60)));
    await advance(minutes(15));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    (global.fetch as any).mockClear();
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, 'garbage');
    fireEvent.click(window);
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, 'garbage');
    await advance(minutes(15));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to per-tab tracking when localStorage throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    render(<InactivityTracker />);
    await advance(minutes(15));

    expect(global.fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(mockPush).toHaveBeenCalledWith('/login?reason=inactivity');
  });

  it('does nothing and clears timer when already on /login route', async () => {
    mockPathname = '/login';
    global.fetch = vi.fn();

    render(<InactivityTracker />);

    await act(async () => {
      vi.advanceTimersByTime(20 * 60 * 1000);
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
