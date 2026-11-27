import { describe, it, expect, vi } from 'vitest';
import { submitTransaction, waitForTransaction, SorobanSubmitError } from '../sorobanTx';

const HASH = 'abc123';
const noSleep = () => Promise.resolve();

function rateLimited(): Error {
  return Object.assign(new Error('Request failed with status code 429'), {
    response: { status: 429 },
  });
}

describe('submitTransaction', () => {
  it('returns once the RPC accepts the transaction (PENDING)', async () => {
    const sendTransaction = vi.fn().mockResolvedValue({ status: 'PENDING', hash: HASH });

    await expect(submitTransaction({ sendTransaction }, {}, { sleep: noSleep })).resolves.toBe(
      'PENDING'
    );
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('treats DUPLICATE as accepted: the transaction is already known to the network', async () => {
    const sendTransaction = vi.fn().mockResolvedValue({ status: 'DUPLICATE', hash: HASH });

    await expect(submitTransaction({ sendTransaction }, {}, { sleep: noSleep })).resolves.toBe(
      'DUPLICATE'
    );
  });

  it('resends on TRY_AGAIN_LATER, then succeeds', async () => {
    const sendTransaction = vi
      .fn()
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER', hash: HASH })
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER', hash: HASH })
      .mockResolvedValue({ status: 'PENDING', hash: HASH });

    await expect(submitTransaction({ sendTransaction }, {}, { sleep: noSleep })).resolves.toBe(
      'PENDING'
    );
    expect(sendTransaction).toHaveBeenCalledTimes(3);
  });

  it('gives up after a bounded number of TRY_AGAIN_LATER answers', async () => {
    const sendTransaction = vi.fn().mockResolvedValue({ status: 'TRY_AGAIN_LATER', hash: HASH });

    const error = await submitTransaction(
      { sendTransaction },
      {},
      { sleep: noSleep, maxAttempts: 4 }
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SorobanSubmitError);
    expect((error as SorobanSubmitError).reason).toBe('BUSY');
    expect(sendTransaction).toHaveBeenCalledTimes(4);
  });

  it('throws REJECTED on ERROR without resending', async () => {
    const sendTransaction = vi.fn().mockResolvedValue({ status: 'ERROR', hash: HASH });

    const error = await submitTransaction({ sendTransaction }, {}, { sleep: noSleep }).catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(SorobanSubmitError);
    expect((error as SorobanSubmitError).reason).toBe('REJECTED');
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('resends the same signed transaction after a network error', async () => {
    const sendTransaction = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValue({ status: 'DUPLICATE', hash: HASH });

    await expect(submitTransaction({ sendTransaction }, {}, { sleep: noSleep })).resolves.toBe(
      'DUPLICATE'
    );
    expect(sendTransaction).toHaveBeenCalledTimes(2);
  });

  it('reports UNKNOWN when every attempt fails at the network level', async () => {
    const sendTransaction = vi.fn().mockRejectedValue(new Error('Network Error'));

    await expect(
      submitTransaction({ sendTransaction }, {}, { sleep: noSleep, maxAttempts: 3 })
    ).resolves.toBe('UNKNOWN');
    expect(sendTransaction).toHaveBeenCalledTimes(3);
  });
});

describe('waitForTransaction', () => {
  const farDeadline = () => ({ deadline: 1_000_000, now: () => 0, sleep: noSleep });

  it('resolves SUCCESS when the transaction is confirmed', async () => {
    const getTransaction = vi.fn().mockResolvedValue({ status: 'SUCCESS' });

    await expect(waitForTransaction({ getTransaction }, HASH, farDeadline())).resolves.toBe(
      'SUCCESS'
    );
    expect(getTransaction).toHaveBeenCalledWith(HASH);
  });

  it('resolves FAILED when the transaction failed on-chain', async () => {
    const getTransaction = vi.fn().mockResolvedValue({ status: 'FAILED' });

    await expect(waitForTransaction({ getTransaction }, HASH, farDeadline())).resolves.toBe(
      'FAILED'
    );
  });

  it('keeps polling while the transaction is NOT_FOUND, then resolves SUCCESS', async () => {
    const getTransaction = vi
      .fn()
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValue({ status: 'SUCCESS' });

    await expect(waitForTransaction({ getTransaction }, HASH, farDeadline())).resolves.toBe(
      'SUCCESS'
    );
    expect(getTransaction).toHaveBeenCalledTimes(3);
  });

  it('retries on HTTP 429 and network errors instead of failing', async () => {
    const getTransaction = vi
      .fn()
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValue({ status: 'SUCCESS' });

    await expect(waitForTransaction({ getTransaction }, HASH, farDeadline())).resolves.toBe(
      'SUCCESS'
    );
    expect(getTransaction).toHaveBeenCalledTimes(3);
  });

  it('waits 1.5 s before the first poll and backs off gently, capped at 5 s', async () => {
    const delays: number[] = [];
    let polls = 0;
    const getTransaction = vi.fn().mockImplementation(() => {
      polls++;
      return Promise.resolve({ status: polls < 12 ? 'NOT_FOUND' : 'SUCCESS' });
    });

    await waitForTransaction({ getTransaction }, HASH, {
      deadline: 1_000_000,
      now: () => 0,
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    expect(delays[0]).toBe(1500);
    expect(delays[1]).toBeGreaterThan(1500);
    expect(delays[1]).toBeLessThanOrEqual(2000);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1] ?? 0);
      expect(delays[i]).toBeLessThanOrEqual(5000);
    }
    expect(delays[delays.length - 1]).toBe(5000);
  });

  it('resolves EXPIRED as soon as a ledger closed after the transaction time bound', async () => {
    const getTransaction = vi
      .fn()
      .mockResolvedValueOnce({ status: 'NOT_FOUND', latestLedgerCloseTime: 999 })
      .mockResolvedValue({ status: 'NOT_FOUND', latestLedgerCloseTime: '1001' });

    const outcome = await waitForTransaction({ getTransaction }, HASH, {
      ...farDeadline(),
      expiresAtSec: 1000,
    });

    expect(outcome).toBe('EXPIRED');
    expect(getTransaction).toHaveBeenCalledTimes(2);
  });

  it('resolves UNKNOWN, not EXPIRED, at the deadline when expiry cannot be proven', async () => {
    let clock = 0;
    const getTransaction = vi
      .fn()
      .mockResolvedValue({ status: 'NOT_FOUND', latestLedgerCloseTime: 500 });

    const outcome = await waitForTransaction({ getTransaction }, HASH, {
      deadline: 10_000,
      expiresAtSec: 1000,
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
    });

    expect(outcome).toBe('UNKNOWN');
    // Bounded: it stopped polling shortly after the deadline
    expect(clock).toBeGreaterThanOrEqual(10_000);
    expect(clock).toBeLessThan(20_000);
  });

  it('never reports a failure for a transaction whose status could not be read', async () => {
    let clock = 0;
    const getTransaction = vi.fn().mockRejectedValue(rateLimited());

    const outcome = await waitForTransaction({ getTransaction }, HASH, {
      deadline: 6_000,
      expiresAtSec: 1,
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
    });

    expect(outcome).toBe('UNKNOWN');
  });
});
