import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  pendingMintKey,
  savePendingMint,
  loadPendingMint,
  clearPendingMint,
} from '../pendingMintStorage';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const KEY = pendingMintKey('course-1', 'step-1', 'GWALLET');

/** Minimal in-memory sessionStorage */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pendingMintKey', () => {
  it('is specific to the course, the step and the wallet', () => {
    const keys = new Set([
      pendingMintKey('course-1', 'step-1', 'GWALLET'),
      pendingMintKey('course-2', 'step-1', 'GWALLET'),
      pendingMintKey('course-1', 'step-2', 'GWALLET'),
      pendingMintKey('course-1', 'step-1', 'GOTHER'),
    ]);

    expect(keys.size).toBe(4);
  });
});

describe('pending mint storage', () => {
  it('saves, reads back and clears a submitted transaction', () => {
    const storage = fakeStorage();
    vi.stubGlobal('sessionStorage', storage);

    savePendingMint(KEY, { hash: HASH, expiresAtSec: 1_900_000_000 });

    expect(storage.data.size).toBe(1);
    expect(loadPendingMint(KEY)).toEqual({ hash: HASH, expiresAtSec: 1_900_000_000 });
    // Another step or wallet does not see it
    expect(loadPendingMint(pendingMintKey('course-1', 'step-1', 'GOTHER'))).toBeNull();

    clearPendingMint(KEY);

    expect(loadPendingMint(KEY)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it.each([
    ['not json', 'oops{'],
    ['a string', '"abc"'],
    ['null', 'null'],
    ['no hash', JSON.stringify({ expiresAtSec: 10 })],
    ['a hash that is not hexadecimal', JSON.stringify({ hash: '<script>', expiresAtSec: 10 })],
    ['no expiry', JSON.stringify({ hash: HASH })],
    ['an expiry that is not a number', JSON.stringify({ hash: HASH, expiresAtSec: 'soon' })],
  ])('ignores a stored value that is %s', (_label, raw) => {
    vi.stubGlobal('sessionStorage', fakeStorage({ [KEY]: raw }));

    expect(loadPendingMint(KEY)).toBeNull();
  });

  it('does nothing, without throwing, when sessionStorage does not exist (SSR)', () => {
    // Tests of this folder run in Node: there is no sessionStorage
    expect(typeof sessionStorage).toBe('undefined');

    expect(() => savePendingMint(KEY, { hash: HASH, expiresAtSec: 1 })).not.toThrow();
    expect(loadPendingMint(KEY)).toBeNull();
    expect(() => clearPendingMint(KEY)).not.toThrow();
  });

  it('does nothing, without throwing, when sessionStorage refuses access (private mode)', () => {
    const denied = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    vi.stubGlobal('sessionStorage', { getItem: denied, setItem: denied, removeItem: denied });

    expect(() => savePendingMint(KEY, { hash: HASH, expiresAtSec: 1 })).not.toThrow();
    expect(loadPendingMint(KEY)).toBeNull();
    expect(() => clearPendingMint(KEY)).not.toThrow();
  });

  it('does not throw when reading the sessionStorage property itself throws', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied', 'SecurityError');
      },
    });
    try {
      expect(() => savePendingMint(KEY, { hash: HASH, expiresAtSec: 1 })).not.toThrow();
      expect(loadPendingMint(KEY)).toBeNull();
      expect(() => clearPendingMint(KEY)).not.toThrow();
    } finally {
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    }
  });
});
