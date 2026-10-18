import React from 'react';
import { renderToString } from 'react-dom/server';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  copyText,
  formatLinkRateKbps,
  getDeviceStatus,
  useIsClient,
  MISSING_VALUE,
} from '@/app/components/uiHelpers';

const setClipboard = (value: unknown) => {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true });
};

const setExecCommand = (value: unknown) => {
  Object.defineProperty(document, 'execCommand', { value, configurable: true, writable: true });
};

describe('uiHelpers', () => {
  afterEach(() => {
    setClipboard(undefined);
    setExecCommand(undefined);
  });

  describe('copyText', () => {
    it('uses the async Clipboard API when available', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      setClipboard({ writeText });
      const execCommand = vi.fn().mockReturnValue(true);
      setExecCommand(execCommand);

      await expect(copyText('hello')).resolves.toBe(true);
      expect(writeText).toHaveBeenCalledWith('hello');
      expect(execCommand).not.toHaveBeenCalled();
    });

    it('falls back to a hidden textarea when the Clipboard API rejects', async () => {
      setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
      let copiedValue: string | undefined;
      setExecCommand(
        vi.fn(() => {
          copiedValue = (document.activeElement as HTMLTextAreaElement).value;
          return true;
        })
      );

      await expect(copyText('fallback text')).resolves.toBe(true);
      expect(copiedValue).toBe('fallback text');
      // Temporary textarea is cleaned up
      expect(document.querySelector('textarea')).toBeNull();
    });

    it('falls back when navigator.clipboard is undefined (plain HTTP) and restores focus', async () => {
      const button = document.createElement('button');
      document.body.appendChild(button);
      button.focus();
      setExecCommand(vi.fn().mockReturnValue(true));

      await expect(copyText('lan copy')).resolves.toBe(true);
      expect(document.activeElement).toBe(button);
      button.remove();
    });

    it('reports failure when execCommand returns false or throws', async () => {
      setExecCommand(vi.fn().mockReturnValue(false));
      await expect(copyText('x')).resolves.toBe(false);

      setExecCommand(
        vi.fn(() => {
          throw new Error('SecurityError');
        })
      );
      await expect(copyText('x')).resolves.toBe(false);
      expect(document.querySelector('textarea')).toBeNull();
    });

    it('reports failure when no copy mechanism exists', async () => {
      await expect(copyText('x')).resolves.toBe(false);
    });
  });

  describe('getDeviceStatus', () => {
    it('classifies devices from status / statusCategory', () => {
      expect(getDeviceStatus({ status: 14 })).toBe('online');
      expect(getDeviceStatus({ status: 0 })).toBe('offline');
      expect(getDeviceStatus({ status: 0, statusCategory: 1 })).toBe('online');
      expect(getDeviceStatus({ status: 14, statusCategory: 0 })).toBe('offline');
      expect(getDeviceStatus({ statusCategory: 1 })).toBe('online');
      expect(getDeviceStatus({})).toBe('unknown');
      expect(getDeviceStatus(null)).toBe('unknown');
      expect(getDeviceStatus(undefined)).toBe('unknown');
    });
  });

  describe('formatLinkRateKbps', () => {
    it('formats Kbps link rates as Kbps / Mbps / Gbps', () => {
      expect(formatLinkRateKbps(2402000)).toBe('2.4 Gbps');
      expect(formatLinkRateKbps(1201000)).toBe('1.2 Gbps');
      expect(formatLinkRateKbps(866700)).toBe('866.7 Mbps');
      expect(formatLinkRateKbps(9600)).toBe('9.6 Mbps');
      expect(formatLinkRateKbps(1000)).toBe('1 Mbps');
      expect(formatLinkRateKbps(512)).toBe('512 Kbps');
    });

    it('returns a dash for missing or invalid values', () => {
      expect(formatLinkRateKbps(undefined)).toBe(MISSING_VALUE);
      expect(formatLinkRateKbps(null)).toBe(MISSING_VALUE);
      expect(formatLinkRateKbps(0)).toBe(MISSING_VALUE);
      expect(formatLinkRateKbps(-5)).toBe(MISSING_VALUE);
      expect(formatLinkRateKbps(NaN)).toBe(MISSING_VALUE);
    });
  });

  describe('useIsClient', () => {
    it('is false during server rendering and true on the client', () => {
      function Probe() {
        return <span>{useIsClient() ? 'client' : 'server'}</span>;
      }
      expect(renderToString(<Probe />)).toContain('server');

      const { result } = renderHook(() => useIsClient());
      expect(result.current).toBe(true);
    });
  });
});
