import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import {
  StellarWalletProvider,
  useStellarWallet,
  type StellarNetwork,
  type StellarWalletContextValue,
} from '../StellarWalletProvider';
import { useWalletStore } from '../../store';

const ADDRESS = 'GUSERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUSER';

/** Callbacks the provider passed to the wallet selection modal */
interface ModalCallbacks {
  onWalletSelected: (option: { id: string }) => void;
  onClosed?: (error: Error) => void;
}

function createFakeKit() {
  const modal: { callbacks: ModalCallbacks | null } = { callbacks: null };
  const kit = {
    // Like the real kit (v1), openModal resolves as soon as the modal is shown
    openModal: vi.fn((callbacks: ModalCallbacks) => {
      modal.callbacks = callbacks;
      return Promise.resolve();
    }),
    setWallet: vi.fn(),
    getAddress: vi.fn(() => Promise.resolve({ address: ADDRESS })),
    getNetwork: vi.fn(() =>
      Promise.resolve({
        network: 'TESTNET',
        networkPassphrase: 'Test SDF Network ; September 2015',
      })
    ),
    disconnect: vi.fn(() => Promise.resolve()),
    signMessage: vi.fn(),
    signTransaction: vi.fn(),
  };
  return { kit, modal };
}

type FakeKit = ReturnType<typeof createFakeKit>['kit'];

async function renderProvider(kit: FakeKit, network?: StellarNetwork) {
  const ref: { current: StellarWalletContextValue | null } = { current: null };
  function Probe() {
    ref.current = useStellarWallet();
    return null;
  }

  render(
    <StellarWalletProvider network={network} externalKit={kit as unknown as StellarWalletsKit}>
      <Probe />
    </StellarWalletProvider>
  );
  await waitFor(() => expect(ref.current?.isInitialized).toBe(true));

  return () => ref.current!;
}

beforeEach(() => {
  useWalletStore.getState().reset();
});

describe('StellarWalletProvider: network', () => {
  it('exposes TESTNET by default', async () => {
    const wallet = await renderProvider(createFakeKit().kit);

    expect(wallet().network).toBe('TESTNET');
  });

  it('exposes the configured network', async () => {
    const wallet = await renderProvider(createFakeKit().kit, 'PUBLIC');

    expect(wallet().network).toBe('PUBLIC');
  });

  it('reports the network selected in the wallet', async () => {
    const { kit } = createFakeKit();
    const wallet = await renderProvider(kit);

    await expect(wallet().getWalletNetwork()).resolves.toEqual({
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });

  it('returns null when the wallet cannot report its network', async () => {
    const { kit } = createFakeKit();
    kit.getNetwork.mockRejectedValue(new Error('not supported by this wallet'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wallet = await renderProvider(kit);

    await expect(wallet().getWalletNetwork()).resolves.toBeNull();
    warn.mockRestore();
  });
});
