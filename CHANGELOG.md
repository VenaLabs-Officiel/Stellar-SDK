# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.1.0] - 2026-11-27

### Added

- `sorobanRpcUrl` prop to choose the Soroban RPC endpoint used for NFT minting
- `userKey` prop to reset the SDK session when the signed-in user changes
- `CERTIFICATE` steps are rendered and can be completed; unsupported checker types are flagged instead of failing silently
- `WalletNetworkInfo` type export
- `useStellarWallet()` also returns `network` and `getWalletNetwork()`
- `VenalabsApiError.serverCode` and the `VenalabsApiErrorBody` type
- `VenalabsStepType` includes `'CERTIFICATE'` and `VenalabsCheckerType` includes `'HYPERCORE'`: an exhaustive `switch` over these types needs a new case
- `sorobanRpcUrl` prop on `NftMintChecker`
- Error screens with a "Try Again" button when a course fails to load or to start
- "Record mint again" button when recording a confirmed mint has to be retried
- `LICENSE` file (MIT), matching the `license` field already declared in `package.json`
- `SECURITY.md`, `CONTRIBUTING.md` and `THIRD-PARTY-NOTICES.md`
- README sections: deployed contracts, known limitations, roadmap
- `stellarNetwork` prop documented in the README props table

### Changed

- **Behaviour change:** passing a new `getAccessToken` function no longer resets the session. In 2.0.1 a new function identity recreated the API client and dropped the cached token; the SDK now keeps both across renders. If your application switches users without unmounting the component, pass the new `userKey` prop, otherwise the previous user's token stays in use until it expires
- An invalid `stellarNetwork` value shows an error instead of silently falling back to testnet
- A `LINKED`, `BALANCE` or `TRANSACTION` checker without a network uses the `stellarNetwork` prop (default `TESTNET`) instead of the public network
- README and integration guide rewritten to describe the actual authentication flow (`POST /api/v1/sdk/auth/token`, response field `token`) and the props that exist in 2.0.1
- Documentation and code comments now refer to the VenaLabs dashboard
- CI runs lint, format check, type check, tests and build on Node.js 20, 22 and 24
- The repository moved to `github.com/VenaLabs-Officiel/Stellar-SDK`; the package is published from GitHub Actions with npm provenance
- The `types` export condition comes first and source maps are no longer published
- `package.json` declares `engines.node` as `>=20`

### Fixed

- NFT minting on the public network: the retired Soroban RPC endpoint is replaced by `https://mainnet.sorobanrpc.com`
- NFT minting: the transaction is confirmed on-chain before the mint is recorded, every Soroban RPC call has a timeout, and a lost `sendTransaction` answer is no longer reported as a failure
- NFT minting: a submitted transaction is tracked across page reloads and step changes, and "Verify & Complete" stays available whenever a mint may exist
- Wallet: `connect()` waits for the wallet selection, and linking is no longer blocked by the network selected in the wallet
- Stellar networks are resolved from a single place, tolerant to case and surrounding spaces in a checker network
- API client: only GET requests are retried, tokens are validated, concurrent token refreshes are shared and empty response bodies are accepted
- Errors: rejected actions are handled and refusals from the API are shown to the user
- Content: only `http(s)`, `mailto:` and `tel:` links and YouTube/Vimeo embeds are rendered; useful video URL parameters are kept
- Step content is remounted on step change; pending work is released when components unmount
- Checker verification: the `useCallback` hook is now called before the early return for `NFT_MINT` checkers, so the number of hooks no longer depends on the checker type

### Removed

- Documentation of things that do not exist in the SDK or the API: the `userToken` prop, integrator-signed JWTs, the allowed domain list and the `INVALID_API_SECRET` error code

## [2.0.1] - 2026-02-17

### Fixed

- Wallet linking for testnet and mainnet: linked wallet addresses are tracked per network
- `stellarNetwork` is passed to the built-in wallet connection again (default `TESTNET`)

## [2.0.0] - 2026-02-17

### Changed

- Mainnet handling: the Soroban RPC URL, network passphrase and explorer link used by checkers are resolved from the checker's network (`STELLAR_TESTNET` or `STELLAR_PUBLIC`)
- **Breaking:** `signMessage` and `signTransaction` returned by `useStellarWallet()` take a required `networkPassphrase` second argument
- **Breaking:** the `stellarNetwork` prop is no longer passed to the built-in wallet connection (restored in 2.0.1)

### Removed

- **Breaking:** `network` is removed from the value returned by `useStellarWallet()`

## [1.0.3] - 2026-02-03

### Changed

- Improved loading states

### Fixed

- Language handling

### Removed

- `CoursesView` and `CoursePlayer` components

## [1.0.2] - 2026-02-03

### Fixed

- Language of step content

## [1.0.1] - 2026-02-03

### Changed

- Default `lang` is now `'en'` (was `'fr'`)
- README improvements

### Fixed

- NFT mint

## [1.0.0] - 2026-02-03

### Added

- Initial release of @venalabs/stellar-sdk
- `VenalabsStellarSDK` main component with full course display functionality
- `MapView` component for interactive course map navigation
- `CoursesView` component for course listing
- `CourseDetailView` component for detailed course information
- `StepView` component for step-by-step course progression
- Support for `fr` (French) and `en` (English) languages
- JWT-based user authentication
- Stellar wallet integration via `@creit.tech/stellar-wallets-kit`
- Support for TESTNET and PUBLIC Stellar networks
- NFT minting checker for course completion verification
- Wallet linking functionality
- Comprehensive error handling with user-friendly messages
- TypeScript support with full type definitions
- CSS styling with customizable variables
- External wallet kit support for host applications with existing Stellar integration
