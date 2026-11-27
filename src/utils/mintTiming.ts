/**
 * Timing of the NFT mint transaction, kept in its own module so tests can shorten it.
 */
export const MINT_TIMING = {
  /** Validity of the mint transaction once built (seconds) */
  txTimeoutSeconds: 180,
  /** Time allowed after the transaction expires to read its final status (ms) */
  confirmationGraceMs: 15000,
};
