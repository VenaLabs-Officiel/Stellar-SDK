/**
 * Memory of a mint transaction that was submitted but not recorded yet.
 *
 * Once signed, a mint transaction reaches the network even if the page is
 * reloaded or the step is left before its confirmation. Its hash is kept in
 * `sessionStorage` so the step can pick the transaction up again instead of
 * offering a second mint with a voucher that is already used.
 *
 * Storage is best effort: when `sessionStorage` is missing (server-side
 * rendering) or refuses access (private browsing, blocked site data), every
 * function here does nothing and never throws.
 */

/** A submitted transaction and the end of its validity (seconds since the epoch) */
export interface StoredPendingMint {
  hash: string;
  expiresAtSec: number;
}

const KEY_PREFIX = 'venalabs-sdk:pending-mint';
const HASH_PATTERN = /^[0-9a-f]{1,128}$/i;

/** Storage key of the pending mint of one step for one wallet */
export function pendingMintKey(courseId: string, stepId: string, walletAddress: string): string {
  return `${KEY_PREFIX}:${courseId}:${stepId}:${walletAddress}`;
}

function getStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function savePendingMint(key: string, tx: StoredPendingMint): void {
  try {
    getStorage()?.setItem(key, JSON.stringify({ hash: tx.hash, expiresAtSec: tx.expiresAtSec }));
  } catch {
    // Best effort: the mint goes on without the memory of its transaction
  }
}

/** Read the pending mint stored under `key`, or null when there is none (or an unusable one) */
export function loadPendingMint(key: string): StoredPendingMint | null {
  try {
    const raw = getStorage()?.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    const { hash, expiresAtSec } = parsed as Record<string, unknown>;
    if (typeof hash !== 'string' || !HASH_PATTERN.test(hash)) {
      return null;
    }
    if (typeof expiresAtSec !== 'number' || !Number.isFinite(expiresAtSec)) {
      return null;
    }
    return { hash, expiresAtSec };
  } catch {
    return null;
  }
}

export function clearPendingMint(key: string): void {
  try {
    getStorage()?.removeItem(key);
  } catch {
    // Best effort
  }
}
