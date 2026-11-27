/**
 * SDK-wide configuration shared with nested components through React context.
 */

import { createContext, useContext } from 'react';

export interface SdkConfig {
  /** Soroban RPC URL replacing the default endpoint of the checker network */
  sorobanRpcUrl?: string;
}

export const SdkConfigContext = createContext<SdkConfig>({});

/**
 * Read the SDK configuration. Returns an empty configuration when the
 * component is rendered outside of `VenalabsStellarSDK`.
 */
export function useSdkConfig(): SdkConfig {
  return useContext(SdkConfigContext);
}
