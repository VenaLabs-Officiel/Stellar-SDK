import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { CheckerVerification } from '../ui/CheckerVerification';
import { VenalabsStellarSDK } from '../VenalabsStellarSDK';
import { VenalabsApiClient } from '../../api';
import type { VenalabsChecker } from '../../types';

// ------------------------------------------------------------------
// Wallet context mock (no wallet kit is loaded in these tests)
// ------------------------------------------------------------------

const USER_ADDRESS = 'GUSERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUSER';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

const mocks = vi.hoisted(() => ({
  wallet: { current: {} as Record<string, unknown> },
}));

vi.mock('../../wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../wallet')>();
  return {
    ...actual,
    useStellarWallet: () => mocks.wallet.current,
    StellarWalletProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

// ------------------------------------------------------------------
// API (MSW)
// ------------------------------------------------------------------

const BASE_URL = 'https://api.test.com';
const SDK = `${BASE_URL}/api/v1/sdk`;

const api = { linkBodies: [] as Array<Record<string, unknown>> };

const server = setupServer(
  http.get(`${SDK}/wallet/nonce`, () => HttpResponse.json({ nonce: 'nonce-1' })),
  http.post(`${SDK}/wallet/stellar/link`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    api.linkBodies.push(body);
    return HttpResponse.json({
      success: true,
      walletAddresses: { [String(body.network)]: String(body.walletAddress) },
    });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

beforeEach(() => {
  api.linkBodies = [];
  mocks.wallet.current = {
    kit: null,
    isInitialized: true,
    network: 'TESTNET',
    stellarAddress: USER_ADDRESS,
    isConnected: true,
    isConnecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signMessage: vi.fn().mockResolvedValue('signature'),
    signTransaction: vi.fn(),
    getWalletNetwork: vi.fn().mockResolvedValue(null),
  };
});

function makeChecker(overrides: Partial<VenalabsChecker> = {}): VenalabsChecker {
  return {
    id: 'checker-1',
    organizationId: 'org-1',
    name: { en: 'Wallet linked' },
    type: 'LINKED',
    linkedConfig: { network: 'STELLAR_TESTNET' },
    status: 'ACTIVE',
    createdOn: '',
    ...overrides,
  };
}

function renderChecker(checker: VenalabsChecker, linkedWalletAddress?: string) {
  const onWalletLinked = vi.fn();
  render(
    <CheckerVerification
      apiClient={
        new VenalabsApiClient({
          apiKey: 'test-key',
          getAccessToken: () => Promise.resolve('test-token'),
          baseUrl: BASE_URL,
        })
      }
      courseId="course-1"
      stepId="step-1"
      checker={checker}
      isCompleted={false}
      linkedWalletAddress={linkedWalletAddress}
      onWalletLinked={onWalletLinked}
      onVerificationSuccess={vi.fn()}
    />
  );
  return { onWalletLinked };
}

const networkLabel = () => document.querySelector('.venalabs-wallet-linker__network')?.textContent;

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('Checker network resolution', () => {
  it('uses the network of the checker', () => {
    mocks.wallet.current.network = 'TESTNET';
    renderChecker(makeChecker({ linkedConfig: { network: 'STELLAR_PUBLIC' } }));

    expect(networkLabel()).toBe('STELLAR_PUBLIC');
  });

  it('falls back to the stellarNetwork prop (TESTNET) when the checker has no network', () => {
    mocks.wallet.current.network = 'TESTNET';
    renderChecker(makeChecker({ linkedConfig: undefined }));

    expect(networkLabel()).toBe('STELLAR_TESTNET');
  });

  it('falls back to the stellarNetwork prop (PUBLIC) when the checker has no network', () => {
    mocks.wallet.current.network = 'PUBLIC';
    renderChecker(makeChecker({ linkedConfig: undefined }));

    expect(networkLabel()).toBe('STELLAR_PUBLIC');
  });

  it('applies the same fallback to NFT mint checkers', async () => {
    server.use(
      http.get(`${SDK}/courses/:courseId/steps/:stepId/nft-voucher`, () =>
        HttpResponse.json({ message: 'NO_LINKED_WALLETS' }, { status: 400 })
      )
    );
    mocks.wallet.current.network = 'TESTNET';
    renderChecker(
      makeChecker({ type: 'NFT_MINT', linkedConfig: undefined, nftMintConfig: undefined })
    );

    await screen.findByRole('button', { name: 'Mint NFT' });
    expect(networkLabel()).toBe('STELLAR_TESTNET');
  });

  it('shows an explicit error for an unknown network instead of falling back', () => {
    renderChecker(makeChecker({ linkedConfig: { network: 'STELLAR_FUTURENET' } }));

    expect(
      screen.getByText(/network \(STELLAR_FUTURENET\) that is not supported in this SDK version/)
    ).toBeInTheDocument();
    // No wallet action is offered on a network the SDK cannot handle
    expect(document.querySelector('.venalabs-wallet-linker')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify & Complete' })).not.toBeInTheDocument();
  });
});

describe('Wallet linking: signing network', () => {
  it('signs with the passphrase of the checker network and links on that network', async () => {
    mocks.wallet.current.network = 'PUBLIC';
    const { onWalletLinked } = renderChecker(
      makeChecker({ linkedConfig: { network: 'STELLAR_PUBLIC' } })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Link Wallet' }));

    await waitFor(() =>
      expect(onWalletLinked).toHaveBeenCalledWith(USER_ADDRESS, 'STELLAR_PUBLIC')
    );
    expect(mocks.wallet.current.signMessage).toHaveBeenCalledWith(
      expect.stringContaining('Nonce: nonce-1'),
      PUBLIC_PASSPHRASE
    );
    expect(api.linkBodies).toEqual([
      { walletAddress: USER_ADDRESS, signature: 'signature', network: 'STELLAR_PUBLIC' },
    ]);
  });

  it('links even when the wallet is set to another network, with a warning that does not block', async () => {
    // Linking only signs a message: the network selected in the wallet does not matter
    mocks.wallet.current.getWalletNetwork = vi
      .fn()
      .mockResolvedValue({ network: 'PUBLIC', networkPassphrase: PUBLIC_PASSPHRASE });
    const { onWalletLinked } = renderChecker(makeChecker());

    fireEvent.click(screen.getByRole('button', { name: 'Link Wallet' }));

    await waitFor(() =>
      expect(onWalletLinked).toHaveBeenCalledWith(USER_ADDRESS, 'STELLAR_TESTNET')
    );
    expect(mocks.wallet.current.signMessage).toHaveBeenCalledWith(
      expect.stringContaining('Nonce: nonce-1'),
      TESTNET_PASSPHRASE
    );
    expect(api.linkBodies).toEqual([
      { walletAddress: USER_ADDRESS, signature: 'signature', network: 'STELLAR_TESTNET' },
    ]);

    const warning = screen.getByText(
      'Your wallet is set to another network (PUBLIC). You can link it, but switch it to STELLAR_TESTNET before signing a transaction.'
    );
    expect(warning).toHaveClass('venalabs-wallet-linker__network-warning');
    expect(document.querySelector('.venalabs-wallet-linker__error')).not.toBeInTheDocument();
  });

  it('shows no network warning when the wallet reports the expected network', async () => {
    mocks.wallet.current.getWalletNetwork = vi
      .fn()
      .mockResolvedValue({ network: 'TESTNET', networkPassphrase: TESTNET_PASSPHRASE });
    const { onWalletLinked } = renderChecker(makeChecker());

    fireEvent.click(screen.getByRole('button', { name: 'Link Wallet' }));

    await waitFor(() => expect(onWalletLinked).toHaveBeenCalled());
    expect(
      document.querySelector('.venalabs-wallet-linker__network-warning')
    ).not.toBeInTheDocument();
  });

  it('still links when the wallet network cannot be read at all', async () => {
    mocks.wallet.current.getWalletNetwork = vi.fn().mockRejectedValue(new Error('unsupported'));
    const { onWalletLinked } = renderChecker(makeChecker());

    fireEvent.click(screen.getByRole('button', { name: 'Link Wallet' }));

    await waitFor(() => expect(onWalletLinked).toHaveBeenCalled());
    expect(document.querySelector('.venalabs-wallet-linker__error')).not.toBeInTheDocument();
  });

  it('signs when the wallet reports the expected network', async () => {
    mocks.wallet.current.getWalletNetwork = vi
      .fn()
      .mockResolvedValue({ network: 'TESTNET', networkPassphrase: TESTNET_PASSPHRASE });
    const { onWalletLinked } = renderChecker(makeChecker());

    fireEvent.click(screen.getByRole('button', { name: 'Link Wallet' }));

    await waitFor(() => expect(onWalletLinked).toHaveBeenCalled());
    expect(mocks.wallet.current.signMessage).toHaveBeenCalledWith(
      expect.any(String),
      TESTNET_PASSPHRASE
    );
  });

  it('does not block linking when the wallet cannot report its network', async () => {
    mocks.wallet.current.getWalletNetwork = vi.fn().mockResolvedValue(null);
    const { onWalletLinked } = renderChecker(makeChecker());

    fireEvent.click(screen.getByRole('button', { name: 'Link Wallet' }));

    await waitFor(() => expect(onWalletLinked).toHaveBeenCalled());
  });
});

describe('VenalabsStellarSDK: stellarNetwork prop', () => {
  it('shows an explicit error for an unknown value instead of using testnet', () => {
    render(
      <VenalabsStellarSDK
        apiKey="test-key"
        getAccessToken={() => Promise.resolve('test-token')}
        baseUrl={BASE_URL}
        stellarNetwork={'MAINNET' as never}
      />
    );

    expect(
      screen.getByText('Invalid stellarNetwork "MAINNET". Expected "TESTNET" or "PUBLIC".')
    ).toBeInTheDocument();
  });
});
