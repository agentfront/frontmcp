/**
 * LOCAL-mode auth server exercising the #462 Dynamic Client Registration
 * control surface (`auth.dcr`).
 *
 * The `dcr` block is assembled from env so a single entry drives all E2E
 * scenarios without rebuilding:
 *   - DCR_ENABLED=false                 → POST /oauth/register responds 404 and
 *                                         AS metadata omits registration_endpoint
 *   - DCR_ALLOWED_REDIRECT_URIS=a,b     → redirect_uri allowlist (register +
 *                                         authorize reject anything not listed)
 *   - DCR_ALLOWED_CLIENT_IDS=a,b        → client_id allowlist at /oauth/authorize
 *   - DCR_INITIAL_ACCESS_TOKEN=tok      → POST /oauth/register requires
 *                                         `Authorization: Bearer tok`
 *   - DCR_PREREGISTERED=1               → seed a trusted pre-registered client
 *                                         (`preregistered-client`) accepted by
 *                                         authorize WITHOUT a DCR round-trip
 *
 * No PII is configured or stored — only OAuth client metadata.
 */
import { FrontMcp, LogLevel, type LocalDcrConfig } from '@frontmcp/sdk';

import { NotesApp } from './apps/notes';

const parsedPort = parseInt(process.env['PORT'] ?? '3157', 10);
const port = Number.isNaN(parsedPort) ? 3157 : parsedPort;

const PREREGISTERED_CLIENT_ID = 'preregistered-client';
const PREREGISTERED_REDIRECT_URI = 'http://127.0.0.1:9876/callback';

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

const dcr: LocalDcrConfig = {};
if (process.env['DCR_ENABLED'] === 'false') dcr.enabled = false;
if (process.env['DCR_ENABLED'] === 'true') dcr.enabled = true;
const allowedRedirectUris = splitCsv(process.env['DCR_ALLOWED_REDIRECT_URIS']);
if (allowedRedirectUris) dcr.allowedRedirectUris = allowedRedirectUris;
const allowedClientIds = splitCsv(process.env['DCR_ALLOWED_CLIENT_IDS']);
if (allowedClientIds) dcr.allowedClientIds = allowedClientIds;
if (process.env['DCR_INITIAL_ACCESS_TOKEN']) dcr.initialAccessToken = process.env['DCR_INITIAL_ACCESS_TOKEN'];
if (process.env['DCR_PREREGISTERED'] === '1') {
  dcr.clients = [
    {
      clientId: PREREGISTERED_CLIENT_ID,
      redirectUris: [PREREGISTERED_REDIRECT_URI],
      clientName: 'Pre-registered Dashboard',
    },
  ];
}

@FrontMcp({
  info: { name: 'Demo E2E Local Auth DCR', version: '0.1.0' },
  apps: [NotesApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'local',
    allowDefaultPublic: false,
    anonymousScopes: ['anonymous'],
    requireEmail: false,
    anonymousSubject: 'local-operator',
    dcr,
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
export default class Server {}
