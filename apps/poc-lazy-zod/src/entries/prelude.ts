/**
 * Captured BEFORE any schema module evaluates.
 * ES module evaluation is depth-first left-to-right, so as long as the
 * entry file imports this module before importing the schemas module,
 * this top-level assignment runs first. That's the whole point: we want
 * coldStart = (time after schemas module finished evaluating) - (this).
 */
export const __t0: bigint = process.hrtime.bigint();
