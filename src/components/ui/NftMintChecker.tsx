/**
 * NftMintChecker component for venalabs-stellar-sdk
 * Handles the complete NFT minting flow: voucher → mint → verify
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, AlertCircle, CheckCircle2, ExternalLink, Wallet } from 'lucide-react';
import { useStellarWallet } from '../../wallet';
import { useTranslation } from '../../i18n';
import { GlassButton } from './GlassCard';
import { WalletLinker } from './WalletLinker';
import type { VenalabsApiClient } from '../../api';
import { VenalabsApiError } from '../../api';
import type { VenalabsChecker, VenalabsNftVoucherResponse } from '../../types';
import { getLocalizedText } from '../../types';
import { useSdkConfig } from '../../utils/sdkConfig';
import {
  resolveSorobanRpc,
  resolveCheckerNetwork,
  findWalletNetworkMismatch,
  getNetworkPassphrase,
  getExplorerUrl as getExplorerUrlUtil,
} from '../../utils/stellarNetworkUtils';
import {
  submitTransaction,
  waitForTransaction,
  SorobanSubmitError,
  type SorobanReader,
  type SorobanTxOutcome,
} from '../../utils/sorobanTx';
import { MINT_TIMING } from '../../utils/mintTiming';
import { sleep } from '../../utils/sleep';

// Utility function for class names
function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Attempts made to record a confirmed mint on the backend (nft-verify) */
const RECORD_MINT_ATTEMPTS = 3;
const RECORD_MINT_RETRY_DELAY_MS = 1000;

type MintPhase = 'idle' | 'preparing' | 'signing' | 'confirming';

/** A submitted transaction and the end of its validity (seconds since the epoch) */
interface SubmittedTx {
  hash: string;
  expiresAtSec: number;
}

export interface NftMintCheckerProps {
  /** API client instance */
  apiClient: VenalabsApiClient;
  /** Course ID */
  courseId: string;
  /** Step ID */
  stepId: string;
  /** Checker configuration */
  checker: VenalabsChecker;
  /** Whether the step is already completed */
  isCompleted: boolean;
  /** Currently linked wallet address */
  linkedWalletAddress?: string;
  /** Callback when wallet is linked */
  onWalletLinked: (address: string, network: string) => void;
  /** Callback when verification succeeds */
  onVerificationSuccess: () => void;
  /**
   * Soroban RPC URL replacing the default endpoint of the checker network.
   * Falls back to the `sorobanRpcUrl` prop of `VenalabsStellarSDK`.
   */
  sorobanRpcUrl?: string;
}

/** Whether an error is an API error carrying the given backend error code */
function isServerError(error: unknown, serverCode: string): boolean {
  return error instanceof VenalabsApiError && error.serverCode === serverCode;
}

// Format address for display
function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Component for handling NFT minting flow in courses
 * Flow:
 * 1. User connects and links wallet
 * 2. User clicks Mint -> fetches voucher -> builds, simulates and signs the
 *    transaction -> submits it -> waits for its on-chain confirmation ->
 *    records the mint on the backend
 * 3. User clicks Verify to complete the step
 */
export function NftMintChecker({
  apiClient,
  courseId,
  stepId,
  checker,
  isCompleted,
  linkedWalletAddress,
  onWalletLinked,
  onVerificationSuccess,
  sorobanRpcUrl,
}: NftMintCheckerProps): JSX.Element {
  const { t, locale } = useTranslation();
  const sdkConfig = useSdkConfig();
  const rpcUrlOverride = sorobanRpcUrl ?? sdkConfig.sorobanRpcUrl;
  const {
    stellarAddress,
    isConnected,
    signTransaction,
    getWalletNetwork,
    network: configuredNetwork,
  } = useStellarWallet();

  // Mint states
  const [mintLoading, setMintLoading] = useState(false);
  const [mintPhase, setMintPhase] = useState<MintPhase>('idle');
  const [mintSuccess, setMintSuccess] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  // Submitted transaction whose final status could not be read yet
  const [pendingTx, setPendingTx] = useState<SubmittedTx | null>(null);
  // Transaction confirmed on-chain that the backend has not recorded yet
  const [unrecordedHash, setUnrecordedHash] = useState<string | null>(null);

  // Verify states
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationSuccess, setVerificationSuccess] = useState(false);

  // Voucher state
  const [voucherLoading, setVoucherLoading] = useState(true);
  const [voucherData, setVoucherData] = useState<VenalabsNftVoucherResponse | null>(null);
  // The backend refuses the voucher until the previous courses of the map are completed
  const [prerequisitesMissing, setPrerequisitesMissing] = useState(false);

  // Guards against state updates after unmount or for a step that is no longer shown
  const stepKey = `${courseId}:${stepId}`;
  const stepKeyRef = useRef(stepKey);
  stepKeyRef.current = stepKey;
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Step for which a mint operation is running (prevents a second submission)
  const mintInFlightRef = useRef<string | null>(null);

  // The network comes from the checker, otherwise from the stellarNetwork prop
  const networkResolution = resolveCheckerNetwork(checker, configuredNetwork);
  const checkerNetwork = networkResolution.network;
  const isNetworkSupported = networkResolution.supported;

  // Wallet state checks
  const isWalletConnected = isConnected;
  const isWalletLinked = !!linkedWalletAddress && linkedWalletAddress === stellarAddress;
  const canMintOrVerify = isWalletConnected && isWalletLinked;

  // Check if NFT is already minted
  const isAlreadyMinted = voucherData?.status === 'MINTED';
  const mintedByAddress = voucherData?.recipient;
  const isConnectedWithMintedWallet = stellarAddress === mintedByAddress;
  const canVerifyMinted = isConnectedWithMintedWallet && isWalletConnected && isWalletLinked;

  // A different step starts from a clean state
  useEffect(() => {
    setVoucherData(null);
    setPrerequisitesMissing(false);
    setMintLoading(false);
    setMintPhase('idle');
    setMintSuccess(false);
    setMintError(null);
    setTxHash(null);
    setPendingTx(null);
    setUnrecordedHash(null);
    setVerifying(false);
    setVerificationError(null);
    setVerificationSuccess(false);
  }, [stepKey]);

  // Load voucher on mount to check mint status
  useEffect(() => {
    if (isCompleted || !isNetworkSupported) {
      setVoucherLoading(false);
      return;
    }

    // Ignore the answer once the step changed or the component unmounted
    let cancelled = false;
    setVoucherLoading(true);

    apiClient
      .getNftVoucher(courseId, stepId)
      .then((response) => {
        if (cancelled) return;
        setVoucherData(response);
        // If already minted, set the states
        if (response.status === 'MINTED') {
          setMintSuccess(true);
          setTxHash(response.txHash || null);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        // No linked wallet yet is the normal state before linking: stay silent
        if (isServerError(error, 'NO_LINKED_WALLETS')) return;
        console.error('[NftMintChecker] Failed to load voucher:', error);
        setPrerequisitesMissing(isServerError(error, 'PREREQUISITES_NOT_COMPLETED'));
      })
      .finally(() => {
        if (!cancelled) setVoucherLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, courseId, stepId, isCompleted, isNetworkSupported]);

  // Record a confirmed mint on the backend. nft-verify is idempotent for the
  // same transaction hash, so a bounded retry is safe.
  const recordMint = useCallback(
    async (hash: string): Promise<boolean> => {
      for (let attempt = 1; attempt <= RECORD_MINT_ATTEMPTS; attempt++) {
        try {
          await apiClient.verifyNftMint(courseId, stepId, hash);
          return true;
        } catch (error) {
          console.error(
            `[NftMintChecker] Failed to record the mint (attempt ${attempt}/${RECORD_MINT_ATTEMPTS}):`,
            error
          );
          const retryable = !(error instanceof VenalabsApiError) || error.isRetryable();
          if (!retryable || attempt === RECORD_MINT_ATTEMPTS) {
            return false;
          }
          await sleep(RECORD_MINT_RETRY_DELAY_MS * attempt);
        }
      }
      return false;
    },
    [apiClient, courseId, stepId]
  );

  // Apply the final (or still unknown) result of a submitted transaction
  const settleTransaction = useCallback(
    async (outcome: SorobanTxOutcome, tx: SubmittedTx, update: (fn: () => void) => void) => {
      const { hash } = tx;
      if (outcome === 'SUCCESS') {
        // The backend is only told about a mint that is confirmed on-chain
        const recorded = await recordMint(hash);
        update(() => {
          setPendingTx(null);
          setTxHash(hash);
          if (recorded) {
            setUnrecordedHash(null);
            setMintSuccess(true);
          } else {
            setUnrecordedHash(hash);
          }
        });
        return;
      }

      update(() => {
        if (outcome === 'FAILED') {
          setPendingTx(null);
          setMintError(t('nft.transactionFailedOnChain'));
        } else if (outcome === 'EXPIRED') {
          setPendingTx(null);
          setMintError(t('nft.transactionExpired'));
        } else {
          // Status unknown: keep the transaction so it can be checked again
          setPendingTx(tx);
        }
      });
    },
    [recordMint, t]
  );

  // Handle mint
  const handleMint = useCallback(async () => {
    if (!stellarAddress || !canMintOrVerify || !isNetworkSupported) return;

    // A voucher can only be used once: never run two mints for the same step
    const key = stepKey;
    if (mintInFlightRef.current === key) return;
    mintInFlightRef.current = key;

    const isActive = () => isMountedRef.current && stepKeyRef.current === key;
    const update = (fn: () => void) => {
      if (isActive()) fn();
    };

    setMintLoading(true);
    setMintPhase('preparing');
    setMintError(null);
    setPrerequisitesMissing(false);

    try {
      // 1. Get voucher
      let voucher: VenalabsNftVoucherResponse;
      try {
        voucher = await apiClient.getNftVoucher(courseId, stepId);
      } catch (voucherError) {
        console.error('[NftMintChecker] Voucher error:', voucherError);
        update(() => {
          if (isServerError(voucherError, 'NO_LINKED_WALLETS')) {
            setMintError(t('nft.linkWalletFirst'));
          } else if (isServerError(voucherError, 'PREREQUISITES_NOT_COMPLETED')) {
            setPrerequisitesMissing(true);
          } else {
            setMintError(t('nft.failedVoucher'));
          }
        });
        return;
      }
      if (!isActive()) return;

      // Check if already minted
      if (voucher.status === 'MINTED') {
        setMintSuccess(true);
        setTxHash(voucher.txHash || null);
        return;
      }

      // The contract requires the authorization of the voucher recipient
      if (voucher.recipient !== stellarAddress) {
        setMintError(
          t('nft.recipientMismatch', { address: formatAddress(voucher.recipient || '') })
        );
        return;
      }
      if (!voucher.signature) {
        setMintError(t('nft.failedVoucher'));
        return;
      }

      // Do not build or sign anything while the wallet is set to another network
      const walletNetwork = await findWalletNetworkMismatch(getWalletNetwork, checkerNetwork);
      if (walletNetwork) {
        update(() =>
          setMintError(
            t('wallet.networkMismatch', { actual: walletNetwork, expected: checkerNetwork })
          )
        );
        return;
      }
      if (!isActive()) return;

      // 2. Build transaction using Stellar SDK (dynamic import)
      const {
        TransactionBuilder,
        Operation,
        Address,
        rpc: StellarRpc,
        Transaction,
        BASE_FEE,
        xdr,
      } = await import('@stellar/stellar-sdk');

      const rpcEndpoint = resolveSorobanRpc(checkerNetwork, rpcUrlOverride);
      const passphrase = getNetworkPassphrase(checkerNetwork);

      const RpcServer = new StellarRpc.Server(rpcEndpoint.url, {
        allowHttp: rpcEndpoint.allowHttp,
      });

      const userAccount = await RpcServer.getAccount(stellarAddress);

      // Convert signature from hex string to Bytes (64 bytes for Ed25519)
      // Use Uint8Array for browser compatibility (Buffer is Node.js only)
      const hexToBytes = (hex: string): Uint8Array => {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
          bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        return bytes;
      };

      const signatureBytes = hexToBytes(voucher.signature);
      if (signatureBytes.length !== 64) {
        throw new Error(`Invalid signature length: ${signatureBytes.length}`);
      }

      // Build transaction with mint_with_voucher function
      const builtAtMs = Date.now();
      const tx = new TransactionBuilder(userAccount, {
        fee: BASE_FEE,
        networkPassphrase: passphrase,
      })
        .addOperation(
          Operation.invokeContractFunction({
            function: 'mint_with_voucher',
            contract: voucher.contractAddress,
            args: [
              xdr.ScVal.scvString(voucher.slug || ''),
              xdr.ScVal.scvString(voucher.name || ''),
              new Address(voucher.recipient).toScVal(),
              xdr.ScVal.scvU64(xdr.Uint64.fromString(voucher.nonce)),
              xdr.ScVal.scvBytes(signatureBytes as unknown as Buffer),
            ],
          })
        )
        .setTimeout(MINT_TIMING.txTimeoutSeconds)
        .build();

      // 3. Simulate transaction
      const simResponse = await RpcServer.simulateTransaction(tx);
      if (StellarRpc.Api.isSimulationError(simResponse)) {
        console.error('[NftMintChecker] Simulation failed:', simResponse.error);
        const alreadyUsed = String(simResponse.error).includes('Nonce already used');
        update(() =>
          setMintError(alreadyUsed ? t('nft.voucherAlreadyUsed') : t('nft.simulationFailed'))
        );
        return;
      }
      const assembledTx = StellarRpc.assembleTransaction(tx, simResponse).build();

      // Do not open the wallet for a step the user has already left
      if (!isActive()) return;

      // 4. Sign via wallet
      setMintPhase('signing');
      const signedTxXdr = await signTransaction(assembledTx.toXDR(), passphrase);
      const signedTx = new Transaction(signedTxXdr, passphrase);
      const hash = signedTx.hash().toString('hex');

      // From here the transaction may reach the network: the flow runs to its
      // end even if the component unmounts, so a confirmed mint is recorded.
      update(() => setMintPhase('confirming'));

      // 5. Submit transaction
      try {
        await submitTransaction(RpcServer, signedTx);
      } catch (submitError) {
        if (submitError instanceof SorobanSubmitError) {
          console.error('[NftMintChecker] Submission failed:', submitError);
          update(() =>
            setMintError(
              submitError.reason === 'BUSY' ? t('nft.networkBusy') : t('nft.transactionFailed')
            )
          );
          return;
        }
        throw submitError;
      }

      // 6. Wait for the on-chain result: sendTransaction only queues the transaction
      const maxTime = Number(signedTx.timeBounds?.maxTime);
      const expiresAtSec =
        Number.isFinite(maxTime) && maxTime > 0
          ? maxTime
          : Math.ceil(builtAtMs / 1000) + MINT_TIMING.txTimeoutSeconds;
      const outcome = await waitForTransaction(RpcServer, hash, {
        deadline: expiresAtSec * 1000 + MINT_TIMING.confirmationGraceMs,
        expiresAtSec,
      });

      // 7. Mark as minted on backend, only once the transaction is confirmed
      await settleTransaction(outcome, { hash, expiresAtSec }, update);
    } catch (error: unknown) {
      console.error('[NftMintChecker] Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      update(() => setMintError(t('nft.mintingFailed', { error: errorMessage })));
    } finally {
      if (mintInFlightRef.current === key) {
        mintInFlightRef.current = null;
      }
      update(() => {
        setMintLoading(false);
        setMintPhase('idle');
      });
    }
  }, [
    stellarAddress,
    canMintOrVerify,
    isNetworkSupported,
    getWalletNetwork,
    apiClient,
    courseId,
    stepId,
    stepKey,
    signTransaction,
    settleTransaction,
    t,
    checkerNetwork,
    rpcUrlOverride,
  ]);

  // Check again a submitted transaction whose status is still unknown
  const handleCheckPending = useCallback(async () => {
    if (!pendingTx) return;

    const key = stepKey;
    if (mintInFlightRef.current === key) return;
    mintInFlightRef.current = key;

    const update = (fn: () => void) => {
      if (isMountedRef.current && stepKeyRef.current === key) fn();
    };

    setMintLoading(true);
    setMintPhase('confirming');
    setMintError(null);

    try {
      const { rpc: StellarRpc } = await import('@stellar/stellar-sdk');
      const rpcEndpoint = resolveSorobanRpc(checkerNetwork, rpcUrlOverride);
      const reader: SorobanReader = new StellarRpc.Server(rpcEndpoint.url, {
        allowHttp: rpcEndpoint.allowHttp,
      });

      // A single poll: once the transaction has expired, any readable answer is final
      const outcome = await waitForTransaction(reader, pendingTx.hash, {
        deadline: Date.now(),
        expiresAtSec: pendingTx.expiresAtSec,
      });
      await settleTransaction(outcome, pendingTx, update);
    } catch (error) {
      console.error('[NftMintChecker] Status check failed:', error);
    } finally {
      if (mintInFlightRef.current === key) {
        mintInFlightRef.current = null;
      }
      update(() => {
        setMintLoading(false);
        setMintPhase('idle');
      });
    }
  }, [pendingTx, stepKey, checkerNetwork, rpcUrlOverride, settleTransaction]);

  // Retry recording a mint that is confirmed on-chain
  const handleRetryRecord = useCallback(async () => {
    if (!unrecordedHash) return;

    const key = stepKey;
    if (mintInFlightRef.current === key) return;
    mintInFlightRef.current = key;

    const update = (fn: () => void) => {
      if (isMountedRef.current && stepKeyRef.current === key) fn();
    };

    setMintLoading(true);
    try {
      await settleTransaction('SUCCESS', { hash: unrecordedHash, expiresAtSec: 0 }, update);
    } finally {
      if (mintInFlightRef.current === key) {
        mintInFlightRef.current = null;
      }
      update(() => setMintLoading(false));
    }
  }, [unrecordedHash, stepKey, settleTransaction]);

  // Handle verify
  const handleVerify = useCallback(async () => {
    setVerifying(true);
    setVerificationError(null);
    setVerificationSuccess(false);

    try {
      const result = await apiClient.verifyStep(courseId, stepId);

      if (result.passed) {
        setVerificationSuccess(true);
        setTimeout(() => {
          onVerificationSuccess();
        }, 500);
      } else {
        setVerificationError(result.message || t('nft.verificationFailedNft'));
      }
    } catch (error) {
      console.error('[NftMintChecker] Verification error:', error);
      setVerificationError(t('nft.verificationFailed'));
    }

    setVerifying(false);
  }, [apiClient, courseId, stepId, onVerificationSuccess, t]);

  // Get Stellar explorer URL
  const getExplorerUrl = (hash: string) => {
    return isNetworkSupported ? getExplorerUrlUtil(checkerNetwork, hash) : '#';
  };

  const renderTransactionLink = (hash: string) => (
    <a
      href={getExplorerUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="venalabs-link venalabs-link--external"
    >
      <ExternalLink className="venalabs-icon-sm" />
      <span>
        {t('nft.viewTransaction')} {formatAddress(hash)}
      </span>
    </a>
  );

  // The mint is done on-chain as soon as the transaction is confirmed
  const mintDone = mintSuccess || !!unrecordedHash;

  return (
    <div className="venalabs-nft-mint-checker">
      {/* Checker info */}
      <div className="venalabs-checker-info">
        <p className="venalabs-checker-info__label">
          {t('verification.label')}{' '}
          <span className="venalabs-checker-info__name">
            {getLocalizedText(checker.name, locale)}
          </span>
        </p>
        {checker.description && (
          <p className="venalabs-checker-info__description">
            {getLocalizedText(checker.description, locale)}
          </p>
        )}
        <div className="venalabs-checker-info__badges">
          <span className="venalabs-checker-badge venalabs-checker-badge--type">
            {t('nft.badge')}
          </span>
          <span className="venalabs-checker-badge venalabs-checker-badge--network">
            {checkerNetwork}
          </span>
        </div>
      </div>

      {/* A network the SDK does not handle: explicit message, no wallet action */}
      {!isNetworkSupported && (
        <div className="venalabs-error-banner">
          <AlertCircle className="venalabs-icon-md venalabs-text-error" />
          <p>{t('verification.unsupportedNetwork', { network: checkerNetwork })}</p>
        </div>
      )}

      {/* Wallet section */}
      {isNetworkSupported && !isCompleted && (
        <WalletLinker
          apiClient={apiClient}
          network={checkerNetwork}
          linkedWalletAddress={linkedWalletAddress}
          onWalletLinked={onWalletLinked}
        />
      )}

      {/* Completed state */}
      {isCompleted && (
        <div className="venalabs-success-banner">
          <CheckCircle2 className="venalabs-icon-md venalabs-text-success" />
          <p>{t('nft.nftMintedCompleted')}</p>
        </div>
      )}

      {/* Loading state */}
      {isNetworkSupported && !isCompleted && voucherLoading && (
        <div className="venalabs-loading-state">
          <Loader2 className="venalabs-icon-md venalabs-animate-spin venalabs-text-primary" />
          <p>{t('nft.loadingNftStatus')}</p>
        </div>
      )}

      {/* Already Minted state (not yet verified) */}
      {isNetworkSupported && !isCompleted && !voucherLoading && isAlreadyMinted && (
        <div className="venalabs-nft-already-minted">
          {/* Minted info card */}
          <div className="venalabs-success-banner venalabs-success-banner--with-details">
            <div className="venalabs-success-banner__header">
              <CheckCircle2 className="venalabs-icon-md venalabs-text-success" />
              <p className="venalabs-text-success venalabs-font-medium">{t('nft.alreadyMinted')}</p>
            </div>
            <div className="venalabs-success-banner__content">
              <div className="venalabs-success-banner__details">
                <Wallet className="venalabs-icon-sm" />
                <span>
                  {t('nft.mintedBy')} {formatAddress(mintedByAddress || '')}
                </span>
              </div>
              {txHash && renderTransactionLink(txHash)}
            </div>
          </div>

          {/* Warning if not connected with correct wallet */}
          {!canVerifyMinted && (
            <div className="venalabs-warning-banner">
              <AlertCircle className="venalabs-icon-md venalabs-text-warning" />
              <p>
                {t('nft.connectAndLinkPart1')}{' '}
                <span className="venalabs-font-medium">{formatAddress(mintedByAddress || '')}</span>{' '}
                {t('nft.connectAndLinkPart2')}
              </p>
            </div>
          )}

          {/* Verification messages */}
          {verificationError && (
            <div className="venalabs-error-banner">
              <AlertCircle className="venalabs-icon-md venalabs-text-error" />
              <p>{verificationError}</p>
            </div>
          )}

          {verificationSuccess && (
            <div className="venalabs-success-banner">
              <CheckCircle2 className="venalabs-icon-md venalabs-text-success" />
              <p>{t('verification.passed')}</p>
            </div>
          )}

          {/* Verify button */}
          <GlassButton
            variant="primary"
            onClick={() => void handleVerify()}
            disabled={verifying || !canVerifyMinted || verificationSuccess}
          >
            {verifying && <Loader2 className="venalabs-icon-sm venalabs-animate-spin" />}
            {verifying
              ? t('verification.verifying')
              : verificationSuccess
                ? t('verification.verified')
                : t('verification.verifyComplete')}
          </GlassButton>
        </div>
      )}

      {/* Mint/Verify section (not yet minted) */}
      {isNetworkSupported && !isCompleted && !voucherLoading && !isAlreadyMinted && (
        <div className={cn('venalabs-nft-mint-section', !canMintOrVerify && 'venalabs-opacity-50')}>
          {/* Mint error */}
          {mintError && (
            <div className="venalabs-error-banner">
              <AlertCircle className="venalabs-icon-md venalabs-text-error" />
              <p>{mintError}</p>
            </div>
          )}

          {/* Voucher refused: previous courses of the map are not completed */}
          {prerequisitesMissing && !mintError && (
            <div className="venalabs-warning-banner">
              <AlertCircle className="venalabs-icon-md venalabs-text-warning" />
              <p>{t('nft.prerequisitesNotCompleted')}</p>
            </div>
          )}

          {/* Submitted transaction whose status is still unknown */}
          {pendingTx && (
            <div className="venalabs-warning-banner">
              <AlertCircle className="venalabs-icon-md venalabs-text-warning" />
              <div>
                <p>{t('nft.unconfirmed')}</p>
                {renderTransactionLink(pendingTx.hash)}
                <GlassButton
                  variant="secondary"
                  onClick={() => void handleCheckPending()}
                  disabled={mintLoading}
                >
                  {mintLoading && <Loader2 className="venalabs-icon-sm venalabs-animate-spin" />}
                  {t('nft.checkStatus')}
                </GlassButton>
              </div>
            </div>
          )}

          {/* Minted on-chain, not recorded by the backend yet */}
          {unrecordedHash && (
            <div className="venalabs-warning-banner">
              <AlertCircle className="venalabs-icon-md venalabs-text-warning" />
              <div>
                <p>{t('nft.mintedNotRecorded')}</p>
                {renderTransactionLink(unrecordedHash)}
                <GlassButton
                  variant="secondary"
                  onClick={() => void handleRetryRecord()}
                  disabled={mintLoading}
                >
                  {mintLoading && <Loader2 className="venalabs-icon-sm venalabs-animate-spin" />}
                  {t('nft.retryRecord')}
                </GlassButton>
              </div>
            </div>
          )}

          {/* Mint success */}
          {mintSuccess && txHash && (
            <div className="venalabs-success-banner venalabs-success-banner--with-details">
              <div className="venalabs-success-banner__header">
                <CheckCircle2 className="venalabs-icon-md venalabs-text-success" />
                <p className="venalabs-font-medium">{t('nft.nftMintedSuccess')}</p>
              </div>
              <div className="venalabs-success-banner__content">
                {renderTransactionLink(txHash)}
              </div>
            </div>
          )}

          {/* Verification messages */}
          {verificationError && (
            <div className="venalabs-error-banner">
              <AlertCircle className="venalabs-icon-md venalabs-text-error" />
              <p>{verificationError}</p>
            </div>
          )}

          {verificationSuccess && (
            <div className="venalabs-success-banner">
              <CheckCircle2 className="venalabs-icon-md venalabs-text-success" />
              <p>{t('verification.passed')}</p>
            </div>
          )}

          {/* Helper text when actions are disabled */}
          {!canMintOrVerify && (
            <p className="venalabs-helper-text">{t('nft.connectAndLinkToMint')}</p>
          )}

          {/* Action buttons */}
          <div className="venalabs-nft-actions">
            {/* Mint button */}
            <GlassButton
              variant="secondary"
              onClick={() => void handleMint()}
              disabled={mintLoading || !canMintOrVerify || mintDone || !!pendingTx}
            >
              {mintLoading && !mintDone && (
                <Loader2 className="venalabs-icon-sm venalabs-animate-spin" />
              )}
              {mintDone
                ? t('nft.minted')
                : mintLoading
                  ? mintPhase === 'confirming'
                    ? t('nft.confirming')
                    : t('nft.minting')
                  : t('nft.mintNft')}
            </GlassButton>

            {/* Verify button */}
            <GlassButton
              variant="primary"
              onClick={() => void handleVerify()}
              disabled={verifying || !canMintOrVerify || !mintSuccess || verificationSuccess}
            >
              {verifying && <Loader2 className="venalabs-icon-sm venalabs-animate-spin" />}
              {verifying
                ? t('verification.verifying')
                : verificationSuccess
                  ? t('verification.verified')
                  : t('verification.verifyComplete')}
            </GlassButton>
          </div>
        </div>
      )}
    </div>
  );
}

export default NftMintChecker;
