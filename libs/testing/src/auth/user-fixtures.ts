/**
 * @file user-fixtures.ts
 * @description Pre-defined test user fixtures
 */

export interface TestUserFixture {
  /** User subject ID */
  sub: string;
  /** User email */
  email?: string;
  /** User display name */
  name?: string;
  /** OAuth scopes */
  scopes: string[];
  /** User role */
  role?: string;
}

/**
 * Pre-defined test users for common testing scenarios
 */
export const TestUsers: Record<string, TestUserFixture> = {
  /**
   * Admin user with full access
   */
  admin: {
    sub: 'admin-001',
    email: 'admin@test.local',
    name: 'Test Admin',
    scopes: ['admin:*', 'read', 'write', 'delete'],
    role: 'admin',
  },

  /**
   * Regular user with read/write access
   */
  user: {
    sub: 'user-001',
    email: 'user@test.local',
    name: 'Test User',
    scopes: ['read', 'write'],
    role: 'user',
  },

  /**
   * Read-only user
   */
  readOnly: {
    sub: 'readonly-001',
    email: 'readonly@test.local',
    name: 'Read Only User',
    scopes: ['read'],
    role: 'readonly',
  },

  /**
   * Anonymous user
   */
  anonymous: {
    sub: 'anon:001',
    name: 'Anonymous',
    scopes: ['anonymous'],
    role: 'anonymous',
  },

  /**
   * User with no scopes (for testing access denied)
   */
  noScopes: {
    sub: 'noscopes-001',
    email: 'noscopes@test.local',
    name: 'No Scopes User',
    scopes: [],
    role: 'user',
  },

  /**
   * User with only tool execution scope
   */
  toolsOnly: {
    sub: 'toolsonly-001',
    email: 'toolsonly@test.local',
    name: 'Tools Only User',
    scopes: ['tools:execute'],
    role: 'user',
  },

  /**
   * User with only resource read scope
   */
  resourcesOnly: {
    sub: 'resourcesonly-001',
    email: 'resourcesonly@test.local',
    name: 'Resources Only User',
    scopes: ['resources:read'],
    role: 'user',
  },
};

/**
 * Create a custom test user
 */
export function createTestUser(overrides: Partial<TestUserFixture> & { sub: string }): TestUserFixture {
  return {
    scopes: [],
    ...overrides,
  };
}
