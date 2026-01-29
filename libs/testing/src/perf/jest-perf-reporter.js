/**
 * Jest Performance Reporter (CommonJS wrapper)
 *
 * This file provides a CommonJS-compatible wrapper for the TypeScript reporter.
 * Jest loads reporters outside the normal transform pipeline, so we need this wrapper.
 */

// Register @swc-node for TypeScript support
require('@swc-node/register');

// Export the TypeScript reporter
// The .ts file uses module.exports for Jest compatibility
module.exports = require('./jest-perf-reporter.ts');
