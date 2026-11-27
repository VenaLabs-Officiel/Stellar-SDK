# @venalabs/stellar-sdk

[![CI](https://github.com/VenaLabs-Officiel/Stellar-SDK/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/VenaLabs-Officiel/Stellar-SDK/actions/workflows/ci.yml)

Official React SDK for embedding VenaLabs Stellar courses in your website.

This documentation describes version 2.1.0.

## Installation

```bash
npm install @venalabs/stellar-sdk
```

## Requirements

- React 18 (`react` and `react-dom` `^18.0.0`, declared as peer dependencies)
- An API key and an API secret from the VenaLabs dashboard
- A backend endpoint of your own that exchanges the API secret for a user access token (see [Authentication Flow](#authentication-flow))

## Quick Start

```tsx
import { useCallback } from 'react';
import VenalabsStellarSDK from '@venalabs/stellar-sdk';
import '@venalabs/stellar-sdk/style.css';

function App() {
  const getAccessToken = useCallback(async () => {
    const res = await fetch('<your token endpoint>', { credentials: 'include' });
    const data = await res.json();
    return data.token;
  }, []);

  return <VenalabsStellarSDK apiKey="your-api-key" getAccessToken={getAccessToken} />;
}
```

`getAccessToken` does not need to be referentially stable: the SDK always calls the latest function and keeps its API client and cached token across renders. Passing a new function therefore does not switch users. If your application can change the signed-in user without unmounting the component, pass the `userKey` prop: changing it resets the session.

A step-by-step walkthrough is available in the [integration guide](./docs/integration-guide.md).

## Props

| Prop                | Type                        | Required | Default                    | Description                                                                                                                              |
| ------------------- | --------------------------- | -------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`            | `string`                    | Yes      | -                          | API key provided by the VenaLabs dashboard. It is public and sent as the `X-Api-Key` header                                              |
| `getAccessToken`    | `() => Promise<string>`     | Yes      | -                          | Async function that returns an access token (called on init and automatically on 401)                                                    |
| `lang`              | `'fr' \| 'en'`              | No       | `'en'`                     | UI language                                                                                                                              |
| `stellarNetwork`    | `'TESTNET' \| 'PUBLIC'`     | No       | `'TESTNET'`                | Stellar network used by the built-in wallet connection. Pass `'PUBLIC'` for courses that run on the public network (mainnet)             |
| `minHeight`         | `string \| number`          | No       | `600`                      | Minimum height of the SDK container (a number is read as pixels, a string as a CSS value)                                                |
| `className`         | `string`                    | No       | `''`                       | Custom class name for the container                                                                                                      |
| `baseUrl`           | `string`                    | No       | `https://api.venalabs.com` | Custom API base URL (for testing)                                                                                                        |
| `externalWalletKit` | `StellarWalletsKit \| null` | No       | -                          | Existing `@creit.tech/stellar-wallets-kit` instance from the host app. When provided, the SDK uses it as is and ignores `stellarNetwork` |
| `sorobanRpcUrl` | `string` | No | per network | Soroban RPC URL used for NFT minting. Defaults to `https://soroban-testnet.stellar.org` on testnet and `https://mainnet.sorobanrpc.com` on the public network. Must be an `https://` URL (`http://` is accepted for local development only) |
| `userKey` | `string` | No | - | Identifier of the signed-in user. Changing it resets the SDK session (token, maps, progress, linked wallets). Set it when your application can switch users without unmounting the component. It is never sent to the API |

## Authentication Flow

The SDK uses a delegated authentication pattern. Your backend authenticates the user and obtains a user access token from the VenaLabs API. The browser only ever sees the API key and that token.

```
┌─────────┐      ┌──────────────┐      ┌──────────────┐
│   SDK   │      │ Your Backend │      │ VenaLabs API │
└────┬────┘      └──────┬───────┘      └──────┬───────┘
     │                  │                     │
     │ getAccessToken() │                     │
     │─────────────────>│                     │
     │                  │                     │
     │                  │ POST /api/v1/sdk/auth/token
     │                  │ (X-Api-Key + X-Api-Secret + userId)
     │                  │────────────────────>│
     │                  │                     │
     │                  │  token + expiresIn  │
     │                  │<────────────────────│
     │                  │                     │
     │      token       │                     │
     │<─────────────────│                     │
     │                  │                     │
     │   API calls (X-Api-Key + Bearer token) │
     │───────────────────────────────────────>│
```

### Token endpoint

```
POST https://api.venalabs.com/api/v1/sdk/auth/token
```

| Part             | Value                                                          |
| ---------------- | -------------------------------------------------------------- |
| Header           | `X-Api-Key: <your API key>`                                    |
| Header           | `X-Api-Secret: <your API secret>`                              |
| Header           | `Content-Type: application/json`                               |
| Request body     | `{ "userId": "<the user's id in your system>" }`               |
| Response body    | `{ "token": "<access token>", "expiresIn": <seconds> }`        |
| Token lifetime   | 24 hours (`expiresIn` is `86400`)                              |
| Rejected request | HTTP 401 when a header is missing or the credentials are wrong |

### Backend Implementation

Your backend must implement an endpoint that:

1. Authenticates the current user (via session, JWT, etc.)
2. Calls the VenaLabs API to get an access token for that user
3. Returns the token to the frontend

#### Node.js / Express

```typescript
// routes/venalabs.ts
import express from 'express';
// Your own code: returns the id of the signed-in user, or null when nobody is signed in
import { getAuthenticatedUserId } from './auth';

const router = express.Router();

router.get('/venalabs-token', async (req, res) => {
  // 1. Only issue tokens to users authenticated in your system
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 2. Call the VenaLabs API to get a token for this user
    const response = await fetch('https://api.venalabs.com/api/v1/sdk/auth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.VENALABS_API_KEY!,
        'X-Api-Secret': process.env.VENALABS_API_SECRET!,
      },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Could not get a VenaLabs token' });
    }

    // The API answers { token, expiresIn }
    const data = (await response.json()) as { token: string; expiresIn: number };

    // 3. Return the token to the frontend
    res.json({ token: data.token });
  } catch {
    res.status(502).json({ error: 'Could not reach the VenaLabs API' });
  }
});

export default router;
```

How the user is identified is up to you: `getAuthenticatedUserId` stands for your own session or JWT check. Mount the router so that the endpoint is reachable at `/api/venalabs-token`, the path used by the client example below (for example `app.use('/api', router)`). The built-in `fetch` requires Node.js 18 or later.

## Complete Integration Example

```tsx
// app/courses/page.tsx (Next.js App Router example)
'use client';

import { useCallback } from 'react';
import VenalabsStellarSDK from '@venalabs/stellar-sdk';
import '@venalabs/stellar-sdk/style.css';

export default function CoursesPage() {
  // Token provider function, called by the SDK when it needs a token
  const getAccessToken = useCallback(async () => {
    const res = await fetch('/api/venalabs-token', {
      credentials: 'include', // Important: include cookies for auth
    });

    if (!res.ok) {
      throw new Error('Failed to get access token');
    }

    const data = await res.json();
    return data.token;
  }, []);

  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <VenalabsStellarSDK
        apiKey={process.env.NEXT_PUBLIC_VENALABS_API_KEY!}
        getAccessToken={getAccessToken}
        lang="en"
        stellarNetwork="PUBLIC"
      />
    </div>
  );
}
```

`stellarNetwork="PUBLIC"` is for courses that run on the public network. Leave it out (or pass `"TESTNET"`) for testnet courses.

`/api/venalabs-token` is a relative URL, so it must be served from the same origin as the page, or proxied from that origin to your own server.

## Troubleshooting

The SDK maps the HTTP status returned by the API to one of the error codes below (`VenalabsErrorCodes`).

| Error                   | Cause                                                                                                                                                                                                               | Solution                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INVALID_TOKEN`         | The API answered 401, even after the SDK called `getAccessToken` again. The API answers 401 for a missing, invalid or inactive API key, and for an invalid or expired token                                         | Check the API key in your VenaLabs dashboard, check that the token was created with the same API key, and make sure `getAccessToken` returns a fresh `token` string each time it is called |
| `TOKEN_EXPIRED`         | Only produced when a 401 response body contains `type: "TOKEN_EXPIRED"`. The current API does not send that field, so an expired token is reported as `INVALID_TOKEN` once the automatic refresh attempt has failed | See `INVALID_TOKEN`                                                                                                                                                                        |
| `INVALID_API_KEY`       | The code exists in the SDK and is mapped to HTTP 403. The current API reports an invalid API key with a 401, so that case is reported as `INVALID_TOKEN`                                                            | See `INVALID_TOKEN`                                                                                                                                                                        |
| `RATE_LIMITED`          | The API answered 429                                                                                                                                                                                                | Reduce the request rate or contact support                                                                                                                                                 |
| Blank/unstyled screen   | CSS not imported                                                                                                                                                                                                    | Add `import '@venalabs/stellar-sdk/style.css'` to your app                                                                                                                                 |
| Minting is refused because of the network | The wallet is on another network than the course | Switch the wallet to the network of the course (`stellarNetwork`). Linking a wallet only shows a warning; minting is blocked until the networks match |

## TypeScript Support

The SDK is fully typed. Import types as needed:

```typescript
import VenalabsStellarSDK, {
  type VenalabsStellarSDKProps,
  type TokenProvider,
  type VenalabsCourse,
  type VenalabsProgress,
} from '@venalabs/stellar-sdk';
```

## Browser Support

Modern evergreen browsers (Chrome, Firefox, Safari, Edge).

## Security Notes

- **Never expose your API Secret** in client-side code. The API key is public, the API secret is not
- Always call the VenaLabs auth endpoint from your backend
- Implement proper user authentication before generating tokens
- Use HTTPS for all API communications

To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## Deployed contracts

The Proof-of-Learning NFT ("VenaLabs Stellar Proof", symbol `VSP`) is a Soroban contract. Minting requires a voucher signed by the VenaLabs backend.

| Network | Contract address                                           |
| ------- | ---------------------------------------------------------- |
| Mainnet | `CAMOZBTH6VE2VYIAZXYKRMSVTZHFVGK5A323PRMCZS2IALIU6NPHN67X` |
| Testnet | `CAEM5O5I7H4WXRBXPIM3G7WZXAAXNG67PJEJIYFQEJ2SMDUKGHTPRICP` |

Explorer: [mainnet contract](https://stellar.expert/explorer/public/contract/CAMOZBTH6VE2VYIAZXYKRMSVTZHFVGK5A323PRMCZS2IALIU6NPHN67X), [testnet contract](https://stellar.expert/explorer/testnet/contract/CAEM5O5I7H4WXRBXPIM3G7WZXAAXNG67PJEJIYFQEJ2SMDUKGHTPRICP).

The SDK does not hardcode these addresses: the mint voucher returned by the VenaLabs API carries the contract address.

## Known limitations

These apply to version 2.1.0.

- Supported Stellar checkers: `LINKED`, `BALANCE`, `TRANSACTION` and `NFT_MINT`. Other checker types are not supported.
- The built-in wallet connection supports Freighter only.
- Only one map is displayed: the first one returned by the API. When the API returns several maps, the map selector buttons are rendered but selecting another map has no effect.
- CommonJS is not supported under Node.js: `require('@venalabs/stellar-sdk')` fails with `HTMLElement is not defined` (the `require` entry is a UMD browser build). Use the ESM `import` instead.

## Roadmap

For what comes next, including the next major version (v3), see the [VenaLabs documentation](https://venalabs.gitbook.io/venalabs-docs/).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Release history is in [CHANGELOG.md](./CHANGELOG.md).

## Support

- Documentation: https://venalabs.gitbook.io/venalabs-docs/
- Issues: https://github.com/VenaLabs-Officiel/Stellar-SDK/issues
- Email: hello@venalabs.com

## License

[MIT](./LICENSE). Third-party licenses are listed in [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
