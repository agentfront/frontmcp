/**
 * Security Test Entry Point for OpenAPI Adapter E2E Tests
 *
 * This server is configured with staticAuth to test that Authorization headers
 * are correctly sent to backend APIs.
 */
import { FrontMcp, App, LogLevel } from '@frontmcp/sdk';
import { OpenapiAdapter } from '@frontmcp/adapters';

const port = parseInt(process.env['PORT'] ?? '3122', 10);
const apiBaseUrl = process.env['OPENAPI_BASE_URL'] || 'http://localhost:3000';
const openapiUrl = process.env['OPENAPI_SPEC_URL'] || `${apiBaseUrl}/openapi.json`;
const staticJwt = process.env['STATIC_AUTH_JWT'];

@App({
  name: 'Security-Test',
  description: 'Security test app for OpenAPI adapter with staticAuth',
  adapters: [
    OpenapiAdapter.init({
      name: 'secured-api',
      url: openapiUrl,
      baseUrl: apiBaseUrl,
      // Use staticAuth with JWT from environment variable
      staticAuth: staticJwt ? { jwt: staticJwt } : undefined,
    }),
  ],
})
class SecurityTestApp {}

@FrontMcp({
  info: { name: 'Demo E2E OpenAPI Security', version: '0.1.0' },
  apps: [SecurityTestApp],
  logging: { level: LogLevel.Verbose },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: {
      sse: true,
      streamable: true,
      json: true,
      stateless: false,
      legacy: true,
      strictSession: false,
    },
  },
})
export default class Server {}
