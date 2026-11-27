# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `LICENSE` file (MIT), matching the `license` field already declared in `package.json`
- `SECURITY.md`, `CONTRIBUTING.md` and `THIRD-PARTY-NOTICES.md`
- README sections: deployed contracts, known limitations, roadmap, support
- `stellarNetwork` prop documented in the README props table

### Changed

- README and integration guide rewritten to describe the actual authentication flow (`POST /api/v1/sdk/auth/token`, response field `token`) and the props that exist in 2.0.1
- Documentation and code comments now refer to the VenaLabs dashboard
- CI runs lint, format check, type check, tests and build on Node.js 20 and 22

### Removed

- Documentation of things that do not exist in the SDK or the API: the `userToken` prop, integrator-signed JWTs, the allowed domain list and the `INVALID_API_SECRET` error code

## [2.0.1] - 2026-02-17

### Fixed

- Wallet linking for testnet and mainnet: linked wallet addresses are tracked per network
- `stellarNetwork` is passed to the built-in wallet connection again (default `TESTNET`)

## [2.0.0] - 2026-02-17

### Changed

- Mainnet handling: the Soroban RPC URL, network passphrase and explorer link used by checkers are resolved from the checker's network (`STELLAR_TESTNET` or `STELLAR_PUBLIC`)

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

- README improvements

### Fixed

- NFT mint
- `StellarNetwork` type values are `'TESTNET' | 'PUBLIC'`

## [1.0.0] - 2026-01-22

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
