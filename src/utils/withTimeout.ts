/**
 * Upper bound on the time a Soroban RPC call may take.
 *
 * The RPC client has no timeout of its own: a call that never answers would
 * leave the mint flow waiting forever. A call cut short here is handled like a
 * network error (it may or may not have reached the server).
 */

/** Thrown when an RPC call did not answer within the allowed time */
export class RpcTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} did not answer within ${timeoutMs} ms`);
    this.name = 'RpcTimeoutError';
  }
}

/** Default time allowed for one Soroban RPC call (ms) */
export const DEFAULT_RPC_TIMEOUT_MS = 15000;

/**
 * Settle with the result of `promise`, or reject with `RpcTimeoutError` when
 * it has not settled after `timeoutMs`. The timer is always cleared.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RpcTimeoutError(label, timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
