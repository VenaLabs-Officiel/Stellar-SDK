# Third-Party Notices

`@venalabs/stellar-sdk` is released under the [MIT License](./LICENSE).

The published bundle (`dist/`) is built with Vite in library mode. Only `react` and `react-dom` are marked as external, so the runtime dependencies below are included in the bundle. Each one remains under its own license.

| Package                           | License                                                                                 | Copyright notice                                                                                                                                                         | Source                                              |
| --------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `@stellar/stellar-sdk`            | Apache-2.0                                                                              | See the package's `LICENSE` file                                                                                                                                         | https://github.com/stellar/js-stellar-sdk           |
| `@creit.tech/stellar-wallets-kit` | MIT (from the package's `LICENSE` file; its `package.json` declares no `license` field) | Copyright (c) 2023 Creit Technologies LLP.                                                                                                                               | https://github.com/Creit-Tech/Stellar-Wallets-Kit   |
| `lucide-react`                    | ISC                                                                                     | Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022. | https://github.com/lucide-icons/lucide              |
| `react-zoom-pan-pinch`            | MIT                                                                                     | Copyright (c) 2019 prc5                                                                                                                                                  | https://github.com/BetterTyped/react-zoom-pan-pinch |
| `zustand`                         | MIT                                                                                     | Copyright (c) 2019 Paul Henschel                                                                                                                                         | https://github.com/pmndrs/zustand                   |

Licenses were read from each package's `package.json` and `LICENSE` file, at the versions resolved by `package-lock.json` when this file was written: `@stellar/stellar-sdk` 14.6.1, `@creit.tech/stellar-wallets-kit` 1.9.5, `lucide-react` 0.400.0, `react-zoom-pan-pinch` 3.7.0, `zustand` 4.5.7.

These packages have dependencies of their own, which may also end up in the bundle. They are not listed here. The full license text of every installed package is available in its directory under `node_modules/` after `npm ci`.

`react` and `react-dom` are peer dependencies and are not included in the bundle.
