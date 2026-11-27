/**
 * Utility functions for resolving Stellar network-dependent values
 * based on the checker network configuration (STELLAR_TESTNET or STELLAR_PUBLIC).
 */

/** Default Soroban RPC endpoints (both are HTTPS and allow cross-origin requests) */
const DEFAULT_SOROBAN_RPC_URLS = {
  STELLAR_PUBLIC: 'https://mainnet.sorobanrpc.com',
  STELLAR_TESTNET: 'https://soroban-testnet.stellar.org',
} as const;

export function getSorobanRpcUrl(network: string): string {
  return network === 'STELLAR_PUBLIC'
    ? DEFAULT_SOROBAN_RPC_URLS.STELLAR_PUBLIC
    : DEFAULT_SOROBAN_RPC_URLS.STELLAR_TESTNET;
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
 * @throws Error when the override is not an absolute http(s) URL
 */
export function resolveSorobanRpc(network: string, overrideUrl?: string): SorobanRpcEndpoint {
  const override = overrideUrl?.trim();
  if (!override) {
    return { url: getSorobanRpcUrl(network), allowHttp: false };
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

export function getNetworkPassphrase(network: string): string {
  return network === 'STELLAR_PUBLIC'
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015';
}

export function getExplorerUrl(network: string, hash: string): string {
  const segment = network === 'STELLAR_PUBLIC' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${segment}/search?term=${hash}`;
}
