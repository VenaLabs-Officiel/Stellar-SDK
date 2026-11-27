// Wallet exports
export {
  StellarWalletProvider,
  useStellarWallet,
  default as StellarWalletProviderDefault,
} from './StellarWalletProvider';
export type {
  StellarWalletProviderProps,
  StellarWalletContextValue,
  StellarNetwork,
} from './StellarWalletProvider';

// Network reported by the wallet, as returned by getWalletNetwork()
export type { WalletNetworkInfo } from '../utils/stellarNetworkUtils';

// Re-export the kit type for external usage
export type { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
