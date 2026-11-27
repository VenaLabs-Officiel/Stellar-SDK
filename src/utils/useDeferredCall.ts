/**
 * Delayed call that does not outlive its component.
 */

import { useCallback, useEffect, useRef } from 'react';

interface PendingCall {
  timer: ReturnType<typeof setTimeout>;
  run: () => void;
}

/**
 * Return a function that runs a callback after a delay.
 *
 * When the component unmounts before the delay has elapsed, the timer is
 * cleared and the callback runs at once instead of being dropped: it carries
 * the completion of a verified step, which must not be lost because the user
 * left the step during the delay. Scheduling a new call replaces the pending
 * one.
 */
export function useDeferredCall(): (callback: () => void, delayMs: number) => void {
  const pendingRef = useRef<PendingCall | null>(null);

  useEffect(() => {
    return () => {
      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        clearTimeout(pending.timer);
        pending.run();
      }
    };
  }, []);

  return useCallback((callback: () => void, delayMs: number) => {
    if (pendingRef.current) {
      clearTimeout(pendingRef.current.timer);
    }
    const timer = setTimeout(() => {
      pendingRef.current = null;
      callback();
    }, delayMs);
    pendingRef.current = { timer, run: callback };
  }, []);
}
