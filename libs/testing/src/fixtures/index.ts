/**
 * @file index.ts
 * @description Barrel exports for test fixtures
 */

export { test } from './test-fixture';
export type {
  TestConfig,
  TestFixtures,
  AuthFixture,
  ServerFixture,
  TestFn,
  TestWithFixtures,
  TestUser,
} from './fixture-types';

// Advanced exports for custom setups
export {
  createTestFixtures,
  cleanupTestFixtures,
  initializeSharedResources,
  cleanupSharedResources,
} from './test-fixture';
