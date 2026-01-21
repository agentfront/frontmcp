/**
 * Multi-Provider Orchestrated Auth Server
 *
 * This server configuration demonstrates orchestrated mode with multiple
 * upstream OAuth providers (GitHub, Slack). The providers are configured
 * via environment variables to allow E2E tests to inject mock server URLs.
 */
import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { NotesApp } from './apps/notes';
import { TasksApp } from './apps/tasks';
import { GitHubApp } from './apps/github';

// Get port from env variable (set by test runner) or default to 3122
const parsedPort = parseInt(process.env['PORT'] ?? '3122', 10);
const port = Number.isNaN(parsedPort) ? 3122 : parsedPort;

// Build upstream providers from environment variables
function buildUpstreamProviders() {
  const providers: Array<{
    id: string;
    issuer: string;
    clientId: string;
    clientSecret?: string;
    scopes: string[];
  }> = [];

  // GitHub provider
  if (process.env['GITHUB_ISSUER']) {
    providers.push({
      id: 'github',
      issuer: process.env['GITHUB_ISSUER'],
      clientId: process.env['GITHUB_CLIENT_ID'] ?? 'github-client',
      clientSecret: process.env['GITHUB_CLIENT_SECRET'],
      scopes: ['read:user', 'repo'],
    });
  }

  // Slack provider
  if (process.env['SLACK_ISSUER']) {
    providers.push({
      id: 'slack',
      issuer: process.env['SLACK_ISSUER'],
      clientId: process.env['SLACK_CLIENT_ID'] ?? 'slack-client',
      clientSecret: process.env['SLACK_CLIENT_SECRET'],
      scopes: ['users:read', 'chat:write'],
    });
  }

  return providers;
}

// Note: Upstream providers are available via environment variables for E2E testing.
// The actual provider configuration (GITHUB_ISSUER, SLACK_ISSUER) is used by the
// MockOAuthServer in tests, not directly by this server config.
// TODO: Add federatedLogin to orchestratedLocalSchema when full implementation is ready.
const _upstreamProviders = buildUpstreamProviders();

@FrontMcp({
  info: { name: 'Demo Multi-Provider Orchestrated Auth', version: '0.1.0' },
  apps: [NotesApp, TasksApp, GitHubApp],
  logging: { level: LogLevel.Verbose },
  http: { port },
  auth: {
    mode: 'orchestrated',
    type: 'local',
    consent: {
      enabled: true,
      groupByApp: true,
      showDescriptions: true,
      allowSelectAll: true,
      requireSelection: true,
      rememberConsent: true,
    },
    tokenStorage: {
      type: 'memory',
    },
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    sessionMode: 'stateful',
    protocol: {
      sse: true,
      streamable: true,
      json: true,
      stateless: false,
      legacy: false,
      strictSession: false,
    },
  },
})
export default class MultiProviderServer {}
