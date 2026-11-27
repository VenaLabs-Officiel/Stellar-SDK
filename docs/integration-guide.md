# VenaLabs Stellar SDK: Integration Guide

This guide shows how to embed VenaLabs Stellar courses in a React application with `@venalabs/stellar-sdk` 2.0.1.

## How it works

1. Your server holds an API key and an API secret.
2. When a signed-in user opens the courses page, your server asks the VenaLabs API for an access token for that user.
3. The browser passes the API key and that token to the SDK component. The SDK calls the VenaLabs API with both.

The API secret never leaves your server. The API key is public: it identifies your organization and is safe to ship in client-side code.

## Prerequisites

- A React 18 application
- An **API key** and an **API secret** from the VenaLabs dashboard
- A backend where you can add one endpoint

## Step 1: Install the SDK

```bash
npm install @venalabs/stellar-sdk
```

## Step 2: Add a token endpoint to your server

Your server exchanges its credentials for a user access token:

```
POST https://api.venalabs.com/api/v1/sdk/auth/token
```

| Part          | Value                                                   |
| ------------- | ------------------------------------------------------- |
| Header        | `X-Api-Key: <your API key>`                             |
| Header        | `X-Api-Secret: <your API secret>`                       |
| Header        | `Content-Type: application/json`                        |
| Request body  | `{ "userId": "<the user's id in your system>" }`        |
| Response body | `{ "token": "<access token>", "expiresIn": <seconds> }` |

The token is valid for 24 hours (`expiresIn` is `86400`). The API answers HTTP 401 when a header is missing or the credentials are wrong.

`userId` is the identifier of the user in your own system. Course progress is stored against it, so use a stable value.

### Example: Node.js / Express

```javascript
// routes/venalabs.js
const express = require('express');
const router = express.Router();

router.get('/venalabs-token', async (req, res) => {
  // Only issue tokens to users authenticated in your system
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const response = await fetch('https://api.venalabs.com/api/v1/sdk/auth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.VENALABS_API_KEY,
        'X-Api-Secret': process.env.VENALABS_API_SECRET,
      },
      body: JSON.stringify({ userId: String(req.user.id) }),
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Could not get a VenaLabs token' });
    }

    // The API answers { token, expiresIn }
    const data = await response.json();
    res.json({ token: data.token });
  } catch {
    res.status(502).json({ error: 'Could not reach the VenaLabs API' });
  }
});

module.exports = router;
```

`req.user` stands for whatever your own authentication sets: how the user is identified is up to you. Mount the router so that the endpoint is reachable at `/api/venalabs-token` (for example `app.use('/api', router)`). The built-in `fetch` requires Node.js 18 or later.

## Step 3: Render the SDK

The component takes the API key and a `getAccessToken` function. The SDK calls this function when it starts, and again whenever the API answers 401, so it must return a fresh token each time it is called.

```tsx
import { useCallback } from 'react';
import VenalabsStellarSDK from '@venalabs/stellar-sdk';
import '@venalabs/stellar-sdk/style.css';

export function CoursesPage() {
  const getAccessToken = useCallback(async () => {
    const res = await fetch('/api/venalabs-token', {
      credentials: 'include', // send your session cookie
    });

    if (!res.ok) {
      throw new Error('Failed to get access token');
    }

    // Matches the server example above, which answers { token }
    const data = await res.json();
    return data.token;
  }, []);

  return (
    <VenalabsStellarSDK
      apiKey="your-api-key"
      getAccessToken={getAccessToken}
      lang="en"
      stellarNetwork="TESTNET"
    />
  );
}
```

With Next.js, render the component from a client component (a file that starts with `'use client'`).

## Props reference

| Prop                | Type                        | Required | Default                    | Description                                             |
| ------------------- | --------------------------- | -------- | -------------------------- | ------------------------------------------------------- |
| `apiKey`            | `string`                    | Yes      | -                          | Your API key                                            |
| `getAccessToken`    | `() => Promise<string>`     | Yes      | -                          | Returns a user access token (called on init and on 401) |
| `lang`              | `'fr' \| 'en'`              | No       | `'en'`                     | UI language                                             |
| `stellarNetwork`    | `'TESTNET' \| 'PUBLIC'`     | No       | `'TESTNET'`                | Network used by the built-in wallet connection          |
| `minHeight`         | `string \| number`          | No       | `600`                      | Minimum container height                                |
| `className`         | `string`                    | No       | `''`                       | Custom CSS class for the container                      |
| `baseUrl`           | `string`                    | No       | `https://api.venalabs.com` | API base URL (for testing)                              |
| `externalWalletKit` | `StellarWalletsKit \| null` | No       | -                          | Existing wallet kit instance                            |

## Choosing the network

`stellarNetwork` defaults to `TESTNET`. For a course that runs on the public network (mainnet), pass `stellarNetwork="PUBLIC"`.

## Using an existing wallet kit

If your app already has a `@creit.tech/stellar-wallets-kit` instance, pass it as `externalWalletKit`. The SDK then uses your instance as is and ignores `stellarNetwork`, so configure the network on your own kit.

```tsx
<VenalabsStellarSDK
  apiKey="your-api-key"
  getAccessToken={getAccessToken}
  externalWalletKit={walletKit}
/>
```

Without `externalWalletKit`, the SDK creates its own kit with the Freighter wallet.

## Styling

Import the stylesheet once:

```tsx
import '@venalabs/stellar-sdk/style.css';
```

Colors are CSS variables declared on `:root`. Their values are space-separated RGB channels, not hex codes:

```css
:root {
  --venalabs-primary: 99 102 241;
  --venalabs-background: 17 24 39;
}
```

The `className` prop adds a class to the SDK container.

## Errors

The SDK displays an error view when a request fails. Errors thrown by the API client are `VenalabsApiError` instances with one of these codes:

| Code              | When                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_TOKEN`   | The API answered 401, even after the SDK called `getAccessToken` again. The API answers 401 for a missing, invalid or inactive API key, and for an invalid or expired token                                         |
| `TOKEN_EXPIRED`   | Only produced when a 401 response body contains `type: "TOKEN_EXPIRED"`. The current API does not send that field, so an expired token is reported as `INVALID_TOKEN` once the automatic refresh attempt has failed |
| `INVALID_API_KEY` | The code exists in the SDK and is mapped to HTTP 403. The current API reports an invalid API key with a 401, so that case is reported as `INVALID_TOKEN`                                                            |
| `NOT_FOUND`       | The API answered 404                                                                                                                                                                                                |
| `RATE_LIMITED`    | The API answered 429                                                                                                                                                                                                |
| `SERVER_ERROR`    | The API answered with a 5xx status                                                                                                                                                                                  |
| `NETWORK_ERROR`   | The request could not reach the API                                                                                                                                                                                 |
| `TIMEOUT`         | The request timed out (30 seconds by default)                                                                                                                                                                       |
| `UNKNOWN`         | Any other failed response                                                                                                                                                                                           |

If you get `INVALID_TOKEN`, check the API key in your VenaLabs dashboard, check that the token was created with the same API key, and make sure `getAccessToken` returns a fresh `token` string each time it is called.

## Security checklist

- Keep the API secret on your server. Never ship it to the browser or commit it to a repository.
- Issue tokens only to users you have authenticated.
- Serve your token endpoint over HTTPS.
- Access to the API is controlled by the API key and the access token. There is no domain allowlist to configure.

## Known limitations

See [Known limitations](../README.md#known-limitations) in the README.

## Support

- Documentation: https://venalabs.gitbook.io/venalabs-docs/
- Issues: https://github.com/VenaLabs/Stellar-SDK/issues
- Email: hello@venalabs.com
