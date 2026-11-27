/**
 * Promise-based delay, kept in its own module so tests can replace it.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
