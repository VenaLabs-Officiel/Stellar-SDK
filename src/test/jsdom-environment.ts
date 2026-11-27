/**
 * Vitest environment: jsdom with Node's native AbortController / AbortSignal.
 *
 * The built-in jsdom environment replaces the global AbortController and
 * AbortSignal with jsdom's own implementations. Node's native `fetch`
 * (undici) only accepts a native AbortSignal, so every request made with a
 * signal fails with "Expected signal to be an instance of AbortSignal".
 * This wrapper sets up jsdom as usual, then puts the native classes back.
 */

import type { Environment } from 'vitest';
import { builtinEnvironments } from 'vitest/environments';

const jsdom = builtinEnvironments.jsdom;

const environment: Environment = {
  name: 'jsdom-native-abort',
  transformMode: 'web',
  async setup(global, options) {
    const nativeAbortController = globalThis.AbortController;
    const nativeAbortSignal = globalThis.AbortSignal;

    const env = await jsdom.setup(global, options);

    Object.assign(global, {
      AbortController: nativeAbortController,
      AbortSignal: nativeAbortSignal,
    });

    return env;
  },
};

export default environment;
