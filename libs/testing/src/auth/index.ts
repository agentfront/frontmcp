/**
 * @file auth/index.ts
 * @description Auth testing utilities exports
 */

export { TestTokenFactory } from '@frontmcp/auth/testing';
export type { CreateTokenOptions, TokenFactoryOptions } from '@frontmcp/auth/testing';

export { AuthHeaders } from './auth-headers';

export { TestUsers, createTestUser } from './user-fixtures';
export type { TestUserFixture } from './user-fixtures';

export { MockOAuthServer } from '@frontmcp/auth/testing';
export type { MockOAuthServerOptions, MockOAuthServerInfo, MockTestUser } from '@frontmcp/auth/testing';
