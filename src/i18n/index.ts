/**
 * Standalone i18n system for venalabs-stellar-sdk
 * Replaces next-international with a simple React-based solution
 */

import { createContext, useContext } from 'react';

export type SupportedLocale = 'en' | 'fr';

// Translation keys used in SDK components
const translations = {
  en: {
    // Course card statuses
    'courseCard.status.locked': 'Locked',
    'courseCard.status.available': 'Available',
    'courseCard.status.inProgress': 'In Progress',
    'courseCard.status.completed': 'Completed',

    // Verification
    'verification.failed': 'Verification failed. Please try again.',
    'verification.passed': 'Verification passed!',
    'verification.checkRequirements': 'Verification failed. Check the requirements and try again.',
    'verification.connectWallet': 'Connect your wallet to enable verification',
    'verification.linkWallet': 'Link your wallet to enable verification',
    'verification.stepVerified': 'Step verified and completed!',
    'verification.verifying': 'Verifying...',
    'verification.verified': 'Verified!',
    'verification.verifyComplete': 'Verify & Complete',
    'verification.label': 'Verification:',
    'verification.unsupportedNetwork':
      'This verification targets a network ({network}) that is not supported in this SDK version.',

    // Wallet
    'wallet.failedNonce': 'Failed to get nonce',
    'wallet.failedLink': 'Failed to link wallet',
    'wallet.signingFailed': 'Signing cancelled or failed',
    'wallet.connectionFailed': 'Wallet connection failed',
    'wallet.connect': 'Connect Wallet',
    'wallet.connecting': 'Connecting...',
    'wallet.linked': 'Linked',
    'wallet.linking': 'Linking...',
    'wallet.replaceLink': 'Replace Link',
    'wallet.linkWallet': 'Link Wallet',
    'wallet.currentlyLinked': 'Currently linked:',
    'wallet.switchWalletWarning': '(Connect this wallet or link the connected one)',
    'wallet.networkMismatch':
      'Your wallet is set to another network ({actual}). Switch it to {expected}, then try again.',

    // Courses
    'courses.notFound': 'Course not found',
    'courses.noCoursesAvailable': 'No courses available',
    'courses.notPublished': "This organization hasn't published any courses yet.",
    'courses.goBack': 'Go back',
    'courses.backToMap': 'Back to Map',
    'courses.steps': 'Steps',
    'courses.step': 'Step',
    'courses.completed': 'Completed',
    'courses.starting': 'Starting...',
    'courses.startCourse': 'Start Course',
    'courses.nextStep': 'Next Step',
    'courses.courseCompleted': 'Course Completed!',
    'courses.viewTranscript': 'View Transcript',
    'courses.checkAnswer': 'Check Answer',
    'courses.completeStep': 'Complete Step',
    'courses.claimRewards': 'Claim Rewards',
    'courses.completeToClaimRewards': 'Complete this step to claim your rewards!',

    // NFT
    'nft.linkWalletFirst': 'Please link your wallet first',
    'nft.failedVoucher': 'Failed to get voucher. Please try again.',
    'nft.transactionFailed': 'Transaction failed. Please try again.',
    'nft.mintingFailed': 'Minting failed: {error}',
    'nft.verificationFailed': 'Verification failed. Please try again.',
    'nft.verificationFailedNft': 'Verification failed. Make sure you have minted the NFT.',
    'nft.badge': 'NFT_MINT',
    'nft.nftMintedCompleted': 'NFT minted and step completed!',
    'nft.loadingNftStatus': 'Loading NFT status...',
    'nft.alreadyMinted': 'NFT already minted!',
    'nft.mintedBy': 'Minted by: ',
    'nft.viewTransaction': 'View transaction: ',
    'nft.connectAndLinkPart1': 'Connect and link wallet ',
    'nft.connectAndLinkPart2': ' to verify this step.',
    'nft.connectAndLinkToMint': 'Connect and link your wallet to mint NFT',
    'nft.nftMintedSuccess': 'NFT minted successfully!',
    'nft.minting': 'Minting...',
    'nft.minted': 'Minted!',
    'nft.mintNft': 'Mint NFT',
    'nft.confirming': 'Confirming...',
    'nft.transactionFailedOnChain': 'The mint transaction failed on-chain. Please try again.',
    'nft.transactionExpired':
      'The transaction expired before it was included in a ledger. Nothing was minted. Please try again.',
    'nft.networkBusy':
      'The Stellar network is busy and did not accept the transaction. Please try again in a moment.',
    'nft.simulationFailed': 'The mint transaction could not be prepared. Please try again later.',
    'nft.voucherAlreadyUsed':
      'This mint voucher has already been used on-chain. If the NFT is in your wallet, please contact support.',
    'nft.recipientMismatch':
      'This NFT is reserved for wallet {address}. Connect and link that wallet, then try again.',
    'nft.unconfirmed':
      'The transaction has not been confirmed yet. Do not mint again: check its status first.',
    'nft.checkStatus': 'Check status',
    'nft.mintedNotRecorded':
      'Your NFT was minted on-chain, but the mint could not be recorded yet. Do not mint again: retry the verification.',
    'nft.retryRecord': 'Retry verification',

    // Step content
    'stepContent.unknownStepType': 'Unknown step type: ',
    'stepContent.noContent': 'No content',
    'stepContent.markAsComplete': 'Mark as complete',
    'stepContent.transcript': 'Transcript',
    'stepContent.submitAnswer': 'Submit Answer',
    'stepContent.tryAgain': 'Try Again',
    'stepContent.stepCompleted': 'Step completed!',
    'stepContent.rewardsClaimed': 'Rewards claimed!',
    'stepContent.rewardsEarned': "You've earned the following rewards:",
    'stepContent.claiming': 'Claiming...',
    'stepContent.congratulations': 'Congratulations!',

    // Generic buttons
    'button.start': 'Start',
    'button.continue': 'Continue',
    'button.previous': 'Previous',
    'button.next': 'Next',
    'button.finish': 'Finish Course',
  },
  fr: {
    // Course card statuses
    'courseCard.status.locked': 'Verrouillé',
    'courseCard.status.available': 'Disponible',
    'courseCard.status.inProgress': 'En cours',
    'courseCard.status.completed': 'Terminé',

    // Verification
    'verification.failed': 'La vérification a échoué. Veuillez réessayer.',
    'verification.passed': 'Vérification réussie !',
    'verification.checkRequirements':
      'La vérification a échoué. Vérifiez les conditions et réessayez.',
    'verification.connectWallet': 'Connectez votre portefeuille pour activer la vérification',
    'verification.linkWallet': 'Liez votre portefeuille pour activer la vérification',
    'verification.stepVerified': 'Étape vérifiée et complétée !',
    'verification.verifying': 'Vérification...',
    'verification.verified': 'Vérifié !',
    'verification.verifyComplete': 'Vérifier et compléter',
    'verification.label': 'Vérification :',
    'verification.unsupportedNetwork':
      "Cette vérification cible un réseau ({network}) qui n'est pas pris en charge dans cette version du SDK.",

    // Wallet
    'wallet.failedNonce': 'Échec de récupération du nonce',
    'wallet.failedLink': 'Échec de la liaison du portefeuille',
    'wallet.signingFailed': 'Signature annulée ou échouée',
    'wallet.connectionFailed': 'Échec de la connexion au portefeuille',
    'wallet.connect': 'Connecter le portefeuille',
    'wallet.connecting': 'Connexion...',
    'wallet.linked': 'Lié',
    'wallet.linking': 'Liaison en cours...',
    'wallet.replaceLink': 'Remplacer le lien',
    'wallet.linkWallet': 'Lier le portefeuille',
    'wallet.currentlyLinked': 'Actuellement lié :',
    'wallet.switchWalletWarning': '(Connectez ce portefeuille ou liez celui connecté)',
    'wallet.networkMismatch':
      'Votre portefeuille est réglé sur un autre réseau ({actual}). Passez-le sur {expected}, puis réessayez.',

    // Courses
    'courses.notFound': 'Cours non trouvé',
    'courses.noCoursesAvailable': 'Aucun cours disponible',
    'courses.notPublished': "Cette organisation n'a pas encore publié de cours.",
    'courses.goBack': 'Retour',
    'courses.backToMap': 'Retour à la carte',
    'courses.steps': 'Étapes',
    'courses.step': 'Étape',
    'courses.completed': 'Terminé',
    'courses.starting': 'Démarrage...',
    'courses.startCourse': 'Commencer le cours',
    'courses.nextStep': 'Étape suivante',
    'courses.courseCompleted': 'Cours terminé !',
    'courses.viewTranscript': 'Voir la transcription',
    'courses.checkAnswer': 'Vérifier la réponse',
    'courses.completeStep': "Compléter l'étape",
    'courses.claimRewards': 'Réclamer les récompenses',
    'courses.completeToClaimRewards': 'Complétez cette étape pour réclamer vos récompenses !',

    // NFT
    'nft.linkWalletFirst': "Veuillez d'abord lier votre portefeuille",
    'nft.failedVoucher': 'Échec de récupération du voucher. Veuillez réessayer.',
    'nft.transactionFailed': 'La transaction a échoué. Veuillez réessayer.',
    'nft.mintingFailed': 'Échec du mint : {error}',
    'nft.verificationFailed': 'La vérification a échoué. Veuillez réessayer.',
    'nft.verificationFailedNft': "La vérification a échoué. Assurez-vous d'avoir minté le NFT.",
    'nft.badge': 'NFT_MINT',
    'nft.nftMintedCompleted': 'NFT minté et étape complétée !',
    'nft.loadingNftStatus': 'Chargement du statut du NFT...',
    'nft.alreadyMinted': 'NFT déjà minté !',
    'nft.mintedBy': 'Minté par : ',
    'nft.viewTransaction': 'Voir la transaction : ',
    'nft.connectAndLinkPart1': 'Connectez et liez le portefeuille ',
    'nft.connectAndLinkPart2': ' pour vérifier cette étape.',
    'nft.connectAndLinkToMint': 'Connectez et liez votre portefeuille pour minter le NFT',
    'nft.nftMintedSuccess': 'NFT minté avec succès !',
    'nft.minting': 'Mint en cours...',
    'nft.minted': 'Minté !',
    'nft.mintNft': 'Minter le NFT',
    'nft.confirming': 'Confirmation...',
    'nft.transactionFailedOnChain': 'La transaction de mint a échoué on-chain. Veuillez réessayer.',
    'nft.transactionExpired':
      "La transaction a expiré avant d'être incluse dans un ledger. Rien n'a été minté. Veuillez réessayer.",
    'nft.networkBusy':
      "Le réseau Stellar est saturé et n'a pas accepté la transaction. Veuillez réessayer dans un instant.",
    'nft.simulationFailed':
      "La transaction de mint n'a pas pu être préparée. Veuillez réessayer plus tard.",
    'nft.voucherAlreadyUsed':
      'Ce voucher de mint a déjà été utilisé on-chain. Si le NFT est dans votre portefeuille, veuillez contacter le support.',
    'nft.recipientMismatch':
      'Ce NFT est réservé au portefeuille {address}. Connectez et liez ce portefeuille, puis réessayez.',
    'nft.unconfirmed':
      "La transaction n'est pas encore confirmée. Ne mintez pas à nouveau : vérifiez d'abord son statut.",
    'nft.checkStatus': 'Vérifier le statut',
    'nft.mintedNotRecorded':
      "Votre NFT a été minté on-chain, mais le mint n'a pas encore pu être enregistré. Ne mintez pas à nouveau : relancez la vérification.",
    'nft.retryRecord': 'Relancer la vérification',

    // Step content
    'stepContent.unknownStepType': "Type d'étape inconnu : ",
    'stepContent.noContent': 'Aucun contenu',
    'stepContent.markAsComplete': 'Marquer comme terminé',
    'stepContent.transcript': 'Transcription',
    'stepContent.submitAnswer': 'Soumettre la réponse',
    'stepContent.tryAgain': 'Réessayer',
    'stepContent.stepCompleted': 'Étape complétée !',
    'stepContent.rewardsClaimed': 'Récompenses réclamées !',
    'stepContent.rewardsEarned': 'Vous avez gagné les récompenses suivantes :',
    'stepContent.claiming': 'Réclamation...',
    'stepContent.congratulations': 'Félicitations !',

    // Generic buttons
    'button.start': 'Commencer',
    'button.continue': 'Continuer',
    'button.previous': 'Précédent',
    'button.next': 'Suivant',
    'button.finish': 'Terminer le cours',
  },
} as const;

export type TranslationKey = keyof typeof translations.en;

// Context for locale
interface I18nContextValue {
  locale: SupportedLocale;
  t: (key: TranslationKey, params?: Record<string, string>) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Hook to access translations
 * Must be used within a VenalabsProvider
 */
export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    // Return a fallback that uses English when no provider is present
    return {
      locale: 'en' as SupportedLocale,
      t: (key: TranslationKey, params?: Record<string, string>): string => {
        let text: string = translations.en[key] || key;
        if (params) {
          Object.entries(params).forEach(([k, v]) => {
            text = text.replace(`{${k}}`, v);
          });
        }
        return text;
      },
    };
  }
  return context;
}

/**
 * Create translation function for a specific locale
 */
export function createTranslator(locale: SupportedLocale) {
  return (key: TranslationKey, params?: Record<string, string>): string => {
    const localeTranslations = translations[locale] || translations.en;
    let text: string = localeTranslations[key] || translations.en[key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, v);
      });
    }
    return text;
  };
}

/**
 * Get all translations for a locale
 */
export function getTranslations(locale: SupportedLocale) {
  return translations[locale] || translations.en;
}

export { translations };
