/**
 * Single source of truth for Stellar networks in the SDK.
 *
 * Two notations exist:
 * - the `stellarNetwork` prop and the wallet kit use `TESTNET` / `PUBLIC`;
 * - checkers and the API use `STELLAR_TESTNET` / `STELLAR_PUBLIC`.
 *
 * Every network-dependent value (passphrase, RPC endpoint, explorer URL) is
 * resolved here. An unknown network is an explicit error: nothing silently
 * falls back to testnet or mainnet.
 */

import type { VenalabsChecker } from '../types';

/** Network values accepted by the `stellarNetwork` prop and the wallet provider */
export type StellarNetwork = 'TESTNET' | 'PUBLIC';

/** Network values carried by checkers and by the wallet endpoints of the API */
export type StellarCheckerNetwork = 'STELLAR_TESTNET' | 'STELLAR_PUBLIC';

/** Default of the `stellarNetwork` prop */
export const DEFAULT_STELLAR_NETWORK: StellarNetwork = 'TESTNET';

interface NetworkSettings {
  walletNetwork: StellarNetwork;
  passphrase: string;
  /** Default Soroban RPC endpoint (HTTPS, allows cross-origin requests) */
  sorobanRpcUrl: string;
  explorerSegment: string;
}

const NETWORK_SETTINGS: Record<StellarCheckerNetwork, NetworkSettings> = {
  STELLAR_TESTNET: {
    walletNetwork: 'TESTNET',
    passphrase: 'Test SDF Network ; September 2015',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    explorerSegment: 'testnet',
  },
  STELLAR_PUBLIC: {
    walletNetwork: 'PUBLIC',
    passphrase: 'Public Global Stellar Network ; September 2015',
    sorobanRpcUrl: 'https://mainnet.sorobanrpc.com',
    explorerSegment: 'public',
  },
};

/** Thrown when a network is not one of the Stellar networks handled by the SDK */
export class UnsupportedStellarNetworkError extends Error {
  constructor(public readonly network: string) {
    super(`Unsupported Stellar network "${network}" (expected STELLAR_TESTNET or STELLAR_PUBLIC)`);
    this.name = 'UnsupportedStellarNetworkError';
  }
}

export function isStellarNetwork(value: unknown): value is StellarNetwork {
  return value === 'TESTNET' || value === 'PUBLIC';
}

export function isStellarCheckerNetwork(value: unknown): value is StellarCheckerNetwork {
  return value === 'STELLAR_TESTNET' || value === 'STELLAR_PUBLIC';
}

/** Convert a `stellarNetwork` prop value to the checker notation */
export function toCheckerNetwork(network: StellarNetwork): StellarCheckerNetwork {
  return network === 'PUBLIC' ? 'STELLAR_PUBLIC' : 'STELLAR_TESTNET';
}

/** Convert a checker network to the `stellarNetwork` prop notation */
export function toWalletNetwork(network: StellarCheckerNetwork): StellarNetwork {
  return NETWORK_SETTINGS[network].walletNetwork;
}

function settingsFor(network: string): NetworkSettings {
  if (!isStellarCheckerNetwork(network)) {
    throw new UnsupportedStellarNetworkError(network);
  }
  return NETWORK_SETTINGS[network];
}

/**
 * @throws UnsupportedStellarNetworkError when the network is unknown
 */
export function getSorobanRpcUrl(network: string): string {
  return settingsFor(network).sorobanRpcUrl;
}

/**
 * @throws UnsupportedStellarNetworkError when the network is unknown
 */
export function getNetworkPassphrase(network: string): string {
  return settingsFor(network).passphrase;
}

/**
 * @throws UnsupportedStellarNetworkError when the network is unknown
 */
export function getExplorerUrl(network: string, hash: string): string {
  return `https://stellar.expert/explorer/${settingsFor(network).explorerSegment}/search?term=${hash}`;
}

/** Soroban RPC endpoint with the matching `allowHttp` flag for `rpc.Server` */
export interface SorobanRpcEndpoint {
  url: string;
  /** True only when the URL itself is `http://` (local development) */
  allowHttp: boolean;
}

/**
 * Resolve the Soroban RPC endpoint used for a network.
 *
 * @param network - Checker network (STELLAR_TESTNET or STELLAR_PUBLIC)
 * @param overrideUrl - Optional URL (the `sorobanRpcUrl` prop) replacing the default one
 * @throws UnsupportedStellarNetworkError when the network is unknown
 * @throws Error when the override is not an absolute http(s) URL
 */
export function resolveSorobanRpc(network: string, overrideUrl?: string): SorobanRpcEndpoint {
  const defaultUrl = getSorobanRpcUrl(network);

  const override = overrideUrl?.trim();
  if (!override) {
    return { url: defaultUrl, allowHttp: false };
  }

  let protocol: string;
  try {
    protocol = new URL(override).protocol;
  } catch {
    throw new Error(`Invalid sorobanRpcUrl: "${override}" is not an absolute URL`);
  }
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error(`Invalid sorobanRpcUrl: "${override}" must use https:// (or http:// locally)`);
  }

  return { url: override, allowHttp: protocol === 'http:' };
}

/** Network declared in the configuration of a checker, if any */
export function getCheckerConfigNetwork(checker: VenalabsChecker): string | undefined {
  return (
    checker.linkedConfig?.network ||
    checker.balanceConfig?.network ||
    checker.transactionConfig?.network ||
    checker.nftMintConfig?.network ||
    undefined
  );
}

export type CheckerNetworkResolution =
  | { supported: true; network: StellarCheckerNetwork }
  | { supported: false; network: string };

/**
 * Resolve the network a checker runs on: the network of the checker itself
 * (compared without regard to case or surrounding spaces), otherwise the
 * `stellarNetwork` prop (default: TESTNET). A network the SDK does not handle
 * is reported, never replaced.
 */
export function resolveCheckerNetwork(
  checker: VenalabsChecker,
  fallback: StellarNetwork = DEFAULT_STELLAR_NETWORK
): CheckerNetworkResolution {
  const configured = getCheckerConfigNetwork(checker);
  // Tolerate a different case or stray spaces in the back-office value
  const normalized = typeof configured === 'string' ? configured.trim().toUpperCase() : '';
  if (!configured || normalized === '') {
    return { supported: true, network: toCheckerNetwork(fallback) };
  }
  if (isStellarCheckerNetwork(normalized)) {
    return { supported: true, network: normalized };
  }
  return { supported: false, network: configured };
}

/** Network currently selected in the user's wallet, as reported by the wallet */
export interface WalletNetworkInfo {
  network: string;
  networkPassphrase: string;
}

/**
 * Compare the network selected in the wallet with the one a signature is
 * needed for.
 *
 * @returns the name of the wallet network when it differs from `expected`,
 * or null when it matches or when the wallet cannot report its network
 */
export async function findWalletNetworkMismatch(
  getWalletNetwork: () => Promise<WalletNetworkInfo | null>,
  expected: string
): Promise<string | null> {
  const expectedPassphrase = getNetworkPassphrase(expected);
  const walletNetwork = await getWalletNetwork();
  if (!walletNetwork || walletNetwork.networkPassphrase === expectedPassphrase) {
    return null;
  }
  return walletNetwork.network || walletNetwork.networkPassphrase;
}
