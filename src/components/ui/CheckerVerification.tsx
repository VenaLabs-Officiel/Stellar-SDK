/**
 * Checker Verification component for venalabs-stellar-sdk
 * Handles checker verification flow with wallet connection/linking
 */

import { useState, useCallback, useEffect } from 'react';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useStellarWallet } from '../../wallet';
import { useTranslation } from '../../i18n';
import type { VenalabsChecker } from '../../types';
import { getLocalizedText } from '../../types';
import { GlassButton } from './GlassCard';
import { WalletLinker } from './WalletLinker';
import { NftMintChecker } from './NftMintChecker';
import type { VenalabsApiClient } from '../../api';
import {
  resolveCheckerNetwork,
  getCheckerConfigNetwork,
  toCheckerNetwork,
} from '../../utils/stellarNetworkUtils';
import { useDeferredCall } from '../../utils/useDeferredCall';

/** Checker types this SDK version can verify */
const SUPPORTED_CHECKER_TYPES: readonly string[] = ['LINKED', 'BALANCE', 'TRANSACTION', 'NFT_MINT'];

// Utility function for class names
function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export interface CheckerVerificationProps {
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
}

/**
 * Component that handles checker verification flow including:
 * - Wallet connection (if needed)
 * - Wallet linking (if needed)
 * - Verification button with proper disabled state
 * - Success/error messages
 */
export function CheckerVerification({
  apiClient,
  courseId,
  stepId,
  checker,
  isCompleted,
  linkedWalletAddress,
  onWalletLinked,
  onVerificationSuccess,
}: CheckerVerificationProps): JSX.Element {
  const { t, locale } = useTranslation();
  const { stellarAddress, isConnected, network: configuredNetwork } = useStellarWallet();

  // The network comes from the checker, otherwise from the stellarNetwork prop
  const networkResolution = resolveCheckerNetwork(checker, configuredNetwork);
  const checkerNetwork = networkResolution.network;
  const isNetworkSupported = networkResolution.supported;

  // Signatures always use the network of the checker. Tell the integrator when
  // the stellarNetwork prop says otherwise, as it is probably a configuration slip.
  useEffect(() => {
    if (isNetworkSupported && toCheckerNetwork(configuredNetwork) !== checkerNetwork) {
      console.warn(
        `[VenalabsStellarSDK] Checker "${checker.id}" runs on ${checkerNetwork} while the ` +
          `stellarNetwork prop is "${configuredNetwork}". The checker network is used.`
      );
    }
  }, [isNetworkSupported, configuredNetwork, checkerNetwork, checker.id]);

  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationSuccess, setVerificationSuccess] = useState(false);
  const [verificationDetails, setVerificationDetails] = useState<{
    message: string;
    details?: Record<string, string>;
  } | null>(null);

  // Delay before the step is completed; cleared (and run at once) on unmount
  const deferCall = useDeferredCall();

  // Declared before the NFT_MINT early return so hooks run in the same order on every render
  const handleVerify = useCallback(async () => {
    setVerifying(true);
    setVerificationError(null);
    setVerificationSuccess(false);

    try {
      const result = await apiClient.verifyStep(courseId, stepId);

      if (result.passed) {
        setVerificationSuccess(true);
        setVerificationDetails({
          message: result.message || t('verification.passed'),
          details: result.details,
        });
        deferCall(onVerificationSuccess, 500);
      } else {
        setVerificationError(result.message || t('verification.checkRequirements'));
      }
    } catch {
      setVerificationError(t('verification.failed'));
    }

    setVerifying(false);
  }, [apiClient, courseId, stepId, onVerificationSuccess, deferCall, t]);

  // A checker type added to the platform after this SDK version: say so
  // instead of offering Stellar wallet actions that cannot satisfy it
  if (!SUPPORTED_CHECKER_TYPES.includes(checker.type)) {
    return (
      <UnsupportedChecker
        checker={checker}
        locale={locale}
        isCompleted={isCompleted}
        message={t('verification.unsupportedChecker', { type: checker.type })}
      />
    );
  }

  // For NFT_MINT checkers, use the dedicated component
  if (checker.type === 'NFT_MINT') {
    return (
      <NftMintChecker
        apiClient={apiClient}
        courseId={courseId}
        stepId={stepId}
        checker={checker}
        isCompleted={isCompleted}
        linkedWalletAddress={linkedWalletAddress}
        onWalletLinked={onWalletLinked}
        onVerificationSuccess={onVerificationSuccess}
      />
    );
  }

  // A network the SDK does not handle: explicit message, no wallet action
  if (!isNetworkSupported) {
    return (
      <UnsupportedChecker
        checker={checker}
        locale={locale}
        isCompleted={isCompleted}
        message={t('verification.unsupportedNetwork', { network: checkerNetwork })}
      />
    );
  }

  // Check if this checker requires wallet connection
  const requiresWallet =
    checker.type === 'LINKED' || checker.type === 'BALANCE' || checker.type === 'TRANSACTION';

  // Wallet state
  const isWalletConnected = isConnected;
  const isWalletLinked = !!linkedWalletAddress && linkedWalletAddress === stellarAddress;

  // Can verify if:
  // - Checker doesn't require wallet, OR
  // - Wallet is connected AND linked
  const canVerify = !requiresWallet || (isWalletConnected && isWalletLinked);

  // Helper message based on state
  const getHelperMessage = (): string | null => {
    if (!requiresWallet) return null;
    if (!isWalletConnected) return t('verification.connectWallet');
    if (!isWalletLinked) return t('verification.linkWallet');
    return null;
  };

  const helperMessage = getHelperMessage();

  return (
    <div className="venalabs-checker-verification">
      {/* Checker info */}
      <CheckerInfo checker={checker} locale={locale} />

      {/* Wallet section for checkers that require it */}
      {requiresWallet && !isCompleted && (
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
          <p>
            {verificationDetails ? verificationDetails.message : t('verification.stepVerified')}
          </p>
        </div>
      )}

      {/* Verification section */}
      {!isCompleted && (
        <div className={cn('venalabs-verification-section', !canVerify && 'venalabs-opacity-50')}>
          {/* Error message */}
          {verificationError && (
            <div className="venalabs-error-banner">
              <AlertCircle className="venalabs-icon-md venalabs-text-error" />
              <p>{verificationError}</p>
            </div>
          )}

          {/* Success message */}
          {verificationSuccess && verificationDetails && (
            <div className="venalabs-success-banner">
              <CheckCircle2 className="venalabs-icon-md venalabs-text-success" />
              <p>{verificationDetails.message}</p>
            </div>
          )}

          {/* Helper text when verification is disabled */}
          {helperMessage && <p className="venalabs-helper-text">{helperMessage}</p>}

          {/* Verify button */}
          <GlassButton
            variant="primary"
            onClick={() => void handleVerify()}
            disabled={verifying || !canVerify || verificationSuccess}
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
    </div>
  );
}

/**
 * Displays a checker the SDK cannot verify (unknown type or network)
 */
function UnsupportedChecker({
  checker,
  locale,
  isCompleted,
  message,
}: {
  checker: VenalabsChecker;
  locale: string;
  isCompleted: boolean;
  message: string;
}): JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="venalabs-checker-verification">
      <CheckerInfo checker={checker} locale={locale} />
      {isCompleted ? (
        <div className="venalabs-success-banner">
          <CheckCircle2 className="venalabs-icon-md venalabs-text-success" />
          <p>{t('verification.stepVerified')}</p>
        </div>
      ) : (
        <div className="venalabs-warning-banner">
          <AlertCircle className="venalabs-icon-md venalabs-text-warning" />
          <p>{message}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Displays checker info card
 */
function CheckerInfo({
  checker,
  locale,
}: {
  checker: VenalabsChecker;
  locale: string;
}): JSX.Element {
  const { t } = useTranslation();

  const getCheckerNetwork = (): string | null => getCheckerConfigNetwork(checker) ?? null;

  return (
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
        <span className="venalabs-checker-badge venalabs-checker-badge--type">{checker.type}</span>
        {getCheckerNetwork() && (
          <span className="venalabs-checker-badge venalabs-checker-badge--network">
            {getCheckerNetwork()}
          </span>
        )}
      </div>
    </div>
  );
}

export default CheckerVerification;
