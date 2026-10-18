'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 minutes
// Shared across tabs so an idle tab does not log out a session that is active elsewhere
export const LAST_ACTIVITY_STORAGE_KEY = 'omada-noc:last-activity';
// Throttle shared writes; mousemove can fire dozens of times per second
const ACTIVITY_WRITE_INTERVAL_MS = 1000;

function readSharedActivity(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null; // Storage disabled (privacy mode, sandboxed iframe)
  }
}

function writeSharedActivity(timestamp: number): void {
  try {
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(timestamp));
  } catch {
    // Storage unavailable: fall back to per-tab tracking only
  }
}

export default function InactivityTracker() {
  const router = useRouter();
  const pathname = usePathname();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (pathname === '/login') {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    let lastLocalActivity = 0;
    let lastSharedWrite = 0;

    const handleInactivityLogout = async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch {
        // Proceed
      }
      if (router) {
        router.push('/login?reason=inactivity');
        router.refresh();
      } else if (typeof window !== 'undefined' && window.location) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/login?reason=inactivity';
      }
    };

    const schedule = (delayMs: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(checkInactivity, delayMs);
    };

    // Before logging out, honour activity recorded by any other open tab
    function checkInactivity() {
      const now = Date.now();
      const shared = readSharedActivity();
      // Ignore timestamps from the future (clock changes) so they cannot postpone logout forever
      const sharedActivity = shared !== null && shared <= now ? shared : 0;
      const idleMs = now - Math.max(lastLocalActivity, sharedActivity);
      if (idleMs < INACTIVITY_LIMIT_MS) {
        schedule(INACTIVITY_LIMIT_MS - idleMs);
        return;
      }
      handleInactivityLogout();
    }

    const recordActivity = () => {
      const now = Date.now();
      lastLocalActivity = now;
      if (now - lastSharedWrite >= ACTIVITY_WRITE_INTERVAL_MS) {
        lastSharedWrite = now;
        writeSharedActivity(now);
      }
      schedule(INACTIVITY_LIMIT_MS);
    };

    // Another tab recorded activity: push our deadline out accordingly
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LAST_ACTIVITY_STORAGE_KEY) return;
      checkInactivity();
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach((event) => window.addEventListener(event, recordActivity, { passive: true }));
    window.addEventListener('storage', handleStorage);

    // Opening/navigating counts as activity and starts the initial timer
    recordActivity();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((event) => window.removeEventListener(event, recordActivity));
      window.removeEventListener('storage', handleStorage);
    };
  }, [pathname, router]);

  return null;
}
