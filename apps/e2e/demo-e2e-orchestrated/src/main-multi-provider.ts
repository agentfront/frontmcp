/**
 * Multi-Provider Orchestrated Auth Server
 *
 * This server configuration demonstrates local auth mode with multiple
 * upstream OAuth providers (GitHub, Slack) declared via the turnkey
 * `auth.providers` array. The provider issuers are injected via environment
 * variables so E2E tests can point them at the per-test MockOAuthServer.
 *
 * The federation contract:
 * - `auth.providers` declares the upstream OAuth providers to orchestrate.
 * - `federatedAuth.minProviders: 1` ⇒ no FrontMCP JWT until ≥1 provider linked.
 * - linking happens at /oauth/authorize → provider → /oauth/provider/:id/callback.
 * - tools read downstream tokens via `this.orchestration.getToken(id)`.
 */
import { FrontMcp, LogLevel, type UpstreamProviderOptions } from '@frontmcp/sdk';

import { GitHubApp } from './apps/github';
import { NotesApp } from './apps/notes';
import { TasksApp } from './apps/tasks';

// Get port from env variable (set by test runner) or default to 3122
const parsedPort = parseInt(process.env['PORT'] ?? '3122', 10);
const port = Number.isNaN(parsedPort) ? 3122 : parsedPort;

/**
 * Build the declarative upstream providers from environment variables. Each
 * MockOAuthServer exposes `/oauth/authorize` + `/oauth/token` under its issuer,
 * so we use the ergonomic `authorizeUrl`/`tokenUrl` aliases.
 */
function buildUpstreamProviders(): UpstreamProviderOptions[] {
  const providers: UpstreamProviderOptions[] = [];

  if (process.env['GITHUB_ISSUER']) {
    const issuer = process.env['GITHUB_ISSUER'];
    providers.push({
      id: 'github',
      name: 'GitHub',
      authorizeUrl: `${issuer}/oauth/authorize`,
      tokenUrl: `${issuer}/oauth/token`,
      userInfoEndpoint: `${issuer}/userinfo`,
      clientId: process.env['GITHUB_CLIENT_ID'] ?? 'github-client',
      clientSecret: process.env['GITHUB_CLIENT_SECRET'],
      scopes: ['read:user', 'repo'],
    });
  }

  if (process.env['SLACK_ISSUER']) {
    const issuer = process.env['SLACK_ISSUER'];
    providers.push({
      id: 'slack',
      name: 'Slack',
      authorizeUrl: `${issuer}/oauth/authorize`,
      tokenUrl: `${issuer}/oauth/token`,
      userInfoEndpoint: `${issuer}/userinfo`,
      clientId: process.env['SLACK_CLIENT_ID'] ?? 'slack-client',
      clientSecret: process.env['SLACK_CLIENT_SECRET'],
      scopes: ['users:read', 'chat:write'],
    });
  }

  return providers;
}

const upstreamProviders = buildUpstreamProviders();

@FrontMcp({
  info: { name: 'Demo Multi-Provider Orchestrated Auth', version: '0.1.0' },
  apps: [NotesApp, TasksApp, GitHubApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'local',
    consent: {
      enabled: true,
      groupByApp: true,
      showDescriptions: true,
      allowSelectAll: true,
      requireSelection: true,
      rememberConsent: true,
    },
    tokenStorage: 'memory',
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
    // Turnkey multi-OAuth-provider orchestration.
    providers: upstreamProviders,
    // No JWT until at least one provider is linked.
    federatedAuth: { stateValidation: 'strict', minProviders: 1 },
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
