import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { VenalabsApiClient } from '../VenalabsApiClient';
import { VenalabsApiError, VenalabsErrorCodes } from '../errors';
import type { TokenProvider, VenalabsMap, VenalabsCourse, VenalabsProgress } from '../../types';

// Mock data
const mockMaps: VenalabsMap[] = [
  {
    id: 'map-1',
    organizationId: 'org-1',
    name: 'Test Map',
    description: 'A test map',
    imageUrl: 'https://example.com/map.png',
    nodes: [
      {
        id: 'node-1',
        courseId: 'course-1',
        courseName: { en: 'Test Course' },
        totalSteps: 3,
        x: 0,
        y: 0,
      },
    ],
    connections: [],
    status: 'PUBLISHED',
    createdOn: '2024-01-01T00:00:00Z',
  },
];

const mockCourse: VenalabsCourse = {
  id: 'course-1',
  organizationId: 'org-1',
  title: { en: 'Test Course' },
  description: { en: 'A test course' },
  steps: [
    {
      id: 'step-1',
      title: { en: 'Step 1' },
      type: 'TEXT',
      order: 0,
      textContent: { content: { en: ['Hello world'] } },
    },
  ],
  status: 'PUBLISHED',
  createdOn: '2024-01-01T00:00:00Z',
};

const mockProgress: VenalabsProgress[] = [
  {
    id: 'progress-1',
    organizationId: 'org-1',
    externalUserId: 'user-1',
    courseId: 'course-1',
    courseName: { en: 'Test Course' },
    status: 'IN_PROGRESS',
    stepProgress: [
      {
        stepId: 'step-1',
        stepTitle: { en: 'Step 1' },
        status: 'COMPLETED',
        completedOn: '2024-01-02T00:00:00Z',
      },
    ],
    startedOn: '2024-01-01T00:00:00Z',
  },
];

// MSW Server setup
const BASE_URL = 'https://api.test.com';

const server = setupServer(
  // GET /maps
  http.get(`${BASE_URL}/api/v1/sdk/maps`, ({ request }) => {
    const apiKey = request.headers.get('X-Api-Key');
    const auth = request.headers.get('Authorization');

    if (!apiKey || apiKey === 'invalid-key') {
      return HttpResponse.json(
        { code: 403, type: 'INVALID_API_KEY', message: 'Invalid API key' },
        { status: 403 }
      );
    }

    if (!auth || !auth.startsWith('Bearer ')) {
      return HttpResponse.json(
        { code: 401, type: 'INVALID_TOKEN', message: 'Missing token' },
        { status: 401 }
      );
    }

    return HttpResponse.json(mockMaps);
  }),

  // GET /courses/:courseId
  http.get(`${BASE_URL}/api/v1/sdk/courses/:courseId`, ({ params, request }) => {
    const apiKey = request.headers.get('X-Api-Key');
    if (!apiKey) {
      return HttpResponse.json({ message: 'Invalid API key' }, { status: 403 });
    }

    if (params.courseId === 'not-found') {
      return HttpResponse.json(
        { code: 404, type: 'NOT_FOUND', message: 'Course not found' },
        { status: 404 }
      );
    }

    return HttpResponse.json(mockCourse);
  }),

  // POST /courses/:courseId/start
  http.post(`${BASE_URL}/api/v1/sdk/courses/:courseId/start`, ({ request }) => {
    const apiKey = request.headers.get('X-Api-Key');
    if (!apiKey) {
      return HttpResponse.json({ message: 'Invalid API key' }, { status: 403 });
    }

    return new HttpResponse(null, { status: 204 });
  }),

  // POST /courses/:courseId/steps/:stepId/complete
  http.post(`${BASE_URL}/api/v1/sdk/courses/:courseId/steps/:stepId/complete`, ({ request }) => {
    const apiKey = request.headers.get('X-Api-Key');
    if (!apiKey) {
      return HttpResponse.json({ message: 'Invalid API key' }, { status: 403 });
    }

    return HttpResponse.json({
      success: true,
      progress: mockProgress[0],
    });
  }),

  // GET /progress
  http.get(`${BASE_URL}/api/v1/sdk/progress`, ({ request }) => {
    const apiKey = request.headers.get('X-Api-Key');
    if (!apiKey) {
      return HttpResponse.json({ message: 'Invalid API key' }, { status: 403 });
    }

    return HttpResponse.json(mockProgress);
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

// Helper to create a token provider
const createTokenProvider = (token: string) => () => Promise.resolve(token);

describe('VenalabsApiClient', () => {
  describe('constructor', () => {
    it('should throw if apiKey is missing', () => {
      expect(() => {
        new VenalabsApiClient({
          apiKey: '',
          getAccessToken: createTokenProvider('token'),
        });
      }).toThrow('apiKey is required');
    });

    it('should throw if getAccessToken is missing', () => {
      expect(() => {
        new VenalabsApiClient({
          apiKey: 'key',
          getAccessToken: undefined as unknown as TokenProvider,
        });
      }).toThrow('getAccessToken is required');
    });

    it('should create client with valid config', () => {
      const client = new VenalabsApiClient({
        apiKey: 'test-key',
        getAccessToken: createTokenProvider('test-token'),
        baseUrl: BASE_URL,
      });

      expect(client).toBeInstanceOf(VenalabsApiClient);
    });
  });

  describe('getMaps', () => {
    it('should fetch maps successfully', async () => {
      const client = new VenalabsApiClient({
        apiKey: 'valid-key',
        getAccessToken: createTokenProvider('valid-token'),
        baseUrl: BASE_URL,
      });

      const maps = await client.getMaps();

      expect(maps).toEqual(mockMaps);
      expect(maps).toHaveLength(1);
      expect(maps[0]!.name).toBe('Test Map');
    });

    it('should send correct headers', async () => {
      let capturedHeaders: Headers | null = null;

      server.use(
        http.get(`${BASE_URL}/api/v1/sdk/maps`, ({ request }) => {
          capturedHeaders = request.headers;
          return HttpResponse.json(mockMaps);
        })
      );

      const client = new VenalabsApiClient({
        apiKey: 'my-api-key',
        getAccessToken: createTokenProvider('my-user-token'),
        baseUrl: BASE_URL,
      });

      await client.getMaps();

      expect(capturedHeaders!.get('X-Api-Key')).toBe('my-api-key');
      expect(capturedHeaders!.get('Authorization')).toBe('Bearer my-user-token');
      expect(capturedHeaders!.get('Content-Type')).toBe('application/json');
    });

    it('should throw VenalabsApiError on invalid API key', async () => {
      const client = new VenalabsApiClient({
        apiKey: 'invalid-key',
        getAccessToken: createTokenProvider('valid-token'),
        baseUrl: BASE_URL,
      });

      await expect(client.getMaps()).rejects.toThrow(VenalabsApiError);
      await expect(client.getMaps()).rejects.toMatchObject({
        code: VenalabsErrorCodes.INVALID_API_KEY,
        status: 403,
      });
    });

    it('should refresh token on 401 and retry', async () => {
      let requestCount = 0;
      let tokenFetchCount = 0;

      server.use(
        http.get(`${BASE_URL}/api/v1/sdk/maps`, ({ request }) => {
          requestCount++;
          const auth = request.headers.get('Authorization');

          if (auth === 'Bearer expired-token') {
            return HttpResponse.json(
              { code: 401, type: 'TOKEN_EXPIRED', message: 'Token expired' },
              { status: 401 }
            );
          }

          return HttpResponse.json(mockMaps);
        })
      );

      const client = new VenalabsApiClient({
        apiKey: 'valid-key',
        getAccessToken: () => {
          tokenFetchCount++;
          // First call returns expired token, second returns valid token
          return Promise.resolve(tokenFetchCount === 1 ? 'expired-token' : 'fresh-token');
        },
        baseUrl: BASE_URL,
      });

      const maps = await client.getMaps();

      expect(maps).toEqual(mockMaps);
      expect(requestCount).toBe(2); // Initial request + retry
      expect(tokenFetchCount).toBe(2); // Initial fetch + refresh
    });
  });

  describe('getCourse', () => {
    it('should fetch a course by ID', async () => {
      const client = new VenalabsApiClient({
        apiKey: 'valid-key',
        getAccessToken: createTokenProvider('valid-token'),
        baseUrl: BASE_URL,
      });

      const course = await client.getCourse('course-1');

      expect(course).toEqual(mockCourse);
      expect(course.id).toBe('course-1');
    });

    it('should throw on missing courseId', async () => {
      const client = new VenalabsApiClient({
        apiKey: 'valid-key',
        getAccessToken: createTokenProvider('valid-token'),
        baseUrl: BASE_URL,
      });

      await expect(client.getCourse('')).rejects.toThrow('courseId is required');
    });

    it('should throw NOT_FOUND for non-existent course', async () => {
      const client = new VenalabsApiClient({
        apiKey: 'valid-key',
        getAccessToken: createTokenProvider('valid-token'),
        baseUrl: BASE_URL,
      });

      await expect(client.getCourse('not-found')).rejects.toMatchObject({
        code: VenalabsErrorCodes.NOT_FOUND,
        status: 404,
      });
    });
  });

  describe('startCourse', () => {
    it('should start a course successfully', async () => {
      const client = new VenalabsApiClient({
        apiKey: 'valid-key',
        getAccessToken: createTokenProvider('valid-token'),
        baseUrl: BASE_URL,
      });

      await expect(client.startCourse('course-1')).resolves.toBeUndefined();
    });

    it('should throw on missing courseId', async () => {
      const client = new VenalabsApiClient({
        apiKey: 'valid-key',
        getAccessToken: createTokenProvider('valid-token'),
        baseUrl: BASE_URL,
      });

      await expect(client.startCourse('')).rejects.toThrow('courseId is required');
    });
  });

  describe('completeStep', () => {
    it('should complete a step successfully', async () => {
      const client = new VenalabsApiClient({
        apiKey: 'valid-key',
        getAccessToken: createTokenProvider('valid-token'),
        baseUrl: BASE_URL,
      });

      const result = await client.completeStep('course-1', 'step-1');

      expect(result.success).toBe(true);
      expect(result.progress).toBeDefined();
    });

    it('should send request body for quiz answers', async () => {
      let capturedBody: unknown = null;

      server.use(
        http.post(
          `${BASE_URL}/api/v1/sdk/courses/:courseId/steps/:stepId/complete`,
          async ({ request }) => {
            capturedBody = await request.json();
            return HttpResponse.json({ success: true });
          }
        )
      );

      const client = new VenalabsApiClient({
        apiKey: 'valid-key',
        getAccessToken: createTokenProvider('valid-token'),
        baseUrl: BASE_URL,
      });

      await client.completeStep('course-1', 'step-1', { selectedOptionIndex: 2 });

      expect(capturedBody).toEqual({ selectedOptionIndex: 2 });
    });

    it('should throw on missing courseId', async () => {
      const client = new VenalabsApiClient({
        apiKey: 'valid-key',
        getAccessToken: createTokenProvider('valid-token'),
        baseUrl: BASE_URL,
      });

      await expect(client.completeStep('', 'step-1')).rejects.toThrow('courseId is required');
    });

    it('should throw on missing stepId', async () => {
      const client = new VenalabsApiClient({
        apiKey: 'valid-key',
        getAccessToken: createTokenProvider('valid-token'),
        baseUrl: BASE_URL,
      });

      await expect(client.completeStep('course-1', '')).rejects.toThrow('stepId is required');
    });
  });

  describe('getProgress', () => {
    it('should fetch user progress', async () => {
      const client = new VenalabsApiClient({
        apiKey: 'valid-key',
        getAccessToken: createTokenProvider('valid-token'),
        baseUrl: BASE_URL,
      });

      const progress = await client.getProgress();

      expect(progress).toEqual(mockProgress);
      expect(progress).toHaveLength(1);
      expect(progress[0]!.status).toBe('IN_PROGRESS');
    });
  });
});

describe('VenalabsApiError', () => {
  describe('fromResponse', () => {
    it('should create error from 401 response', () => {
      const error = VenalabsApiError.fromResponse(401, {
        type: 'INVALID_TOKEN',
        message: 'Invalid token',
      });

      expect(error.code).toBe(VenalabsErrorCodes.INVALID_TOKEN);
      expect(error.status).toBe(401);
      expect(error.message).toBe('Invalid token');
    });

    it('should create error from 401 with TOKEN_EXPIRED', () => {
      const error = VenalabsApiError.fromResponse(401, {
        type: 'TOKEN_EXPIRED',
        message: 'Token expired',
      });

      expect(error.code).toBe(VenalabsErrorCodes.TOKEN_EXPIRED);
    });

    it('should create error from 403 response', () => {
      const error = VenalabsApiError.fromResponse(403);

      expect(error.code).toBe(VenalabsErrorCodes.INVALID_API_KEY);
      expect(error.status).toBe(403);
    });

    it('should create error from 404 response', () => {
      const error = VenalabsApiError.fromResponse(404);

      expect(error.code).toBe(VenalabsErrorCodes.NOT_FOUND);
      expect(error.status).toBe(404);
    });

    it('should create error from 429 response', () => {
      const error = VenalabsApiError.fromResponse(429);

      expect(error.code).toBe(VenalabsErrorCodes.RATE_LIMITED);
      expect(error.status).toBe(429);
    });

    it('should create error from 500 response', () => {
      const error = VenalabsApiError.fromResponse(500);

      expect(error.code).toBe(VenalabsErrorCodes.SERVER_ERROR);
      expect(error.status).toBe(500);
    });
  });

  describe('isAuthError', () => {
    it('should return true for auth errors', () => {
      expect(
        new VenalabsApiError(VenalabsErrorCodes.INVALID_API_KEY, 403, 'test').isAuthError()
      ).toBe(true);
      expect(
        new VenalabsApiError(VenalabsErrorCodes.INVALID_TOKEN, 401, 'test').isAuthError()
      ).toBe(true);
      expect(
        new VenalabsApiError(VenalabsErrorCodes.TOKEN_EXPIRED, 401, 'test').isAuthError()
      ).toBe(true);
    });

    it('should return false for non-auth errors', () => {
      expect(new VenalabsApiError(VenalabsErrorCodes.NOT_FOUND, 404, 'test').isAuthError()).toBe(
        false
      );
    });
  });

  describe('isRetryable', () => {
    it('should return true for retryable errors', () => {
      expect(new VenalabsApiError(VenalabsErrorCodes.NETWORK_ERROR, 0, 'test').isRetryable()).toBe(
        true
      );
      expect(new VenalabsApiError(VenalabsErrorCodes.TIMEOUT, 0, 'test').isRetryable()).toBe(true);
      expect(new VenalabsApiError(VenalabsErrorCodes.SERVER_ERROR, 500, 'test').isRetryable()).toBe(
        true
      );
      expect(new VenalabsApiError(VenalabsErrorCodes.RATE_LIMITED, 429, 'test').isRetryable()).toBe(
        true
      );
    });

    it('should return false for non-retryable errors', () => {
      expect(new VenalabsApiError(VenalabsErrorCodes.NOT_FOUND, 404, 'test').isRetryable()).toBe(
        false
      );
    });
  });
});

describe('fetchWithRetry', () => {
  it('should retry on 5xx errors', async () => {
    let requestCount = 0;

    server.use(
      http.get(`${BASE_URL}/api/v1/sdk/maps`, () => {
        requestCount++;
        if (requestCount < 2) {
          return HttpResponse.json({ message: 'Server error' }, { status: 500 });
        }
        return HttpResponse.json(mockMaps);
      })
    );

    const client = new VenalabsApiClient({
      apiKey: 'valid-key',
      getAccessToken: createTokenProvider('valid-token'),
      baseUrl: BASE_URL,
    });

    const maps = await client.getMaps();

    expect(requestCount).toBe(2);
    expect(maps).toEqual(mockMaps);
  });

  it('should not retry on 4xx errors', async () => {
    let requestCount = 0;

    server.use(
      http.get(`${BASE_URL}/api/v1/sdk/maps`, () => {
        requestCount++;
        return HttpResponse.json({ message: 'Bad request' }, { status: 400 });
      })
    );

    const client = new VenalabsApiClient({
      apiKey: 'valid-key',
      getAccessToken: createTokenProvider('valid-token'),
      baseUrl: BASE_URL,
    });

    await expect(client.getMaps()).rejects.toThrow(VenalabsApiError);
    expect(requestCount).toBe(1);
  });

  it('should handle timeout', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/sdk/maps`, async () => {
        // Delay longer than timeout
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return HttpResponse.json(mockMaps);
      })
    );

    const client = new VenalabsApiClient({
      apiKey: 'valid-key',
      getAccessToken: createTokenProvider('valid-token'),
      baseUrl: BASE_URL,
      timeout: 100, // 100ms timeout
    });

    await expect(client.getMaps()).rejects.toMatchObject({
      code: VenalabsErrorCodes.TIMEOUT,
    });
  }, 10000);
});

describe('VenalabsApiClient: retries only apply to GET requests', () => {
  const makeClient = () =>
    new VenalabsApiClient({
      apiKey: 'test-api-key',
      getAccessToken: createTokenProvider('test-token'),
      baseUrl: BASE_URL,
    });

  it('retries a GET once after a 5xx response', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE_URL}/api/v1/sdk/maps`, () => {
        calls++;
        return calls === 1
          ? HttpResponse.json({ message: 'Server error' }, { status: 503 })
          : HttpResponse.json(mockMaps);
      })
    );

    await expect(makeClient().getMaps()).resolves.toEqual(mockMaps);
    expect(calls).toBe(2);
  });

  it('retries a GET once after a network error', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE_URL}/api/v1/sdk/progress`, () => {
        calls++;
        return calls === 1 ? HttpResponse.error() : HttpResponse.json(mockProgress);
      })
    );

    await expect(makeClient().getProgress()).resolves.toEqual(mockProgress);
    expect(calls).toBe(2);
  });

  const postCases: Array<[string, string, (client: VenalabsApiClient) => Promise<unknown>]> = [
    ['start', '/courses/course-1/start', (c) => c.startCourse('course-1')],
    [
      'complete',
      '/courses/course-1/steps/step-1/complete',
      (c) => c.completeStep('course-1', 'step-1'),
    ],
    ['wallet link', '/wallet/stellar/link', (c) => c.linkStellarWallet('GADDRESS', 'signature')],
    ['verify', '/courses/course-1/steps/step-1/verify', (c) => c.verifyStep('course-1', 'step-1')],
    [
      'nft-verify',
      '/courses/course-1/steps/step-1/nft-verify',
      (c) => c.verifyNftMint('course-1', 'step-1', 'txhash'),
    ],
  ];

  it.each(postCases)('does not replay POST %s after a 5xx response', async (_name, path, call) => {
    let calls = 0;
    server.use(
      http.post(`${BASE_URL}/api/v1/sdk${path}`, () => {
        calls++;
        return HttpResponse.json({ message: 'Server error' }, { status: 500 });
      })
    );

    const error = await call(makeClient()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VenalabsApiError);
    expect((error as VenalabsApiError).code).toBe(VenalabsErrorCodes.SERVER_ERROR);
    expect(calls).toBe(1);
  });

  it('does not replay a POST after a network error', async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE_URL}/api/v1/sdk/courses/course-1/steps/step-1/complete`, () => {
        calls++;
        return HttpResponse.error();
      })
    );

    const error = await makeClient()
      .completeStep('course-1', 'step-1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VenalabsApiError);
    expect((error as VenalabsApiError).code).toBe(VenalabsErrorCodes.NETWORK_ERROR);
    expect(calls).toBe(1);
  });

  it('still replays a POST once after a 401, with a fresh token', async () => {
    const tokens = ['expired-token', 'fresh-token'];
    let providerCalls = 0;
    const seen: Array<string | null> = [];
    server.use(
      http.post(`${BASE_URL}/api/v1/sdk/courses/course-1/start`, ({ request }) => {
        const auth = request.headers.get('Authorization');
        seen.push(auth);
        return auth === 'Bearer fresh-token'
          ? new HttpResponse(null, { status: 204 })
          : HttpResponse.json({ type: 'TOKEN_EXPIRED' }, { status: 401 });
      })
    );

    const client = new VenalabsApiClient({
      apiKey: 'test-api-key',
      getAccessToken: () => Promise.resolve(tokens[providerCalls++] ?? 'fresh-token'),
      baseUrl: BASE_URL,
    });

    await expect(client.startCourse('course-1')).resolves.toBeUndefined();
    expect(seen).toEqual(['Bearer expired-token', 'Bearer fresh-token']);
  });
});

describe('VenalabsApiClient: access token validation', () => {
  const clientWith = (getAccessToken: TokenProvider) =>
    new VenalabsApiClient({ apiKey: 'test-api-key', getAccessToken, baseUrl: BASE_URL });

  it.each([
    ['an empty string', ''],
    ['a blank string', '   '],
    ['undefined', undefined],
    ['null', null],
  ])('throws a VenalabsApiError when getAccessToken returns %s', async (_label, value) => {
    let requests = 0;
    server.use(
      http.get(`${BASE_URL}/api/v1/sdk/maps`, () => {
        requests++;
        return HttpResponse.json(mockMaps);
      })
    );

    const error = await clientWith(() => Promise.resolve(value as unknown as string))
      .getMaps()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VenalabsApiError);
    expect((error as VenalabsApiError).code).toBe(VenalabsErrorCodes.INVALID_TOKEN);
    expect((error as VenalabsApiError).message).toMatch(/getAccessToken returned an empty token/);
    // Nothing is sent with "Bearer undefined"
    expect(requests).toBe(0);
  });

  it('wraps a rejection of getAccessToken in a VenalabsApiError', async () => {
    const error = await clientWith(() => Promise.reject(new Error('session expired')))
      .getMaps()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VenalabsApiError);
    expect((error as VenalabsApiError).code).toBe(VenalabsErrorCodes.INVALID_TOKEN);
    expect((error as VenalabsApiError).message).toMatch(/session expired/);
  });

  it('wraps a synchronous throw of getAccessToken in a VenalabsApiError', async () => {
    const provider = (() => {
      throw new Error('not signed in');
    }) as unknown as TokenProvider;

    const error = await clientWith(provider)
      .getMaps()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VenalabsApiError);
    expect((error as VenalabsApiError).message).toMatch(/not signed in/);
  });

  it('asks for a token again on the next request after a failure', async () => {
    let calls = 0;
    const client = clientWith(() => {
      calls++;
      return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve('test-token');
    });

    await expect(client.getMaps()).rejects.toBeInstanceOf(VenalabsApiError);
    await expect(client.getMaps()).resolves.toEqual(mockMaps);
    expect(calls).toBe(2);
  });
});

describe('VenalabsApiClient: concurrent token refresh', () => {
  it('refreshes the token once when several requests receive a 401', async () => {
    let providerCalls = 0;
    const provider: TokenProvider = () => {
      providerCalls++;
      return Promise.resolve(providerCalls === 1 ? 'stale-token' : `fresh-token-${providerCalls}`);
    };

    // Each endpoint rejects the stale token after a different delay, so the
    // 401 responses arrive one after the other
    const guarded =
      (delayMs: number, body: unknown) =>
      async ({ request }: { request: Request }) => {
        if (request.headers.get('Authorization') === 'Bearer stale-token') {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return HttpResponse.json({ type: 'TOKEN_EXPIRED' }, { status: 401 });
        }
        return HttpResponse.json(body as Record<string, unknown>);
      };
    server.use(
      http.get(`${BASE_URL}/api/v1/sdk/maps`, guarded(10, mockMaps)),
      http.get(`${BASE_URL}/api/v1/sdk/progress`, guarded(60, mockProgress)),
      http.get(`${BASE_URL}/api/v1/sdk/wallet`, guarded(120, { walletAddresses: {} }))
    );

    const client = new VenalabsApiClient({
      apiKey: 'test-api-key',
      getAccessToken: provider,
      baseUrl: BASE_URL,
    });

    const [maps, progress, wallets] = await Promise.all([
      client.getMaps(),
      client.getProgress(),
      client.getLinkedWallets(),
    ]);

    expect(maps).toEqual(mockMaps);
    expect(progress).toEqual(mockProgress);
    expect(wallets).toEqual({ walletAddresses: {} });
    // One initial fetch + a single shared refresh
    expect(providerCalls).toBe(2);
  });
});

describe('VenalabsApiClient: empty response bodies', () => {
  const makeClient = () =>
    new VenalabsApiClient({
      apiKey: 'test-api-key',
      getAccessToken: createTokenProvider('test-token'),
      baseUrl: BASE_URL,
    });

  it('does not throw a SyntaxError on a POST answered with 200 and no body', async () => {
    server.use(
      http.post(
        `${BASE_URL}/api/v1/sdk/courses/course-1/steps/step-1/nft-verify`,
        () => new HttpResponse(null, { status: 200 })
      )
    );

    await expect(
      makeClient().verifyNftMint('course-1', 'step-1', 'txhash')
    ).resolves.toBeUndefined();
  });

  it('does not throw a SyntaxError on a GET answered with 200 and no body', async () => {
    server.use(
      http.get(
        `${BASE_URL}/api/v1/sdk/progress/course-1`,
        () => new HttpResponse(null, { status: 200 })
      )
    );

    await expect(makeClient().getCourseProgress('course-1')).resolves.toBeNull();
  });

  it('does not throw a SyntaxError on a GET answered with 204', async () => {
    server.use(
      http.get(
        `${BASE_URL}/api/v1/sdk/progress/course-1`,
        () => new HttpResponse(null, { status: 204 })
      )
    );

    await expect(makeClient().getCourseProgress('course-1')).resolves.toBeNull();
  });

  it('reports a body that is not JSON as a VenalabsApiError, not a SyntaxError', async () => {
    server.use(
      http.get(
        `${BASE_URL}/api/v1/sdk/maps`,
        () => new HttpResponse('<html>gateway</html>', { status: 200 })
      )
    );

    const error = await makeClient()
      .getMaps()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VenalabsApiError);
    expect(error).not.toBeInstanceOf(SyntaxError);
  });
});

describe('VenalabsApiError: backend error codes', () => {
  it('reads the code of the structured error body ({ code, message })', () => {
    const error = VenalabsApiError.fromResponse(409, {
      code: 'VERIFICATION_REQUIRED',
      message: 'This step must be verified before it can be completed',
    });

    expect(error.status).toBe(409);
    expect(error.serverCode).toBe('VERIFICATION_REQUIRED');
    expect(error.message).toBe('This step must be verified before it can be completed');
  });

  it('reads a code carried by the message of a Spring error body', () => {
    const error = VenalabsApiError.fromResponse(400, {
      status: 400,
      error: 'Bad Request',
      message: 'NO_LINKED_WALLETS',
    });

    expect(error.serverCode).toBe('NO_LINKED_WALLETS');
  });

  it('reads a code carried by the detail of a problem+json body', () => {
    const error = VenalabsApiError.fromResponse(400, {
      title: 'Bad Request',
      status: 400,
      detail: 'PREREQUISITES_NOT_COMPLETED',
    });

    expect(error.serverCode).toBe('PREREQUISITES_NOT_COMPLETED');
  });

  it('has no server code when the body carries none', () => {
    expect(
      VenalabsApiError.fromResponse(400, { status: 400, error: 'Bad Request' }).serverCode
    ).toBeUndefined();
    expect(
      VenalabsApiError.fromResponse(404, { message: 'Course not found' }).serverCode
    ).toBeUndefined();
    expect(VenalabsApiError.fromResponse(500).serverCode).toBeUndefined();
    // A numeric code is the HTTP status, not a backend error code
    expect(
      VenalabsApiError.fromResponse(403, { code: 403, type: 'INVALID_API_KEY' }).serverCode
    ).toBe('INVALID_API_KEY');
  });

  it('exposes the code of a 409 VERIFICATION_REQUIRED answer to complete', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/sdk/courses/course-1/steps/step-1/complete`, () =>
        HttpResponse.json(
          {
            code: 'VERIFICATION_REQUIRED',
            message: 'This step must be verified before it can be completed',
            details: { stepId: 'step-1', checkerId: 'checker-1' },
          },
          { status: 409 }
        )
      )
    );
    const client = new VenalabsApiClient({
      apiKey: 'test-api-key',
      getAccessToken: createTokenProvider('test-token'),
      baseUrl: BASE_URL,
    });

    const error = await client.completeStep('course-1', 'step-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VenalabsApiError);
    expect((error as VenalabsApiError).status).toBe(409);
    expect((error as VenalabsApiError).serverCode).toBe('VERIFICATION_REQUIRED');
  });

  it('reads a code sent as a plain text body', async () => {
    server.use(
      http.post(
        `${BASE_URL}/api/v1/sdk/courses/course-1/steps/step-1/complete`,
        () => new HttpResponse('CONCURRENT_UPDATE', { status: 409 })
      )
    );
    const client = new VenalabsApiClient({
      apiKey: 'test-api-key',
      getAccessToken: createTokenProvider('test-token'),
      baseUrl: BASE_URL,
    });

    const error = await client.completeStep('course-1', 'step-1').catch((e: unknown) => e);

    expect((error as VenalabsApiError).serverCode).toBe('CONCURRENT_UPDATE');
  });
});
