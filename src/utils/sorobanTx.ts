/**
 * Submission and confirmation of a signed Soroban transaction.
 *
 * `sendTransaction` only tells whether the RPC accepted the transaction for
 * inclusion; the final result comes from `getTransaction`. These helpers keep
 * the two steps explicit and never turn an unreadable status into a failure.
 */

import { sleep as defaultSleep } from './sleep';

/** Subset of the Soroban RPC server used to submit a transaction */
export interface SorobanSender<Tx> {
  sendTransaction(tx: Tx): Promise<{ status: string }>;
}

/**
 * - PENDING / DUPLICATE: the network knows the transaction, poll for its result
 * - UNKNOWN: every attempt failed at the network level, so the transaction may
 *   or may not have been received; poll for its result as well
 */
export type SorobanSubmitStatus = 'PENDING' | 'DUPLICATE' | 'UNKNOWN';

/**
 * - REJECTED: the RPC refused the transaction (status ERROR), it will not run
 * - BUSY: the RPC kept answering TRY_AGAIN_LATER, the transaction was not queued
 */
export type SorobanSubmitFailure = 'REJECTED' | 'BUSY';

export class SorobanSubmitError extends Error {
  constructor(public readonly reason: SorobanSubmitFailure) {
    super(
      reason === 'REJECTED'
        ? 'The transaction was rejected by the Soroban RPC'
        : 'The Soroban RPC did not accept the transaction (TRY_AGAIN_LATER)'
    );
    this.name = 'SorobanSubmitError';
  }
}

export interface SubmitOptions {
  /** Total number of `sendTransaction` attempts (default: 4) */
  maxAttempts?: number;
  /** Delay before the first resend, multiplied by the attempt number (default: 1500 ms) */
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Send a signed transaction, resending it a bounded number of times on
 * TRY_AGAIN_LATER or on a network error. Resending is safe: it is the same
 * signed envelope, so the network answers DUPLICATE if it already has it.
 *
 * @throws SorobanSubmitError when the transaction is rejected or never queued
 */
export async function submitTransaction<Tx>(
  server: SorobanSender<Tx>,
  tx: Tx,
  options: SubmitOptions = {}
): Promise<SorobanSubmitStatus> {
  const { maxAttempts = 4, retryDelayMs = 1500, sleep = defaultSleep } = options;
  let networkErrorSeen = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let status: string | null = null;
    try {
      status = (await server.sendTransaction(tx)).status;
    } catch (error) {
      // Network error or HTTP 429: the transaction may or may not have arrived
      networkErrorSeen = true;
      console.warn('[sorobanTx] sendTransaction failed, will retry:', error);
    }

    if (status === 'PENDING' || status === 'DUPLICATE') {
      return status;
    }
    if (status !== null && status !== 'TRY_AGAIN_LATER') {
      throw new SorobanSubmitError('REJECTED');
    }
    if (attempt < maxAttempts) {
      await sleep(retryDelayMs * attempt);
    }
  }

  if (networkErrorSeen) {
    return 'UNKNOWN';
  }
  throw new SorobanSubmitError('BUSY');
}

/**
 * - SUCCESS / FAILED: final on-chain result
 * - EXPIRED: the transaction was not included and its time bounds have passed,
 *   so it can never be included anymore (safe to build a new one)
 * - UNKNOWN: no final result could be read before the deadline (not a failure:
 *   the transaction may still have succeeded)
 */
export type SorobanTxOutcome = 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'UNKNOWN';

/** Subset of the Soroban RPC server used to read a transaction status */
export interface SorobanReader {
  getTransaction(
    hash: string
  ): Promise<{ status: string; latestLedgerCloseTime?: number | string }>;
}

export interface WaitOptions {
  /** Absolute time (same clock as `now`, in ms) after which polling stops */
  deadline: number;
  /**
   * Upper time bound (maxTime) of the transaction, in seconds since the epoch.
   * When the RPC reports NOT_FOUND with a latest ledger closed after this time,
   * the transaction is known to be expired.
   */
  expiresAtSec?: number;
  /** Delay before the first poll (default: 1500 ms) */
  initialIntervalMs?: number;
  /** Multiplier applied to the delay after each poll (default: 1.2) */
  backoffFactor?: number;
  /** Upper bound for the delay between polls (default: 5000 ms) */
  maxIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Poll `getTransaction` until the transaction reaches SUCCESS or FAILED, is
 * proven expired, or until the deadline. A failed poll (HTTP 429, network
 * error) is retried on the next tick and is never reported as a failed
 * transaction.
 */
export async function waitForTransaction(
  server: SorobanReader,
  hash: string,
  options: WaitOptions
): Promise<SorobanTxOutcome> {
  const {
    deadline,
    expiresAtSec,
    initialIntervalMs = 1500,
    backoffFactor = 1.2,
    maxIntervalMs = 5000,
    sleep = defaultSleep,
    now = Date.now,
  } = options;

  let interval = initialIntervalMs;

  for (;;) {
    await sleep(interval);

    try {
      const response = await server.getTransaction(hash);
      if (response.status === 'SUCCESS' || response.status === 'FAILED') {
        return response.status;
      }
      const latestClose = Number(response.latestLedgerCloseTime);
      if (
        response.status === 'NOT_FOUND' &&
        expiresAtSec !== undefined &&
        Number.isFinite(latestClose) &&
        latestClose > expiresAtSec
      ) {
        return 'EXPIRED';
      }
    } catch (error) {
      console.warn('[sorobanTx] getTransaction failed, will retry:', error);
    }

    if (now() >= deadline) {
      return 'UNKNOWN';
    }
    interval = Math.min(Math.round(interval * backoffFactor), maxIntervalMs);
  }
}
