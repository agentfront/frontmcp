/**
 * @file perf-setup.ts
 * @description Jest setup file for performance tests
 *
 * This file is loaded via setupFilesAfterEnv in jest.perf.config.ts.
 * It sets up the environment for performance testing.
 */

import { isGcAvailable } from './metrics-collector';

// ═══════════════════════════════════════════════════════════════════
// GC AVAILABILITY CHECK
// ═══════════════════════════════════════════════════════════════════

if (!isGcAvailable()) {
  console.warn(
    '\n[PerfSetup] WARNING: Manual garbage collection is not available.\n' +
      'For accurate memory measurements, run Node.js with --expose-gc flag:\n' +
      '  node --expose-gc ./node_modules/.bin/jest\n' +
      'or add to jest.perf.config.ts:\n' +
      '  "testEnvironmentOptions": { "execArgv": ["--expose-gc"] }\n',
  );
}

// ═══════════════════════════════════════════════════════════════════
// GLOBAL TIMEOUT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

// Performance tests may take longer due to iteration loops
jest.setTimeout(120000); // 2 minutes default

// ═══════════════════════════════════════════════════════════════════
// CONSOLE OUTPUT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

// Suppress verbose output during tests unless DEBUG is set
if (process.env['DEBUG'] !== '1' && process.env['PERF_VERBOSE'] !== '1') {
  // Save original console methods at module level
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalDebug = console.debug;
  const originalWarn = console.warn;
  const originalError = console.error;

  beforeAll(() => {
    console.log = jest.fn();
    console.info = jest.fn();
    console.debug = jest.fn();
    console.warn = originalWarn;
    console.error = originalError;
  });

  afterAll(() => {
    // Restore original console methods
    console.log = originalLog;
    console.info = originalInfo;
    console.debug = originalDebug;
  });
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════

export {};
