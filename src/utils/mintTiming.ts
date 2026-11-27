/**
 * Timing of the NFT mint transaction, kept in its own module so tests can shorten it.
 */
export const MINT_TIMING = {
  /** Validity of the mint transaction once built (seconds) */
  txTimeoutSeconds: 180,
  /** Time allowed after the transaction expires to read its final status (ms) */
  confirmationGraceMs: 15000,
  /** Time allowed for one Soroban RPC call before it is treated as a network error (ms) */
  rpcTimeoutMs: 15000,
};
