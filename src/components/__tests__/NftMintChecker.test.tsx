import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { VenalabsApiClient } from '../../api';
import { NftMintChecker } from '../ui/NftMintChecker';
import { VenalabsStellarSDK } from '../VenalabsStellarSDK';
import type { VenalabsChecker, VenalabsCourse, VenalabsMap } from '../../types';

// ------------------------------------------------------------------
// Mocks: Soroban RPC (via @stellar/stellar-sdk) and the wallet context
// ------------------------------------------------------------------

const USER_ADDRESS = 'GUSERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUSER';
const TX_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

const mocks = vi.hoisted(() => {
  const rpc = {
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
  };
  return {
    rpc,
    serverCtor: vi.fn(),
    txTimeouts: [] as number[],
    signedWith: [] as string[],
    timing: { txTimeoutSeconds: 180, confirmationGraceMs: 15000, rpcTimeoutMs: 15000 },
    wallet: {
      current: {} as Record<string, unknown>,
    },
  };
});

vi.mock('@stellar/stellar-sdk', () => {
  class TransactionBuilder {
    addOperation() {
      return this;
    }
    setTimeout(seconds: number) {
      mocks.txTimeouts.push(seconds);
      return this;
    }
    build() {
      return { toXDR: () => 'unsigned-xdr' };
    }
  }
  class Address {
    toScVal() {
      return {};
    }
  }
  class Transaction {
    timeBounds = {
      minTime: '0',
      maxTime: String(Math.floor(Date.now() / 1000) + mocks.timing.txTimeoutSeconds),
    };
    constructor(
      public envelope: string,
      public passphrase: string
    ) {
      mocks.signedWith.push(passphrase);
    }
    hash() {
      return { toString: () => 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90' };
    }
  }
  class Server {
    constructor(url: string, opts?: unknown) {
      mocks.serverCtor(url, opts);
      return mocks.rpc as unknown as Server;
    }
  }
  return {
    TransactionBuilder,
    Address,
    Transaction,
    Operation: { invokeContractFunction: () => ({}) },
    BASE_FEE: '100',
    xdr: {
      ScVal: { scvString: () => ({}), scvU64: () => ({}), scvBytes: () => ({}) },
      Uint64: { fromString: () => ({}) },
    },
    rpc: {
      Server,
      assembleTransaction: () => ({ build: () => ({ toXDR: () => 'assembled-xdr' }) }),
      Api: {
        isSimulationError: (sim: { error?: string }) => typeof sim.error === 'string',
      },
    },
  };
});

vi.mock('../../wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../wallet')>();
  return {
    ...actual,
    useStellarWallet: () => mocks.wallet.current,
    StellarWalletProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

vi.mock('../../utils/mintTiming', () => ({ MINT_TIMING: mocks.timing }));

// Polling delays are reduced to one macrotask so the tests do not wait on real timers
vi.mock('../../utils/sleep', () => ({
  sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
}));

// ------------------------------------------------------------------
// API (MSW)
// ------------------------------------------------------------------

const BASE_URL = 'https://api.test.com';
const COURSE_ID = 'course-1';
const STEP_ID = 'step-mint';
const SDK = `${BASE_URL}/api/v1/sdk`;

const api = {
  voucherCalls: 0,
  nftVerifyBodies: [] as Array<{ txHash: string }>,
  voucher: {} as Record<string, unknown>,
  /** Ordered log of RPC status reads and nft-verify calls */
  events: [] as string[],
};

/** Make getTransaction answer the given statuses in order (the last one repeats) */
function mockTxStatuses(statuses: Array<string | Error>, latestLedgerCloseTime?: number) {
  let call = 0;
  mocks.rpc.getTransaction.mockReset().mockImplementation(() => {
    const status = statuses[Math.min(call, statuses.length - 1)];
    call++;
    if (status instanceof Error) {
      api.events.push('getTransaction:error');
      return Promise.reject(status);
    }
    api.events.push(`getTransaction:${status}`);
    return Promise.resolve({ status, txHash: TX_HASH, latestLedgerCloseTime });
  });
}

function rateLimited(): Error {
  return Object.assign(new Error('Request failed with status code 429'), {
    response: { status: 429 },
  });
}

function pendingVoucher(overrides: Record<string, unknown> = {}) {
  return {
    network: 'STELLAR_TESTNET',
    recipient: USER_ADDRESS,
    nonce: '42',
    signature: 'ab'.repeat(64),
    status: 'PENDING',
    contractAddress: 'CCONTRACT',
    slug: 'org',
    name: 'Badge',
    ...overrides,
  };
}

const server = setupServer(
  http.get(`${SDK}/courses/:courseId/steps/:stepId/nft-voucher`, () => {
    api.voucherCalls++;
    return HttpResponse.json(api.voucher);
  }),
  http.post(`${SDK}/courses/:courseId/steps/:stepId/nft-verify`, async ({ request }) => {
    api.nftVerifyBodies.push((await request.json()) as { txHash: string });
    api.events.push('nft-verify');
    return new HttpResponse(null, { status: 200 });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

beforeEach(() => {
  sessionStorage.clear();
  api.voucherCalls = 0;
  api.nftVerifyBodies = [];
  api.voucher = pendingVoucher();
  api.events = [];
  Object.assign(mocks.timing, {
    txTimeoutSeconds: 180,
    confirmationGraceMs: 15000,
    rpcTimeoutMs: 15000,
  });

  mocks.serverCtor.mockClear();
  mocks.txTimeouts.length = 0;
  mocks.signedWith.length = 0;
  mocks.rpc.getAccount.mockReset().mockResolvedValue({});
  mocks.rpc.simulateTransaction.mockReset().mockResolvedValue({ result: {} });
  mocks.rpc.sendTransaction.mockReset().mockResolvedValue({ status: 'PENDING', hash: TX_HASH });
  mockTxStatuses(['SUCCESS']);

  mocks.wallet.current = {
    kit: null,
    isInitialized: true,
    network: 'TESTNET',
    stellarAddress: USER_ADDRESS,
    isConnected: true,
    isConnecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signMessage: vi.fn(),
    signTransaction: vi.fn().mockResolvedValue('signed-xdr'),
    getWalletNetwork: vi.fn().mockResolvedValue(null),
  };
});

function makeChecker(network = 'STELLAR_TESTNET'): VenalabsChecker {
  return {
    id: 'checker-1',
    organizationId: 'org-1',
    name: { en: 'Mint the badge' },
    type: 'NFT_MINT',
    nftMintConfig: { network, contractAddress: 'CCONTRACT' },
    status: 'ACTIVE',
    createdOn: '',
  };
}

function makeClient() {
  return new VenalabsApiClient({
    apiKey: 'test-key',
    getAccessToken: () => Promise.resolve('test-token'),
    baseUrl: BASE_URL,
  });
}

function renderChecker(
  props: Partial<ComponentProps<typeof NftMintChecker>> = {},
  network = 'STELLAR_TESTNET'
) {
  return render(
    <NftMintChecker
      apiClient={makeClient()}
      courseId={COURSE_ID}
      stepId={STEP_ID}
      checker={makeChecker(network)}
      isCompleted={false}
      linkedWalletAddress={USER_ADDRESS}
      onWalletLinked={() => {}}
      onVerificationSuccess={() => {}}
      {...props}
    />
  );
}

/** sessionStorage key of the pending mint of the tested step */
const pendingKey = (address = USER_ADDRESS) =>
  `venalabs-sdk:pending-mint:${COURSE_ID}:${STEP_ID}:${address}`;

/** Simulate a mint transaction submitted by a previous page load or step visit */
function storePendingMint(expiresInSec = 180, address = USER_ADDRESS) {
  const expiresAtSec = Math.floor(Date.now() / 1000) + expiresInSec;
  sessionStorage.setItem(pendingKey(address), JSON.stringify({ hash: TX_HASH, expiresAtSec }));
  return expiresAtSec;
}

const SIMULATION_HINT =
  'The mint transaction could not be prepared. If you already minted this NFT, verify to complete the step. Otherwise, please try again later.';

async function clickMint() {
  const button = await screen.findByRole('button', { name: 'Mint NFT' });
  fireEvent.click(button);
  return button;
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('NftMintChecker: Soroban RPC endpoint', () => {
  it('uses the SDF testnet RPC by default on testnet, over HTTPS only', async () => {
    renderChecker();
    await clickMint();

    // Let the whole mint flow finish before asserting
    await screen.findByText('NFT minted successfully!');
    expect(mocks.serverCtor).toHaveBeenCalledTimes(1);
    expect(mocks.serverCtor).toHaveBeenCalledWith('https://soroban-testnet.stellar.org', {
      allowHttp: false,
    });
  });

  it('uses mainnet.sorobanrpc.com by default on mainnet', async () => {
    api.voucher = pendingVoucher({ network: 'STELLAR_PUBLIC' });
    mocks.wallet.current.network = 'PUBLIC';
    renderChecker({}, 'STELLAR_PUBLIC');
    await clickMint();

    // Let the whole mint flow finish before asserting
    await screen.findByText('NFT minted successfully!');
    expect(mocks.serverCtor).toHaveBeenCalledTimes(1);
    expect(mocks.serverCtor).toHaveBeenCalledWith('https://mainnet.sorobanrpc.com', {
      allowHttp: false,
    });
  });

  it('uses the sorobanRpcUrl override, allowing http:// for local development', async () => {
    renderChecker({ sorobanRpcUrl: 'http://localhost:8000/soroban/rpc' });
    await clickMint();

    // Let the whole mint flow finish before asserting
    await screen.findByText('NFT minted successfully!');
    expect(mocks.serverCtor).toHaveBeenCalledTimes(1);
    expect(mocks.serverCtor).toHaveBeenCalledWith('http://localhost:8000/soroban/rpc', {
      allowHttp: true,
    });
  });
});

describe('VenalabsStellarSDK: sorobanRpcUrl prop', () => {
  const map: VenalabsMap = {
    id: 'map-1',
    organizationId: 'org-1',
    name: 'Map',
    nodes: [{ id: 'node-1', courseId: COURSE_ID, courseName: { en: 'Mint course' }, x: 0, y: 0 }],
    connections: [],
    status: 'PUBLISHED',
    createdOn: '',
  };
  const course: VenalabsCourse = {
    id: COURSE_ID,
    organizationId: 'org-1',
    title: { en: 'Mint course' },
    steps: [
      {
        id: STEP_ID,
        title: { en: 'Mint step' },
        type: 'EXE',
        order: 0,
        exeContent: {
          instructions: { en: [] },
          checkerId: 'checker-1',
          checkerName: { en: 'Mint the badge' },
          checkerType: 'NFT_MINT',
          checkerNftMintConfig: { network: 'STELLAR_TESTNET', contractAddress: 'CCONTRACT' },
        },
      },
    ],
    status: 'PUBLISHED',
    createdOn: '',
  };

  it('is passed down to the mint flow', async () => {
    server.use(
      http.get(`${SDK}/maps`, () => HttpResponse.json([map])),
      http.get(`${SDK}/progress`, () => HttpResponse.json([])),
      http.get(`${SDK}/wallet`, () =>
        HttpResponse.json({ walletAddresses: { STELLAR_TESTNET: USER_ADDRESS } })
      ),
      http.get(`${SDK}/courses/${COURSE_ID}`, () => HttpResponse.json(course)),
      http.post(`${SDK}/courses/${COURSE_ID}/start`, () => HttpResponse.json({}))
    );

    render(
      <VenalabsStellarSDK
        apiKey="test-key"
        getAccessToken={() => Promise.resolve('test-token')}
        baseUrl={BASE_URL}
        sorobanRpcUrl="https://rpc.partner.example/soroban"
      />
    );

    const card = (await screen.findByText('Mint course')).closest('.venalabs-course-card');
    fireEvent.click(card!);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await clickMint();

    // Let the whole mint flow finish before asserting
    await screen.findByText('NFT minted successfully!');
    expect(mocks.serverCtor).toHaveBeenCalledTimes(1);
    expect(mocks.serverCtor).toHaveBeenCalledWith('https://rpc.partner.example/soroban', {
      allowHttp: false,
    });
  }, 20000);
});

describe('VenalabsStellarSDK: userKey prop and linked wallets', () => {
  it('does not show the wallet linked by the previous user', async () => {
    const map: VenalabsMap = {
      id: 'map-1',
      organizationId: 'org-1',
      name: 'Map',
      nodes: [{ id: 'node-1', courseId: COURSE_ID, courseName: { en: 'Mint course' }, x: 0, y: 0 }],
      connections: [],
      status: 'PUBLISHED',
      createdOn: '',
    };
    const course: VenalabsCourse = {
      id: COURSE_ID,
      organizationId: 'org-1',
      title: { en: 'Mint course' },
      steps: [
        {
          id: STEP_ID,
          title: { en: 'Mint step' },
          type: 'EXE',
          order: 0,
          exeContent: {
            instructions: { en: [] },
            checkerId: 'checker-1',
            checkerName: { en: 'Mint the badge' },
            checkerType: 'NFT_MINT',
            checkerNftMintConfig: { network: 'STELLAR_TESTNET', contractAddress: 'CCONTRACT' },
          },
        },
      ],
      status: 'PUBLISHED',
      createdOn: '',
    };
    const isAlice = (request: Request) =>
      request.headers.get('Authorization') === 'Bearer token-alice';
    server.use(
      http.get(`${SDK}/maps`, () => HttpResponse.json([map])),
      http.get(`${SDK}/progress`, () => HttpResponse.json([])),
      // Alice has linked the connected wallet; Bob's wallet request fails, so
      // nothing overwrites what the SDK holds (404: not retried by the client)
      http.get(`${SDK}/wallet`, ({ request }) =>
        isAlice(request)
          ? HttpResponse.json({ walletAddresses: { STELLAR_TESTNET: USER_ADDRESS } })
          : HttpResponse.json({ message: 'No wallet' }, { status: 404 })
      ),
      http.get(`${SDK}/courses/${COURSE_ID}`, () => HttpResponse.json(course)),
      http.post(`${SDK}/courses/${COURSE_ID}/start`, () => HttpResponse.json({})),
      http.get(`${SDK}/courses/:courseId/steps/:stepId/nft-voucher`, ({ request }) =>
        isAlice(request)
          ? HttpResponse.json(pendingVoucher())
          : HttpResponse.json({ message: 'NO_LINKED_WALLETS' }, { status: 400 })
      )
    );

    const renderSdk = (user: string) => (
      <VenalabsStellarSDK
        apiKey="test-key"
        getAccessToken={() => Promise.resolve(`token-${user}`)}
        baseUrl={BASE_URL}
        userKey={user}
      />
    );
    const openMintStep = async () => {
      fireEvent.click((await screen.findByText('Mint course')).closest('.venalabs-course-card')!);
      fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
      await screen.findByRole('button', { name: 'Mint NFT' });
    };

    const { rerender } = render(renderSdk('alice'));
    await openMintStep();
    expect(screen.getByText('Linked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mint NFT' })).toBeEnabled();

    rerender(renderSdk('bob'));
    await openMintStep();

    // The wallet linked by Alice is not Bob's: he has to link it himself
    expect(screen.queryByText('Linked')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link Wallet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mint NFT' })).toBeDisabled();
  }, 20000);
});

describe('NftMintChecker: transaction confirmation', () => {
  it('records the mint only after getTransaction reports SUCCESS', async () => {
    renderChecker();
    await clickMint();

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(api.events).toEqual(['getTransaction:SUCCESS', 'nft-verify']);
    expect(api.nftVerifyBodies).toEqual([{ txHash: TX_HASH }]);
    expect(mocks.rpc.getTransaction).toHaveBeenCalledWith(TX_HASH);
  });

  it('keeps the transaction valid for 180 seconds', async () => {
    // The real module, not the mock used by the other tests
    const actual =
      await vi.importActual<typeof import('../../utils/mintTiming')>('../../utils/mintTiming');

    expect(actual.MINT_TIMING.txTimeoutSeconds).toBe(180);
  });

  it('builds the transaction with the configured validity', async () => {
    // A value that only this test uses: it can only reach
    // TransactionBuilder.setTimeout through MINT_TIMING
    mocks.timing.txTimeoutSeconds = 137;
    renderChecker();
    await clickMint();

    await screen.findByText('NFT minted successfully!');
    expect(mocks.txTimeouts).toEqual([137]);
  });

  it('polls while the transaction is pending, then records it once it succeeds', async () => {
    mockTxStatuses(['NOT_FOUND', 'NOT_FOUND', 'SUCCESS']);
    renderChecker();
    await clickMint();

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(api.events).toEqual([
      'getTransaction:NOT_FOUND',
      'getTransaction:NOT_FOUND',
      'getTransaction:SUCCESS',
      'nft-verify',
    ]);
  });

  it('shows a clear error and never calls nft-verify when the transaction FAILED', async () => {
    mockTxStatuses(['NOT_FOUND', 'FAILED']);
    renderChecker();
    await clickMint();

    expect(
      await screen.findByText('The mint transaction failed on-chain. Please try again.')
    ).toBeInTheDocument();
    expect(api.nftVerifyBodies).toEqual([]);
    expect(screen.queryByText('NFT minted successfully!')).not.toBeInTheDocument();
    // The user can try again
    expect(screen.getByRole('button', { name: 'Mint NFT' })).toBeEnabled();
  });

  it('retries on HTTP 429 and network errors during polling instead of failing the mint', async () => {
    mockTxStatuses([rateLimited(), new Error('Network Error'), 'NOT_FOUND', 'SUCCESS']);
    renderChecker();
    await clickMint();

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(mocks.rpc.getTransaction).toHaveBeenCalledTimes(4);
    expect(api.nftVerifyBodies).toEqual([{ txHash: TX_HASH }]);
    expect(document.querySelector('.venalabs-error-banner')).not.toBeInTheDocument();
  });

  it('does not call nft-verify when sendTransaction answers ERROR', async () => {
    mocks.rpc.sendTransaction.mockResolvedValue({ status: 'ERROR', hash: TX_HASH });
    renderChecker();
    await clickMint();

    expect(await screen.findByText('Transaction failed. Please try again.')).toBeInTheDocument();
    expect(mocks.rpc.getTransaction).not.toHaveBeenCalled();
    expect(api.nftVerifyBodies).toEqual([]);
  });

  it('confirms a mint whose first sendTransaction answer was lost, even if the resend answers ERROR', async () => {
    // The first send reached the network; the resend is refused (sequence already used)
    mocks.rpc.sendTransaction
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValue({ status: 'ERROR', hash: TX_HASH, errorResult: 'txBadSeq' });
    mockTxStatuses(['NOT_FOUND', 'SUCCESS']);
    renderChecker();
    await clickMint();

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(api.nftVerifyBodies).toEqual([{ txHash: TX_HASH }]);
    expect(screen.queryByText('Transaction failed. Please try again.')).not.toBeInTheDocument();
  });

  it('reports the on-chain failure when ERROR follows a lost answer and the transaction failed', async () => {
    mocks.rpc.sendTransaction
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValue({ status: 'ERROR', hash: TX_HASH });
    mockTxStatuses(['FAILED']);
    renderChecker();
    await clickMint();

    expect(
      await screen.findByText('The mint transaction failed on-chain. Please try again.')
    ).toBeInTheDocument();
    expect(api.nftVerifyBodies).toEqual([]);
  });

  it('resends on TRY_AGAIN_LATER, then confirms', async () => {
    mocks.rpc.sendTransaction
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER', hash: TX_HASH })
      .mockResolvedValue({ status: 'PENDING', hash: TX_HASH });
    renderChecker();
    await clickMint();

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(mocks.rpc.sendTransaction).toHaveBeenCalledTimes(2);
  });

  it('stops resending after a bounded number of TRY_AGAIN_LATER answers', async () => {
    mocks.rpc.sendTransaction.mockResolvedValue({ status: 'TRY_AGAIN_LATER', hash: TX_HASH });
    renderChecker();
    await clickMint();

    expect(
      await screen.findByText(
        'The Stellar network is busy and did not accept the transaction. Please try again in a moment.'
      )
    ).toBeInTheDocument();
    expect(mocks.rpc.sendTransaction).toHaveBeenCalledTimes(4);
    expect(api.nftVerifyBodies).toEqual([]);
  });

  it('keeps polling when sendTransaction answers DUPLICATE', async () => {
    mocks.rpc.sendTransaction.mockResolvedValue({ status: 'DUPLICATE', hash: TX_HASH });
    mockTxStatuses(['NOT_FOUND', 'SUCCESS']);
    renderChecker();
    await clickMint();

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(api.nftVerifyBodies).toEqual([{ txHash: TX_HASH }]);
  });
});

describe('NftMintChecker: Soroban RPC that does not answer', () => {
  const never = () => new Promise<never>(() => {});

  it('keeps polling when a getTransaction call never answers', async () => {
    mocks.timing.rpcTimeoutMs = 20;
    mocks.rpc.getTransaction
      .mockReset()
      .mockImplementationOnce(never)
      .mockResolvedValue({ status: 'SUCCESS', txHash: TX_HASH });
    renderChecker();
    await clickMint();

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(mocks.rpc.getTransaction).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.venalabs-error-banner')).not.toBeInTheDocument();
  });

  it('moves on to polling when sendTransaction never answers, without reporting a failure', async () => {
    mocks.timing.rpcTimeoutMs = 20;
    mocks.rpc.sendTransaction.mockReset().mockImplementation(never);
    renderChecker();
    await clickMint();

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(api.nftVerifyBodies).toEqual([{ txHash: TX_HASH }]);
    expect(document.querySelector('.venalabs-error-banner')).not.toBeInTheDocument();
  });

  it('gives the button back when the simulation never answers, before anything is signed', async () => {
    mocks.timing.rpcTimeoutMs = 20;
    mocks.rpc.simulateTransaction.mockReset().mockImplementation(never);
    renderChecker();
    await clickMint();

    expect(
      await screen.findByText('The mint transaction could not be prepared. Please try again later.')
    ).toBeInTheDocument();
    expect(mocks.wallet.current.signTransaction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Mint NFT' })).toBeEnabled();
    // An RPC that does not answer says nothing about an earlier mint
    expect(screen.getByRole('button', { name: 'Verify & Complete' })).toBeDisabled();
  });

  it('gives the button back when the account lookup never answers', async () => {
    mocks.timing.rpcTimeoutMs = 20;
    mocks.rpc.getAccount.mockReset().mockImplementation(never);
    renderChecker();
    await clickMint();

    expect(
      await screen.findByText('The mint transaction could not be prepared. Please try again later.')
    ).toBeInTheDocument();
    expect(mocks.wallet.current.signTransaction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Mint NFT' })).toBeEnabled();
  });
});

describe('NftMintChecker: double submission', () => {
  it('sends a single transaction when the mint button is clicked twice in the same tick', async () => {
    renderChecker();
    const button = await screen.findByRole('button', { name: 'Mint NFT' });

    // Both clicks are dispatched before React re-renders the disabled button
    act(() => {
      button.click();
      button.click();
    });

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(mocks.wallet.current.signTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(api.nftVerifyBodies).toHaveLength(1);
  });
});

describe('NftMintChecker: nft-verify failure after a confirmed mint', () => {
  it('retries a bounded number of times, then offers to record the mint again', async () => {
    let attempts = 0;
    let failing = true;
    server.use(
      http.post(`${SDK}/courses/:courseId/steps/:stepId/nft-verify`, () => {
        attempts++;
        return failing
          ? HttpResponse.json({ message: 'boom' }, { status: 500 })
          : new HttpResponse(null, { status: 200 });
      })
    );

    renderChecker();
    await clickMint();

    // The mint is reported as done on-chain, not swallowed and not shown as failed
    expect(
      await screen.findByText(/Your NFT was minted on-chain, but the mint could not be recorded/)
    ).toBeInTheDocument();
    expect(attempts).toBe(3);
    expect(screen.queryByText(/Minting failed/)).not.toBeInTheDocument();
    // Minting again would replay a used voucher
    expect(screen.queryByRole('button', { name: 'Mint NFT' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minted!' })).toBeDisabled();
    // Not a dead end: the backend detects the mint on-chain when the step is verified
    expect(screen.getByRole('button', { name: 'Verify & Complete' })).toBeEnabled();

    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Record mint again' }));

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(attempts).toBe(4);
    expect(mocks.rpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Verify & Complete' })).toBeEnabled();
  });
});

describe('NftMintChecker: nft-verify refused for good after a confirmed mint', () => {
  const REFUSED_MESSAGE =
    'Your NFT was minted on-chain. Do not mint again: verify to complete the step.';

  function refuseRecording(status: number, message: string) {
    const calls = { count: 0 };
    server.use(
      http.post(`${SDK}/courses/:courseId/steps/:stepId/nft-verify`, () => {
        calls.count++;
        return HttpResponse.json({ status, message }, { status });
      })
    );
    return calls;
  }

  it.each([
    [409, 'Voucher already minted with another transaction'],
    [400, 'Voucher network does not match the checker'],
  ])('does not loop on recording after a %i: it offers to verify', async (status, message) => {
    const calls = refuseRecording(status, message);
    server.use(
      http.post(`${SDK}/courses/:courseId/steps/:stepId/verify`, () =>
        HttpResponse.json({ passed: true })
      )
    );
    const onVerificationSuccess = vi.fn();
    renderChecker({ onVerificationSuccess });
    await clickMint();

    expect(await screen.findByText(REFUSED_MESSAGE)).toBeInTheDocument();
    // A definitive answer is not retried, and no retry is offered
    expect(calls.count).toBe(1);
    expect(screen.queryByRole('button', { name: 'Record mint again' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Minting failed/)).not.toBeInTheDocument();
    // Minting again would replay a used voucher
    expect(screen.getByRole('button', { name: 'Minted!' })).toBeDisabled();

    // The backend detects the mint on-chain when the step is verified
    fireEvent.click(screen.getByRole('button', { name: 'Verify & Complete' }));
    expect(await screen.findByText('Verification passed!')).toBeInTheDocument();
    await waitFor(() => expect(onVerificationSuccess).toHaveBeenCalledTimes(1));
    expect(calls.count).toBe(1);
  });

  it('stops offering "Record mint again" once a retry is refused for good', async () => {
    let status = 500;
    let attempts = 0;
    server.use(
      http.post(`${SDK}/courses/:courseId/steps/:stepId/nft-verify`, () => {
        attempts++;
        return HttpResponse.json({ status, message: 'boom' }, { status });
      })
    );
    renderChecker();
    await clickMint();
    await screen.findByText(/Your NFT was minted on-chain, but the mint could not be recorded/);
    expect(attempts).toBe(3);

    status = 409;
    fireEvent.click(screen.getByRole('button', { name: 'Record mint again' }));

    expect(await screen.findByText(REFUSED_MESSAGE)).toBeInTheDocument();
    expect(attempts).toBe(4);
    expect(screen.queryByRole('button', { name: 'Record mint again' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify & Complete' })).toBeEnabled();
  });

  it('shows the same way out after a reload, without looping', async () => {
    const calls = refuseRecording(409, 'Voucher is not pending');
    storePendingMint();
    renderChecker();

    expect(await screen.findByText(REFUSED_MESSAGE)).toBeInTheDocument();
    expect(calls.count).toBe(1);
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Record mint again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mint NFT' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify & Complete' })).toBeEnabled();
  });
});

describe('NftMintChecker: verifying with a mint that is not recorded', () => {
  it('completes the step when nft-verify keeps failing, and forgets the stored transaction', async () => {
    server.use(
      http.post(`${SDK}/courses/:courseId/steps/:stepId/nft-verify`, () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 })
      ),
      http.post(`${SDK}/courses/:courseId/steps/:stepId/verify`, () =>
        HttpResponse.json({ passed: true })
      )
    );
    const onVerificationSuccess = vi.fn();
    renderChecker({ onVerificationSuccess });
    await clickMint();
    await screen.findByText(/Your NFT was minted on-chain, but the mint could not be recorded/);
    // Still remembered: a reload must not offer a second mint
    expect(sessionStorage.getItem(pendingKey())).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Verify & Complete' }));

    expect(await screen.findByText('Verification passed!')).toBeInTheDocument();
    await waitFor(() => expect(onVerificationSuccess).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(pendingKey())).toBeNull();
  });

  it('can verify while the status of the transaction is unknown', async () => {
    mocks.timing.confirmationGraceMs = -10 * 60 * 1000;
    mockTxStatuses([rateLimited()]);
    server.use(
      http.post(`${SDK}/courses/:courseId/steps/:stepId/verify`, () =>
        HttpResponse.json({ passed: false, message: 'No mint found yet' })
      )
    );
    renderChecker();
    await clickMint();
    await screen.findByText(/The transaction has not been confirmed yet/);

    const verify = screen.getByRole('button', { name: 'Verify & Complete' });
    expect(verify).toBeEnabled();
    fireEvent.click(verify);

    expect(await screen.findByText('No mint found yet')).toBeInTheDocument();
    // The transaction is still followed
    expect(screen.getByRole('button', { name: 'Check status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mint NFT' })).toBeDisabled();
  });
});

describe('NftMintChecker: unconfirmed transaction', () => {
  it('does not report a failure when the status cannot be read, and re-checks the same transaction', async () => {
    // No time is left to confirm: the wait ends after a single unreadable poll
    mocks.timing.confirmationGraceMs = -10 * 60 * 1000;
    mockTxStatuses([rateLimited()]);

    renderChecker();
    await clickMint();

    expect(
      await screen.findByText(/The transaction has not been confirmed yet/)
    ).toBeInTheDocument();
    expect(api.nftVerifyBodies).toEqual([]);
    expect(document.querySelector('.venalabs-error-banner')).not.toBeInTheDocument();
    // Minting again while the first transaction is unresolved is not offered
    expect(screen.getByRole('button', { name: 'Mint NFT' })).toBeDisabled();

    // The transaction is confirmed: checking again records it, without a new mint
    mockTxStatuses(['SUCCESS']);
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(api.nftVerifyBodies).toEqual([{ txHash: TX_HASH }]);
    expect(mocks.rpc.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('lets the user mint again once the transaction is proven expired', async () => {
    // The RPC has closed a ledger far after the transaction time bound
    mockTxStatuses(['NOT_FOUND'], Math.floor(Date.now() / 1000) + 3600);

    renderChecker();
    await clickMint();

    expect(
      await screen.findByText(/The transaction expired before it was included in a ledger/)
    ).toBeInTheDocument();
    expect(api.nftVerifyBodies).toEqual([]);
    expect(screen.getByRole('button', { name: 'Mint NFT' })).toBeEnabled();
  });
});

describe('NftMintChecker: checks before signing', () => {
  // The contract panics when the voucher nonce was already used, but the panic
  // text does not reliably come back from the wasm: no wording is relied upon
  it.each([
    ['HostError: Error(WasmVm, InvalidAction)'],
    ['HostError: ... "Nonce already used for given name and slug" ...'],
    [''],
  ])('does not sign when the simulation fails (%j) and invites to verify', async (simError) => {
    mocks.rpc.simulateTransaction.mockResolvedValue({ error: simError });
    renderChecker();
    await clickMint();

    expect(await screen.findByText(SIMULATION_HINT)).toBeInTheDocument();
    expect(mocks.wallet.current.signTransaction).not.toHaveBeenCalled();
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
    // Neither a dead end nor a forced choice: both actions are available
    expect(screen.getByRole('button', { name: 'Verify & Complete' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Mint NFT' })).toBeEnabled();
  });

  it('completes the step by verifying when the NFT was already minted elsewhere', async () => {
    // Minted in another tab or browser: the voucher is still PENDING and its nonce is used
    mocks.rpc.simulateTransaction.mockResolvedValue({ error: 'HostError: Error(WasmVm, ...)' });
    server.use(
      http.post(`${SDK}/courses/:courseId/steps/:stepId/verify`, () =>
        HttpResponse.json({ passed: true })
      )
    );
    const onVerificationSuccess = vi.fn();
    renderChecker({ onVerificationSuccess });
    await clickMint();
    await screen.findByText(SIMULATION_HINT);

    fireEvent.click(screen.getByRole('button', { name: 'Verify & Complete' }));

    expect(await screen.findByText('Verification passed!')).toBeInTheDocument();
    await waitFor(() => expect(onVerificationSuccess).toHaveBeenCalledTimes(1));
    expect(api.nftVerifyBodies).toEqual([]);
  });

  it('lets the user mint again when the verification finds no mint', async () => {
    mocks.rpc.simulateTransaction.mockResolvedValueOnce({ error: 'HostError: temporary' });
    server.use(
      http.post(`${SDK}/courses/:courseId/steps/:stepId/verify`, () =>
        HttpResponse.json({ passed: false })
      )
    );
    renderChecker();
    await clickMint();
    await screen.findByText(SIMULATION_HINT);

    fireEvent.click(screen.getByRole('button', { name: 'Verify & Complete' }));
    expect(
      await screen.findByText('Verification failed. Make sure you have minted the NFT.')
    ).toBeInTheDocument();

    // The simulation works this time: the mint goes through
    await clickMint();
    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
  });

  it('keeps "Verify & Complete" disabled as long as nothing suggests a mint', async () => {
    renderChecker();

    await screen.findByRole('button', { name: 'Mint NFT' });
    expect(screen.getByRole('button', { name: 'Verify & Complete' })).toBeDisabled();
  });

  it('does not sign when the voucher recipient is not the connected wallet', async () => {
    api.voucher = pendingVoucher({
      recipient: 'GOTHERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOTHER',
    });
    renderChecker();
    await clickMint();

    expect(
      await screen.findByText(/This NFT is reserved for wallet GOTHER\.\.\.THER/)
    ).toBeInTheDocument();
    expect(mocks.rpc.getAccount).not.toHaveBeenCalled();
    expect(mocks.wallet.current.signTransaction).not.toHaveBeenCalled();
  });
});

describe('NftMintChecker: completion delay after verification', () => {
  it('leaves no timer behind and does not lose the completion when unmounted during the delay', async () => {
    api.voucher = pendingVoucher({ status: 'MINTED', txHash: TX_HASH });
    server.use(
      http.post(`${SDK}/courses/:courseId/steps/:stepId/verify`, () =>
        HttpResponse.json({ passed: true })
      )
    );
    const onVerificationSuccess = vi.fn();
    const { unmount } = renderChecker({ onVerificationSuccess });

    fireEvent.click(await screen.findByRole('button', { name: 'Verify & Complete' }));
    expect(await screen.findByText('Verification passed!')).toBeInTheDocument();
    expect(onVerificationSuccess).not.toHaveBeenCalled();

    // The user leaves the step before the 500 ms delay has elapsed
    unmount();

    expect(onVerificationSuccess).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(onVerificationSuccess).toHaveBeenCalledTimes(1);
  });
});

describe('NftMintChecker: submitted transaction kept across reloads', () => {
  it('stores the hash and expiry before the transaction is sent, and forgets them once the mint is recorded', async () => {
    let storedAtSend: string | null = null;
    mocks.rpc.sendTransaction.mockReset().mockImplementation(() => {
      storedAtSend = sessionStorage.getItem(pendingKey());
      return Promise.resolve({ status: 'PENDING', hash: TX_HASH });
    });
    renderChecker();
    await clickMint();

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    const stored = JSON.parse(storedAtSend!) as { hash: string; expiresAtSec: number };
    expect(stored.hash).toBe(TX_HASH);
    expect(stored.expiresAtSec).toBeGreaterThan(Date.now() / 1000);
    expect(stored.expiresAtSec).toBeLessThanOrEqual(Date.now() / 1000 + 181);
    expect(sessionStorage.getItem(pendingKey())).toBeNull();
  });

  it('keeps nothing when nothing was sent (simulation failure, rejected submission)', async () => {
    mocks.rpc.sendTransaction.mockResolvedValue({ status: 'ERROR', hash: TX_HASH });
    renderChecker();
    await clickMint();

    await screen.findByText('Transaction failed. Please try again.');
    expect(sessionStorage.getItem(pendingKey())).toBeNull();
  });

  it('resumes a stored transaction at mount and records it once confirmed, without a new mint', async () => {
    storePendingMint();
    mockTxStatuses(['NOT_FOUND', 'SUCCESS']);
    renderChecker();

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(mocks.rpc.getTransaction).toHaveBeenCalledWith(TX_HASH);
    expect(api.nftVerifyBodies).toEqual([{ txHash: TX_HASH }]);
    expect(mocks.wallet.current.signTransaction).not.toHaveBeenCalled();
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(pendingKey())).toBeNull();
    expect(screen.getByRole('button', { name: 'Verify & Complete' })).toBeEnabled();
  });

  it('does not offer a new mint while a stored transaction is still being confirmed', async () => {
    storePendingMint();
    let confirmed = false;
    mocks.rpc.getTransaction
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve({ status: confirmed ? 'SUCCESS' : 'NOT_FOUND', txHash: TX_HASH })
      );
    renderChecker();

    expect(await screen.findByRole('button', { name: 'Confirming...' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Mint NFT' })).not.toBeInTheDocument();

    confirmed = true;
    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it('follows the same transaction when the step is left and opened again during "Confirming..."', async () => {
    let confirmed = false;
    mocks.rpc.getTransaction
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve({ status: confirmed ? 'SUCCESS' : 'NOT_FOUND', txHash: TX_HASH })
      );

    const first = renderChecker();
    await clickMint();
    await screen.findByRole('button', { name: 'Confirming...' });

    // The user goes to another step and comes back: a new instance is mounted
    first.unmount();
    renderChecker();

    expect(await screen.findByRole('button', { name: 'Confirming...' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Mint NFT' })).not.toBeInTheDocument();

    confirmed = true;
    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    // One signature and one submission in total
    expect(mocks.wallet.current.signTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(new Set(api.nftVerifyBodies.map((body) => body.txHash))).toEqual(new Set([TX_HASH]));
    expect(sessionStorage.getItem(pendingKey())).toBeNull();
  });

  it('forgets a stored transaction that FAILED and offers the mint again', async () => {
    storePendingMint();
    mockTxStatuses(['FAILED']);
    renderChecker();

    expect(
      await screen.findByText('The mint transaction failed on-chain. Please try again.')
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Mint NFT' })).toBeEnabled();
    expect(api.nftVerifyBodies).toEqual([]);
    expect(sessionStorage.getItem(pendingKey())).toBeNull();
  });

  it('forgets a stored transaction that expired and offers the mint again', async () => {
    const expiresAtSec = storePendingMint(-600);
    mockTxStatuses(['NOT_FOUND'], expiresAtSec + 300);
    renderChecker();

    // Not offered until the stored transaction has been checked
    expect(await screen.findByRole('button', { name: 'Mint NFT' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mint NFT' })).toBeEnabled());
    expect(mocks.rpc.getTransaction).toHaveBeenCalledWith(TX_HASH);
    expect(api.nftVerifyBodies).toEqual([]);
    expect(sessionStorage.getItem(pendingKey())).toBeNull();
    // After a reload the RPC may simply have forgotten an old transaction:
    // the SDK does not claim that nothing was minted
    expect(screen.queryByText(/Nothing was minted/)).not.toBeInTheDocument();
  });

  it('offers "Check status" when the status of a stored transaction cannot be read', async () => {
    storePendingMint(-600);
    mockTxStatuses([rateLimited()]);
    renderChecker();

    expect(
      await screen.findByText(/The transaction has not been confirmed yet/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mint NFT' })).toBeDisabled();
    expect(api.nftVerifyBodies).toEqual([]);
    // Still remembered for the next visit
    expect(sessionStorage.getItem(pendingKey())).not.toBeNull();

    mockTxStatuses(['SUCCESS']);
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(sessionStorage.getItem(pendingKey())).toBeNull();
  });

  it('ignores the transaction stored for another wallet', async () => {
    storePendingMint(180, 'GOTHERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOTHER');
    renderChecker();

    expect(await screen.findByRole('button', { name: 'Mint NFT' })).toBeEnabled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.rpc.getTransaction).not.toHaveBeenCalled();
  });

  it('forgets a stored transaction once the voucher is already recorded as MINTED', async () => {
    storePendingMint();
    api.voucher = pendingVoucher({ status: 'MINTED', txHash: TX_HASH });
    renderChecker();

    expect(await screen.findByText('NFT already minted!')).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem(pendingKey())).toBeNull());
    expect(mocks.rpc.getTransaction).not.toHaveBeenCalled();
    expect(api.nftVerifyBodies).toEqual([]);
  });

  it('resumes once the wallet is connected again after a reload', async () => {
    storePendingMint();
    // After a reload the wallet is not connected yet
    const connected = mocks.wallet.current;
    mocks.wallet.current = { ...connected, stellarAddress: null, isConnected: false };
    const view = renderChecker();
    await screen.findByRole('button', { name: 'Mint NFT' });
    expect(mocks.rpc.getTransaction).not.toHaveBeenCalled();

    mocks.wallet.current = connected;
    view.rerender(
      <NftMintChecker
        apiClient={makeClient()}
        courseId={COURSE_ID}
        stepId={STEP_ID}
        checker={makeChecker()}
        isCompleted={false}
        linkedWalletAddress={USER_ADDRESS}
        onWalletLinked={() => {}}
        onVerificationSuccess={() => {}}
      />
    );

    expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it('mints normally when sessionStorage is unavailable', async () => {
    const denied = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(denied);
    try {
      renderChecker();
      await clickMint();

      expect(await screen.findByText('NFT minted successfully!')).toBeInTheDocument();
      expect(setItem).toHaveBeenCalled();
      expect(document.querySelector('.venalabs-error-banner')).not.toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
      removeItem.mockRestore();
    }
  });
});

describe('NftMintChecker: voucher loading', () => {
  it('does not apply the voucher of a previous step to the current one', async () => {
    let releaseSlowVoucher: () => void = () => {};
    const slowVoucherGate = new Promise<void>((resolve) => {
      releaseSlowVoucher = resolve;
    });
    server.use(
      http.get(`${SDK}/courses/:courseId/steps/:stepId/nft-voucher`, async ({ params }) => {
        if (params.stepId === 'step-a') {
          await slowVoucherGate;
          return HttpResponse.json(pendingVoucher({ status: 'MINTED', txHash: TX_HASH }));
        }
        return HttpResponse.json(pendingVoucher());
      })
    );

    const props = {
      apiClient: makeClient(),
      courseId: COURSE_ID,
      checker: makeChecker(),
      isCompleted: false,
      linkedWalletAddress: USER_ADDRESS,
      onWalletLinked: () => {},
      onVerificationSuccess: () => {},
    };

    const { rerender } = render(<NftMintChecker {...props} stepId="step-a" />);
    rerender(<NftMintChecker {...props} stepId="step-b" />);

    // Step B has a pending voucher: the mint button is offered
    await screen.findByRole('button', { name: 'Mint NFT' });

    // The slow answer for step A arrives afterwards and must be ignored
    releaseSlowVoucher();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByText('NFT already minted!')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mint NFT' })).toBeInTheDocument();
  });
});

describe('NftMintChecker: network', () => {
  const PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
  const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

  it('signs with the passphrase of the checker network', async () => {
    api.voucher = pendingVoucher({ network: 'STELLAR_PUBLIC' });
    mocks.wallet.current.network = 'PUBLIC';
    renderChecker({}, 'STELLAR_PUBLIC');
    await clickMint();

    await screen.findByText('NFT minted successfully!');
    expect(mocks.wallet.current.signTransaction).toHaveBeenCalledWith(
      'assembled-xdr',
      PUBLIC_PASSPHRASE
    );
    expect(mocks.signedWith).toEqual([PUBLIC_PASSPHRASE]);
  });

  it('uses the stellarNetwork prop when the checker has no network (default: testnet)', async () => {
    mocks.wallet.current.network = 'TESTNET';
    renderChecker({
      checker: { ...makeChecker(), nftMintConfig: undefined },
    });
    await clickMint();

    await screen.findByText('NFT minted successfully!');
    expect(mocks.serverCtor).toHaveBeenCalledWith('https://soroban-testnet.stellar.org', {
      allowHttp: false,
    });
    expect(mocks.signedWith).toEqual([TESTNET_PASSPHRASE]);
  });

  it('does not sign when the wallet is set to another network', async () => {
    mocks.wallet.current.getWalletNetwork = vi
      .fn()
      .mockResolvedValue({ network: 'PUBLIC', networkPassphrase: PUBLIC_PASSPHRASE });
    renderChecker();
    await clickMint();

    expect(
      await screen.findByText(
        'Your wallet is set to another network (PUBLIC). Switch it to STELLAR_TESTNET, then try again.'
      )
    ).toBeInTheDocument();
    expect(mocks.wallet.current.signTransaction).not.toHaveBeenCalled();
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it('shows an explicit error and no mint button for an unknown network', async () => {
    renderChecker({}, 'STELLAR_FUTURENET');

    expect(
      await screen.findByText(
        /network \(STELLAR_FUTURENET\) that is not supported in this SDK version/
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mint NFT' })).not.toBeInTheDocument();
    expect(api.voucherCalls).toBe(0);
  });
});

describe('NftMintChecker: voucher errors', () => {
  const voucherError = (status: number, body: Record<string, unknown>) =>
    server.use(
      http.get(`${SDK}/courses/:courseId/steps/:stepId/nft-voucher`, () =>
        HttpResponse.json(body, { status })
      )
    );

  it('invites the user to link a wallet on 400 NO_LINKED_WALLETS', async () => {
    voucherError(400, { status: 400, error: 'Bad Request', message: 'NO_LINKED_WALLETS' });
    renderChecker();
    await clickMint();

    expect(await screen.findByText('Please link your wallet first')).toBeInTheDocument();
    expect(mocks.wallet.current.signTransaction).not.toHaveBeenCalled();
  });

  it('explains 400 PREREQUISITES_NOT_COMPLETED as soon as the step is displayed', async () => {
    voucherError(400, {
      status: 400,
      error: 'Bad Request',
      message: 'PREREQUISITES_NOT_COMPLETED',
    });
    renderChecker();

    expect(
      await screen.findByText('Complete the previous courses of the map before minting this NFT.')
    ).toBeInTheDocument();
  });

  it('shows the generic voucher message for any other error', async () => {
    voucherError(404, { message: 'Checker not found' });
    renderChecker();
    await clickMint();

    expect(await screen.findByText('Failed to get voucher. Please try again.')).toBeInTheDocument();
  });
});
