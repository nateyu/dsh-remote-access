/**
 * One-at-a-time async chain. Failures do not stall later jobs.
 * @returns {{ serialize: <T>(fn: () => T | Promise<T>) => Promise<T> }}
 */
export function createSerial() {
  let tail = Promise.resolve()
  return {
    serialize(fn) {
      const run = tail.then(fn, fn)
      tail = run.then(() => {}, () => {})
      return run
    },
  }
}
