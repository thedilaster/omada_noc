import { describe, it, expect } from 'vitest';
import { isUuid, toCanonicalMac, parseBoundedInt } from '@/lib/db/validation';

describe('Input validation helpers (lib/db/validation)', () => {
  it('accepts only 8-4-4-4-12 hex UUID strings', () => {
    expect(isUuid('00000000-0000-0000-0000-000000000001')).toBe(true);
    expect(isUuid('927A686D-C151-4F5F-BA08-3029C42BEDFB')).toBe(true);
    expect(isUuid('user-123')).toBe(false);
    expect(isUuid('927a686dc1514f5fba083029c42bedfb')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(42)).toBe(false);
  });

  it('canonicalizes any MAC notation to AA-BB-CC-DD-EE-FF', () => {
    expect(toCanonicalMac('aa:bb:cc:dd:ee:ff')).toBe('AA-BB-CC-DD-EE-FF');
    expect(toCanonicalMac('30-68-93-E8-29-54')).toBe('30-68-93-E8-29-54');
    expect(toCanonicalMac(' 3068.93e8.2954 ')).toBe('30-68-93-E8-29-54');
    expect(toCanonicalMac('AA:BB:CC')).toBeNull();
    expect(toCanonicalMac('AA:BB:CC:DD:EE:FF:00')).toBeNull();
    expect(toCanonicalMac('')).toBeNull();
    expect(toCanonicalMac(null)).toBeNull();
  });

  it('parses bounded integers with a fallback for missing or non-numeric input', () => {
    expect(parseBoundedInt('5', 10, 1, 100)).toBe(5);
    expect(parseBoundedInt('abc', 10, 1, 100)).toBe(10);
    expect(parseBoundedInt('', 10, 1, 100)).toBe(10);
    expect(parseBoundedInt('   ', 10, 1, 100)).toBe(10);
    expect(parseBoundedInt(null, 10, 1, 100)).toBe(10);
    expect(parseBoundedInt(undefined, 10, 1, 100)).toBe(10);
    expect(parseBoundedInt('Infinity', 10, 1, 100)).toBe(10);
    expect(parseBoundedInt('0', 10, 1, 100)).toBe(1);
    expect(parseBoundedInt('1e9', 10, 1, 100)).toBe(100);
    expect(parseBoundedInt('7.9', 10, 1, 100)).toBe(7);
  });
});
