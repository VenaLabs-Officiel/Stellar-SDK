# Contributing

Thanks for your interest in `@venalabs/stellar-sdk`.

## Prerequisites

- Node.js 20 or later
- npm

## Setup

```bash
git clone https://github.com/VenaLabs-Officiel/Stellar-SDK.git
cd Stellar-SDK
npm ci
```

## Checks

Run these before opening a pull request. The CI workflow runs the same commands.

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

`npm run lint:fix` and `npm run format` fix most lint and formatting issues automatically.

## Pull requests

- Open pull requests against `main`.
- Keep each pull request focused on one change and describe what it does and why.
- Add or update tests when you change behaviour.
- Add an entry under `[Unreleased]` in [CHANGELOG.md](./CHANGELOG.md) for user-facing changes.

## Reporting issues

Use [GitHub issues](https://github.com/VenaLabs-Officiel/Stellar-SDK/issues) for bugs and feature requests. For security issues, follow [SECURITY.md](./SECURITY.md) instead.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
