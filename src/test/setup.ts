/**
 * Test setup file for vitest
 *
 * Loaded for every test file. The browser mocks below are only installed when
 * a DOM is available (jsdom component tests); API tests run in plain Node.
 */

import '@testing-library/jest-dom';

if (typeof window !== 'undefined') {
  // Mock window.matchMedia for components that use it
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  // Mock ResizeObserver for components that use it
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  window.ResizeObserver = ResizeObserverMock;
}
