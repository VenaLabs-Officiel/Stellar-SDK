import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
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

describe('StellarWalletProvider: connect', () => {
  const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

  it('waits for the wallet selection before reading the address', async () => {
    const { kit, modal } = createFakeKit();
    const wallet = await renderProvider(kit);

    let settled = false;
    let connecting!: Promise<string | null>;
    act(() => {
      connecting = wallet().connect();
      void connecting.then(() => {
        settled = true;
      });
    });
    await flush();

    // The modal is displayed, nothing has been selected yet
    expect(kit.openModal).toHaveBeenCalledTimes(1);
    expect(kit.getAddress).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    expect(wallet().isConnecting).toBe(true);
    expect(wallet().isConnected).toBe(false);

    // The user picks a wallet
    await act(async () => {
      modal.callbacks!.onWalletSelected({ id: 'freighter' });
      await connecting;
    });

    await expect(connecting).resolves.toBe(ADDRESS);
    expect(kit.setWallet).toHaveBeenCalledWith('freighter');
    expect(wallet().stellarAddress).toBe(ADDRESS);
    expect(wallet().isConnected).toBe(true);
    expect(wallet().isConnecting).toBe(false);
    expect(useWalletStore.getState().walletId).toBe('freighter');
  });

  it('resolves without an error when the user closes the modal', async () => {
    const { kit, modal } = createFakeKit();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wallet = await renderProvider(kit);

    let connecting!: Promise<string | null>;
    act(() => {
      connecting = wallet().connect();
    });
    await flush();

    await act(async () => {
      modal.callbacks!.onClosed!(new Error('Modal closed'));
      await connecting;
    });

    await expect(connecting).resolves.toBeNull();
    expect(kit.getAddress).not.toHaveBeenCalled();
    expect(wallet().isConnecting).toBe(false);
    expect(wallet().isConnected).toBe(false);
    // Closing the modal is not a failure: nothing to display, nothing logged as an error
    expect(useWalletStore.getState().connectionError).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('can be opened again after the modal was closed', async () => {
    const { kit, modal } = createFakeKit();
    const wallet = await renderProvider(kit);

    let first!: Promise<string | null>;
    act(() => {
      first = wallet().connect();
    });
    await flush();
    await act(async () => {
      modal.callbacks!.onClosed!(new Error('Modal closed'));
      await first;
    });

    let second!: Promise<string | null>;
    act(() => {
      second = wallet().connect();
    });
    await flush();
    await act(async () => {
      modal.callbacks!.onWalletSelected({ id: 'freighter' });
      await second;
    });

    await expect(second).resolves.toBe(ADDRESS);
    expect(kit.openModal).toHaveBeenCalledTimes(2);
  });

  it('does not open a second modal while a connection is in progress', async () => {
    const { kit, modal } = createFakeKit();
    const wallet = await renderProvider(kit);

    let first!: Promise<string | null>;
    let second!: Promise<string | null>;
    act(() => {
      first = wallet().connect();
      second = wallet().connect();
    });
    await flush();

    expect(kit.openModal).toHaveBeenCalledTimes(1);

    await act(async () => {
      modal.callbacks!.onWalletSelected({ id: 'freighter' });
      await Promise.all([first, second]);
    });

    await expect(first).resolves.toBe(ADDRESS);
    await expect(second).resolves.toBe(ADDRESS);
  });

  it('reports an error when the wallet refuses to share its address', async () => {
    const { kit, modal } = createFakeKit();
    kit.getAddress.mockRejectedValue(new Error('User declined access'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wallet = await renderProvider(kit);

    let connecting!: Promise<string | null>;
    act(() => {
      connecting = wallet().connect();
    });
    await flush();
    await act(async () => {
      modal.callbacks!.onWalletSelected({ id: 'freighter' });
      await connecting;
    });

    await expect(connecting).resolves.toBeNull();
    expect(useWalletStore.getState().connectionError).toBe('User declined access');
    expect(wallet().isConnecting).toBe(false);
    errorSpy.mockRestore();
  });

  it('reports an error when the modal cannot be opened', async () => {
    const { kit } = createFakeKit();
    kit.openModal.mockRejectedValue(new Error('Stellar Wallets Kit modal is already open'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wallet = await renderProvider(kit);

    let connecting!: Promise<string | null>;
    await act(async () => {
      connecting = wallet().connect();
      await connecting;
    });

    await expect(connecting).resolves.toBeNull();
    expect(useWalletStore.getState().connectionError).toBe(
      'Stellar Wallets Kit modal is already open'
    );
    expect(wallet().isConnecting).toBe(false);
    errorSpy.mockRestore();
  });
});

describe('StellarWalletProvider: unmount', () => {
  function renderWithUnmount(kit: FakeKit) {
    const ref: { current: StellarWalletContextValue | null } = { current: null };
    function Probe() {
      ref.current = useStellarWallet();
      return null;
    }
    const { unmount } = render(
      <StellarWalletProvider externalKit={kit as unknown as StellarWalletsKit}>
        <Probe />
      </StellarWalletProvider>
    );
    return { wallet: () => ref.current!, unmount };
  }

  it('releases a pending connect() when the provider unmounts while the modal is open', async () => {
    const { kit, modal } = createFakeKit();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wallet, unmount } = renderWithUnmount(kit);
    await waitFor(() => expect(wallet().isInitialized).toBe(true));

    let connecting!: Promise<string | null>;
    act(() => {
      connecting = wallet().connect();
    });
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
    expect(useWalletStore.getState().isConnecting).toBe(true);

    // The host removes the SDK while the wallet modal is still open
    unmount();

    const outcome = await Promise.race([
      connecting,
      new Promise<string>((resolve) => setTimeout(() => resolve('still pending'), 200)),
    ]);
    expect(outcome).toBeNull();
    // The shared store is not left on "Connecting..." for the next mount
    expect(useWalletStore.getState().isConnecting).toBe(false);
    expect(useWalletStore.getState().connectionError).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();

    // A late answer of the modal is ignored
    modal.callbacks!.onWalletSelected({ id: 'freighter' });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(kit.setWallet).not.toHaveBeenCalled();
    expect(kit.getAddress).not.toHaveBeenCalled();
    expect(useWalletStore.getState().stellarAddress).toBeNull();
    errorSpy.mockRestore();
  });

  it('does not leave the network timeout timer behind once the wallet has answered', async () => {
    const { kit } = createFakeKit();
    const { wallet } = renderWithUnmount(kit);
    await waitFor(() => expect(wallet().isInitialized).toBe(true));

    vi.useFakeTimers();
    try {
      await expect(wallet().getWalletNetwork()).resolves.toMatchObject({ network: 'TESTNET' });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still gives up after 3 s when the wallet never reports its network', async () => {
    const { kit } = createFakeKit();
    kit.getNetwork.mockImplementation(() => new Promise(() => {}));
    const { wallet } = renderWithUnmount(kit);
    await waitFor(() => expect(wallet().isInitialized).toBe(true));

    vi.useFakeTimers();
    try {
      const pending = wallet().getWalletNetwork();
      await vi.advanceTimersByTimeAsync(3000);
      await expect(pending).resolves.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('StellarWalletProvider: disconnect', () => {
  it('resets the wallet state and handles a rejected kit.disconnect()', async () => {
    const { kit, modal } = createFakeKit();
    kit.disconnect.mockRejectedValue(new Error('disconnect failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const wallet = await renderProvider(kit);
      let connecting!: Promise<string | null>;
      act(() => {
        connecting = wallet().connect();
      });
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
      await act(async () => {
        modal.callbacks!.onWalletSelected({ id: 'freighter' });
        await connecting;
      });
      expect(wallet().isConnected).toBe(true);

      act(() => {
        wallet().disconnect();
      });
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

      expect(kit.disconnect).toHaveBeenCalledTimes(1);
      expect(wallet().isConnected).toBe(false);
      expect(wallet().stellarAddress).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        '[StellarWalletProvider] Disconnect error:',
        expect.any(Error)
      );
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      warnSpy.mockRestore();
    }
  });
});
