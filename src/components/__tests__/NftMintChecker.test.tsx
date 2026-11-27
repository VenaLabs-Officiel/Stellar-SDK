import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

// Polling delays are skipped so the tests do not wait on real timers
vi.mock('../../utils/sleep', () => ({ sleep: () => Promise.resolve() }));

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
};

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
    return new HttpResponse(null, { status: 200 });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

beforeEach(() => {
  api.voucherCalls = 0;
  api.nftVerifyBodies = [];
  api.voucher = pendingVoucher();

  mocks.serverCtor.mockClear();
  mocks.txTimeouts.length = 0;
  mocks.signedWith.length = 0;
  mocks.rpc.getAccount.mockReset().mockResolvedValue({});
  mocks.rpc.simulateTransaction.mockReset().mockResolvedValue({ result: {} });
  mocks.rpc.sendTransaction.mockReset().mockResolvedValue({ status: 'PENDING', hash: TX_HASH });
  mocks.rpc.getTransaction.mockReset().mockResolvedValue({ status: 'SUCCESS', txHash: TX_HASH });

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

    await waitFor(() => expect(mocks.serverCtor).toHaveBeenCalledTimes(1));
    expect(mocks.serverCtor).toHaveBeenCalledWith('https://soroban-testnet.stellar.org', {
      allowHttp: false,
    });
  });

  it('uses mainnet.sorobanrpc.com by default on mainnet', async () => {
    api.voucher = pendingVoucher({ network: 'STELLAR_PUBLIC' });
    mocks.wallet.current.network = 'PUBLIC';
    renderChecker({}, 'STELLAR_PUBLIC');
    await clickMint();

    await waitFor(() => expect(mocks.serverCtor).toHaveBeenCalledTimes(1));
    expect(mocks.serverCtor).toHaveBeenCalledWith('https://mainnet.sorobanrpc.com', {
      allowHttp: false,
    });
  });

  it('uses the sorobanRpcUrl override, allowing http:// for local development', async () => {
    renderChecker({ sorobanRpcUrl: 'http://localhost:8000/soroban/rpc' });
    await clickMint();

    await waitFor(() => expect(mocks.serverCtor).toHaveBeenCalledTimes(1));
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

    await waitFor(() => expect(mocks.serverCtor).toHaveBeenCalledTimes(1));
    expect(mocks.serverCtor).toHaveBeenCalledWith('https://rpc.partner.example/soroban', {
      allowHttp: false,
    });
  });
});
