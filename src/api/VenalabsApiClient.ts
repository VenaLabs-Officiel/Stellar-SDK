/**
 * VenalabsApiClient - REST API client for SDK endpoints
 */

import {
  VenalabsApiClientConfig,
  TokenProvider,
  VenalabsMap,
  VenalabsCourse,
  VenalabsProgress,
  SdkStepCompletionResult,
  SdkStepCompletionRequest,
  VenalabsWalletNonceResponse,
  VenalabsWalletLinkRequest,
  VenalabsWalletLinkResponse,
  VenalabsLinkedWalletResponse,
  VenalabsCheckerVerificationResult,
  VenalabsNftVoucherResponse,
  VenalabsNftVerifyRequest,
} from '../types';
import { VenalabsApiError, VenalabsErrorCodes } from './errors';
import { fetchWithRetry, FetchWithRetryOptions } from './fetchWithRetry';
import { DEFAULT_STELLAR_NETWORK, toCheckerNetwork } from '../utils/stellarNetworkUtils';

const DEFAULT_BASE_URL = 'https://api.venalabs.com';
const DEFAULT_TIMEOUT = 30000;

/** Shape of the JSON body returned by the API on error responses */
type ApiErrorBody = Parameters<typeof VenalabsApiError.fromResponse>[1];

/**
 * API client for communicating with Venalabs SDK endpoints
 *
 * Uses dynamic token authentication with automatic refresh on 401.
 *
 * @example
 * ```typescript
 * const client = new VenalabsApiClient({
 *   apiKey: 'your-api-key',
 *   getAccessToken: async () => {
 *     const response = await fetch('/api/your-backend/token');
 *     const data = await response.json();
 *     return data.accessToken;
 *   },
 * });
 * ```
 */
export class VenalabsApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  // Token management
  private readonly tokenProvider: TokenProvider;
  private cachedToken: string | null = null;
  private tokenPromise: Promise<string> | null = null;

  /**
   * Create a new VenalabsApiClient
   * @param config - Client configuration
   */
  constructor(config: VenalabsApiClientConfig) {
    if (!config.apiKey) {
      throw new Error('apiKey is required');
    }
    if (!config.getAccessToken) {
      throw new Error('getAccessToken is required');
    }

    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.tokenProvider = config.getAccessToken;
  }

  /**
   * Get the current access token
   * Fetches token if not cached
   */
  private async getToken(): Promise<string> {
    // Return cached token if available
    if (this.cachedToken) {
      return this.cachedToken;
    }

    // Fetch new token using provider
    return this.refreshToken();
  }

  /**
   * Refresh the access token
   * Used on initialization and after 401 responses.
   * Concurrent callers share a single call to the token provider.
   */
  private refreshToken(): Promise<string> {
    if (this.tokenPromise) {
      return this.tokenPromise;
    }

    const pending = this.fetchTokenFromProvider().finally(() => {
      if (this.tokenPromise === pending) {
        this.tokenPromise = null;
      }
    });
    this.tokenPromise = pending;

    return pending;
  }

  /**
   * Call the token provider and validate what it returns, so that a missing
   * token never reaches the API as "Bearer undefined"
   */
  private async fetchTokenFromProvider(): Promise<string> {
    let token: unknown;
    try {
      token = await this.tokenProvider();
    } catch (error) {
      if (error instanceof VenalabsApiError) {
        throw error;
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new VenalabsApiError(
        VenalabsErrorCodes.INVALID_TOKEN,
        0,
        `getAccessToken failed: ${reason}`
      );
    }

    if (typeof token !== 'string' || token.trim() === '') {
      throw new VenalabsApiError(
        VenalabsErrorCodes.INVALID_TOKEN,
        0,
        'getAccessToken returned an empty token'
      );
    }

    this.cachedToken = token;
    return token;
  }

  /**
   * Get a fresh token after a 401 received with `rejectedToken`.
   * When another request has already replaced that token, the current one is
   * reused instead of calling the token provider again.
   */
  private async renewToken(rejectedToken: string): Promise<void> {
    if (this.cachedToken === rejectedToken) {
      this.cachedToken = null;
    }
    await this.getToken();
  }

  /**
   * Build common headers for SDK requests
   */
  private buildHeaders(token: string): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': this.apiKey,
      Authorization: `Bearer ${token}`,
    };
  }

  /**
   * Build fetch retry options.
   * Only GET requests are retried automatically on 5xx, timeout or network
   * errors: the POST endpoints (start, complete, link, verify, nft-verify)
   * are not idempotent and must not be replayed blindly.
   */
  private getRetryOptions(method: 'GET' | 'POST'): FetchWithRetryOptions {
    return {
      timeout: this.timeout,
      retries: method === 'GET' ? 1 : 0,
      retryDelay: 2000,
    };
  }

  /**
   * Parse a successful response. An empty body (204, or 200 without content)
   * resolves to undefined instead of failing on JSON parsing.
   */
  private async parseBody<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (text.trim() === '') {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new VenalabsApiError(
        VenalabsErrorCodes.UNKNOWN,
        response.status,
        'The API returned a response that is not valid JSON'
      );
    }
  }

  /**
   * Make a request to the SDK API, with a single replay after a 401
   */
  private async request<T>(method: 'GET' | 'POST', endpoint: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/api/v1/sdk${endpoint}`;

    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken();

      const response = await fetchWithRetry(
        url,
        {
          method,
          headers: this.buildHeaders(token),
          body: method === 'POST' && body ? JSON.stringify(body) : undefined,
        },
        this.getRetryOptions(method)
      );

      // Handle 401 with token refresh (the request was not processed)
      if (response.status === 401 && attempt === 0) {
        await this.renewToken(token);
        continue;
      }

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as ApiErrorBody;
        throw VenalabsApiError.fromResponse(response.status, errorBody);
      }

      return this.parseBody<T>(response);
    }
  }

  /**
   * Make a GET request to the SDK API
   */
  private get<T>(endpoint: string): Promise<T> {
    return this.request<T>('GET', endpoint);
  }

  /**
   * Make a POST request to the SDK API
   */
  private post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', endpoint, body);
  }

  // ============================================================
  // Map Endpoints
  // ============================================================

  /**
   * Get all published maps for the organization
   * @param lang - Language code for localized content (default: 'en')
   * @returns Promise resolving to array of maps
   */
  async getMaps(lang: string = 'en'): Promise<VenalabsMap[]> {
    return this.get<VenalabsMap[]>(`/maps?lang=${encodeURIComponent(lang)}`);
  }

  // ============================================================
  // Course Endpoints
  // ============================================================

  /**
   * Get a specific course by ID
   * @param courseId - The course ID to retrieve
   * @param lang - Language code for localized content (default: 'en')
   * @returns Promise resolving to the course
   */
  async getCourse(courseId: string, lang: string = 'en'): Promise<VenalabsCourse> {
    if (!courseId) {
      throw new Error('courseId is required');
    }
    return this.get<VenalabsCourse>(
      `/courses/${encodeURIComponent(courseId)}?lang=${encodeURIComponent(lang)}`
    );
  }

  /**
   * Start a course for the current user
   * @param courseId - The course ID to start
   * @returns Promise resolving when course is started
   */
  async startCourse(courseId: string): Promise<void> {
    if (!courseId) {
      throw new Error('courseId is required');
    }
    await this.post<void>(`/courses/${encodeURIComponent(courseId)}/start`);
  }

  // ============================================================
  // Step Endpoints
  // ============================================================

  /**
   * Complete a step in a course
   * @param courseId - The course ID containing the step
   * @param stepId - The step ID to complete
   * @param request - Optional request body (for quiz answers, checker data)
   * @returns Promise resolving to step completion result
   */
  async completeStep(
    courseId: string,
    stepId: string,
    request?: SdkStepCompletionRequest
  ): Promise<SdkStepCompletionResult> {
    if (!courseId) {
      throw new Error('courseId is required');
    }
    if (!stepId) {
      throw new Error('stepId is required');
    }
    return this.post<SdkStepCompletionResult>(
      `/courses/${encodeURIComponent(courseId)}/steps/${encodeURIComponent(stepId)}/complete`,
      request
    );
  }

  // ============================================================
  // Progress Endpoints
  // ============================================================

  /**
   * Get the current user's progress across all courses
   * @returns Promise resolving to array of progress records
   */
  async getProgress(): Promise<VenalabsProgress[]> {
    return this.get<VenalabsProgress[]>('/progress');
  }

  /**
   * Get the current user's progress for a specific course
   * @param courseId - The course ID to get progress for
   * @returns Promise resolving to progress for the course, or null if not started
   */
  async getCourseProgress(courseId: string): Promise<VenalabsProgress | null> {
    if (!courseId) {
      throw new Error('courseId is required');
    }
    try {
      const progress = await this.get<VenalabsProgress | undefined>(
        `/progress/${encodeURIComponent(courseId)}`
      );
      return progress ?? null;
    } catch (error) {
      if (error instanceof VenalabsApiError && error.code === 'NOT_FOUND') {
        return null;
      }
      throw error;
    }
  }

  // ============================================================
  // Wallet Endpoints
  // ============================================================

  /**
   * Get a nonce for wallet signature verification
   * @param walletAddress - The wallet address to generate nonce for
   * @returns Promise resolving to nonce response
   */
  async getWalletNonce(walletAddress: string): Promise<VenalabsWalletNonceResponse> {
    if (!walletAddress) {
      throw new Error('walletAddress is required');
    }
    return this.get<VenalabsWalletNonceResponse>(
      `/wallet/nonce?walletAddress=${encodeURIComponent(walletAddress)}`
    );
  }

  /**
   * Link a Stellar wallet to the user's account
   * @param walletAddress - The wallet address to link
   * @param signature - Signature of the nonce message
   * @param network - Checker network the wallet is linked for (default: STELLAR_TESTNET)
   * @returns Promise resolving to wallet link response
   */
  async linkStellarWallet(
    walletAddress: string,
    signature: string,
    network?: string
  ): Promise<VenalabsWalletLinkResponse> {
    if (!walletAddress) {
      throw new Error('walletAddress is required');
    }
    if (!signature) {
      throw new Error('signature is required');
    }
    const request: VenalabsWalletLinkRequest = {
      walletAddress,
      signature,
      network: network || toCheckerNetwork(DEFAULT_STELLAR_NETWORK),
    };
    return this.post<VenalabsWalletLinkResponse>('/wallet/stellar/link', request);
  }

  /**
   * Get linked wallets for the current user
   * @returns Promise resolving to linked wallet response
   */
  async getLinkedWallets(): Promise<VenalabsLinkedWalletResponse> {
    return this.get<VenalabsLinkedWalletResponse>('/wallet');
  }

  // ============================================================
  // Verification Endpoints
  // ============================================================

  /**
   * Verify a step's checker
   * @param courseId - The course ID
   * @param stepId - The step ID to verify
   * @returns Promise resolving to verification result
   */
  async verifyStep(courseId: string, stepId: string): Promise<VenalabsCheckerVerificationResult> {
    if (!courseId) {
      throw new Error('courseId is required');
    }
    if (!stepId) {
      throw new Error('stepId is required');
    }
    return this.post<VenalabsCheckerVerificationResult>(
      `/courses/${encodeURIComponent(courseId)}/steps/${encodeURIComponent(stepId)}/verify`
    );
  }

  // ============================================================
  // NFT Voucher Endpoints
  // ============================================================

  /**
   * Get NFT voucher for a step with NFT_MINT checker
   * @param courseId - The course ID
   * @param stepId - The step ID
   * @returns Promise resolving to NFT voucher response
   */
  async getNftVoucher(courseId: string, stepId: string): Promise<VenalabsNftVoucherResponse> {
    if (!courseId) {
      throw new Error('courseId is required');
    }
    if (!stepId) {
      throw new Error('stepId is required');
    }
    return this.get<VenalabsNftVoucherResponse>(
      `/courses/${encodeURIComponent(courseId)}/steps/${encodeURIComponent(stepId)}/nft-voucher`
    );
  }

  /**
   * Mark NFT as minted after successful transaction
   * @param courseId - The course ID
   * @param stepId - The step ID
   * @param txHash - Transaction hash from the mint
   * @returns Promise resolving when verification is complete
   */
  async verifyNftMint(courseId: string, stepId: string, txHash: string): Promise<void> {
    if (!courseId) {
      throw new Error('courseId is required');
    }
    if (!stepId) {
      throw new Error('stepId is required');
    }
    if (!txHash) {
      throw new Error('txHash is required');
    }
    const request: VenalabsNftVerifyRequest = { txHash };
    await this.post<void>(
      `/courses/${encodeURIComponent(courseId)}/steps/${encodeURIComponent(stepId)}/nft-verify`,
      request
    );
  }
}
