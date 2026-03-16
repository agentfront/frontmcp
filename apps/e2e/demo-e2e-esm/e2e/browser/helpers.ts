/**
 * @file helpers.ts
 * @description Playwright test helpers for ESM browser E2E tests.
 *
 * The browser app is served by Vite (configured in playwright.config.ts webServer).
 * These helpers provide shared constants and utilities for the test suite.
 */

/** Port for the local ESM package server */
export const ESM_SERVER_PORT = 50413;

/** Port for the Vite preview server */
export const VITE_PORT = 4402;
