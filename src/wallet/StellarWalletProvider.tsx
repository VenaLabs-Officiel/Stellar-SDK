/**
 * Stellar Wallet Provider for venalabs-stellar-sdk
 * Provides wallet connection and signing capabilities via stellar-wallets-kit
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
  useMemo,
} from 'react';
import type { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import { useWalletStore } from '../store';
import {
  DEFAULT_STELLAR_NETWORK,
  type StellarNetwork,
  type WalletNetworkInfo,
} from '../utils/stellarNetworkUtils';

export type { StellarNetwork };

/** Time allowed for the wallet to report its network before the check is skipped */
const WALLET_NETWORK_TIMEOUT_MS = 3000;

/** The user closed the wallet selection modal without choosing a wallet */
class WalletModalClosedError extends Error {
  constructor() {
    super('Wallet selection cancelled');
    this.name = 'WalletModalClosedError';
  }
}

export interface StellarWalletContextValue {
  /** The wallet kit instance */
  kit: StellarWalletsKit | null;
  /** Whether the wallet kit is initialized */
  isInitialized: boolean;
  /** Stellar network the SDK is configured for (the `stellarNetwork` prop) */
  network: StellarNetwork;
  /** The currently connected wallet address */
  stellarAddress: string | null;
  /** Whether wallet is connected */
  isConnected: boolean;
  /** Whether wallet is currently connecting */
  isConnecting: boolean;
  /** Open wallet modal and connect */
  connect: () => Promise<string | null>;
  /** Disconnect the wallet */
  disconnect: () => void;
  /** Sign a message with the connected wallet */
  signMessage: (message: string, networkPassphrase: string) => Promise<string>;
  /** Sign a transaction XDR */
  signTransaction: (xdr: string, networkPassphrase: string) => Promise<string>;
  /**
   * Network currently selected in the user's wallet, or null when the wallet
   * cannot report it
   */
  getWalletNetwork: () => Promise<WalletNetworkInfo | null>;
}

const StellarWalletContext = createContext<StellarWalletContextValue | null>(null);

export interface StellarWalletProviderProps {
  children: ReactNode;
  /** Stellar network to use (default: TESTNET) */
  network?: StellarNetwork;
  /** External wallet kit instance (if provided, skips internal initialization) */
  externalKit?: StellarWalletsKit | null;
}

/**
 * Provider component that initializes and manages Stellar wallet connection
 */
export function StellarWalletProvider({
  children,
  network = DEFAULT_STELLAR_NETWORK,
  externalKit,
}: StellarWalletProviderProps): JSX.Element {
  const [kit, setKit] = useState<StellarWalletsKit | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const {
    stellarAddress,
    setStellarAddress,
    setWalletId,
    isConnecting,
    setIsConnecting,
    setConnectionError,
    reset,
  } = useWalletStore();

  // Initialize wallet kit on mount
  useEffect(() => {
    if (kit) {
      console.debug('[StellarWalletProvider] Wallet kit already initialized');
      return;
    }

    // Use external kit if provided
    if (externalKit) {
      console.debug('[StellarWalletProvider] Using external wallet kit');
      setKit(externalKit);
      setIsInitialized(true);
      return;
    }

    // Otherwise, initialize our own kit via dynamic import
    const initKit = async () => {
      try {
        const { StellarWalletsKit, WalletNetwork, FREIGHTER_ID, FreighterModule } =
          await import('@creit.tech/stellar-wallets-kit');

        const instance = new StellarWalletsKit({
          network: network === 'PUBLIC' ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
          selectedWalletId: FREIGHTER_ID,
          modules: [new FreighterModule()],
        });

        setKit(instance);
        setIsInitialized(true);
      } catch (error) {
        console.error('[StellarWalletProvider] Failed to initialize wallet kit:', error);
        setConnectionError('Failed to initialize wallet');
      }
    };

    void initKit();
  }, [setConnectionError, kit, externalKit]);

  // Connection in progress, shared by concurrent callers so that a single
  // modal is opened
  const connectPromiseRef = useRef<Promise<string | null> | null>(null);

  // Connect wallet
  const connect = useCallback((): Promise<string | null> => {
    if (!kit) {
      setConnectionError('Wallet kit not initialized');
      return Promise.resolve(null);
    }
    if (connectPromiseRef.current) {
      return connectPromiseRef.current;
    }

    // Order matters: the store's setConnectionError also clears isConnecting
    setConnectionError(null);
    setIsConnecting(true);

    // kit.openModal() resolves as soon as the modal is displayed, not when the
    // user has chosen a wallet: wait for one of its two callbacks instead.
    const selection = new Promise<string>((resolve, reject) => {
      let walletSelected = false;
      Promise.resolve(
        kit.openModal({
          onWalletSelected: (option: { id: string }) => {
            walletSelected = true;
            try {
              kit.setWallet(option.id);
              setWalletId(option.id);
            } catch (error) {
              reject(error);
              return;
            }
            kit.getAddress().then(({ address }) => resolve(address), reject);
          },
          onClosed: () => {
            // Ignored once a wallet was chosen: the address request decides
            if (!walletSelected) {
              reject(new WalletModalClosedError());
            }
          },
        })
      ).catch(reject);
    });

    const pending = selection
      .then(
        (address) => {
          setStellarAddress(address);
          return address;
        },
        (error: unknown) => {
          // The user closed the modal: not an error, nothing to display
          if (!(error instanceof WalletModalClosedError)) {
            console.error('[StellarWalletProvider] Connection failed:', error);
            setConnectionError(error instanceof Error ? error.message : 'Connection failed');
          }
          return null;
        }
      )
      .finally(() => {
        connectPromiseRef.current = null;
        setIsConnecting(false);
      });

    connectPromiseRef.current = pending;
    return pending;
  }, [kit, setStellarAddress, setWalletId, setIsConnecting, setConnectionError]);

  // Disconnect wallet
  const disconnect = useCallback(() => {
    if (kit) {
      try {
        Promise.resolve(kit.disconnect()).catch((error: unknown) => {
          console.warn('[StellarWalletProvider] Disconnect error:', error);
        });
      } catch (error) {
        console.warn('[StellarWalletProvider] Disconnect error:', error);
      }
    }
    reset();
  }, [kit, reset]);

  // Sign a message
  const signMessage = useCallback(
    async (message: string, passPhrase: string): Promise<string> => {
      if (!kit || !stellarAddress) {
        throw new Error('Wallet not connected');
      }

      const result = await kit.signMessage(message, {
        address: stellarAddress,
        networkPassphrase: passPhrase,
      });

      return result.signedMessage;
    },
    [kit, stellarAddress]
  );

  // Sign a transaction
  const signTransaction = useCallback(
    async (xdr: string, passPhrase: string): Promise<string> => {
      if (!kit) {
        throw new Error('Wallet not connected');
      }

      const { signedTxXdr } = await kit.signTransaction(xdr, {
        networkPassphrase: passPhrase,
      });
      return signedTxXdr;
    },
    [kit]
  );

  // Ask the wallet which network it is set to
  const getWalletNetwork = useCallback(async (): Promise<WalletNetworkInfo | null> => {
    if (!kit) {
      return null;
    }

    try {
      const reported = await Promise.race([
        kit.getNetwork(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), WALLET_NETWORK_TIMEOUT_MS)),
      ]);
      if (!reported?.networkPassphrase) {
        return null;
      }
      return { network: reported.network, networkPassphrase: reported.networkPassphrase };
    } catch (error) {
      // Not every wallet module can report its network
      console.warn('[StellarWalletProvider] Could not read the wallet network:', error);
      return null;
    }
  }, [kit]);

  const contextValue = useMemo<StellarWalletContextValue>(
    () => ({
      kit,
      isInitialized,
      network,
      stellarAddress,
      isConnected: !!stellarAddress,
      isConnecting,
      connect,
      disconnect,
      signMessage,
      signTransaction,
      getWalletNetwork,
    }),
    [
      kit,
      isInitialized,
      network,
      stellarAddress,
      isConnecting,
      connect,
      disconnect,
      signMessage,
      signTransaction,
      getWalletNetwork,
    ]
  );

  return (
    <StellarWalletContext.Provider value={contextValue}>{children}</StellarWalletContext.Provider>
  );
}

/**
 * Stellar network the SDK is configured for, also usable outside of a
 * StellarWalletProvider (where it is the default network)
 */
export function useConfiguredStellarNetwork(): StellarNetwork {
  return useContext(StellarWalletContext)?.network ?? DEFAULT_STELLAR_NETWORK;
}

/**
 * Hook to access Stellar wallet functionality
 */
export function useStellarWallet(): StellarWalletContextValue {
  const context = useContext(StellarWalletContext);
  if (!context) {
    throw new Error('useStellarWallet must be used within a StellarWalletProvider');
  }
  return context;
}

export default StellarWalletProvider;
