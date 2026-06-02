/**
 * OAuth Dynamic Client Registration Flow Tests (#462)
 *
 * Covers the local-AS DCR control surface enforced by POST /oauth/register:
 * - default behavior (no `dcr` config) → localhost-style registration works (201)
 * - `dcr.enabled === false` → 404 (endpoint behaves as if absent)
 * - `dcr.initialAccessToken` → 401 without/with-wrong bearer, 201 with the right one
 * - `dcr.allowedRedirectUris` → 400 invalid_redirect_uri when unlisted
 * - registering writes the client into the per-instance DcrClientRegistry
 */
import 'reflect-metadata';

import { DcrClientRegistry, type DcrRegistryConfig } from '@frontmcp/auth';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { httpInputSchema, HttpJsonSchema, type FlowMetadata } from '../../../common';
import OauthRegisterFlow from '../oauth.register.flow';

function createRegisterMetadata(): FlowMetadata<'oauth:register'> {
  return {
    name: 'oauth:register',
    plan: {
      pre: ['parseInput', 'validateInput'],
      execute: ['registerClient', 'respondRegistration'],
      post: ['validateOutput'],
    },
    inputSchema: httpInputSchema,
    outputSchema: HttpJsonSchema,
    access: 'public',
    middleware: { method: 'POST', path: '/oauth/register' },
  } as FlowMetadata<'oauth:register'>;
}

/**
 * Build a scope whose `auth` is a DCR-aware stub backed by a real
 * {@link DcrClientRegistry}, mirroring the LocalPrimaryAuth surface the flow
 * consumes. `enabled === undefined` exercises the historical dev/prod default.
 */
function createDcrScope(dcr?: DcrRegistryConfig & { enabled?: boolean }) {
  const scope = createMockScopeEntry({ auth: { mode: 'local' } as never });
  const registry = new DcrClientRegistry(dcr ?? {});
  const auth = scope.auth as unknown as Record<string, unknown>;
  auth['dcrClientRegistry'] = registry;
  auth['getDcrConfig'] = () => dcr;
  auth['isDcrEnabled'] = () => (dcr && typeof dcr.enabled === 'boolean' ? dcr.enabled : true);
  return { scope, registry };
}

function registerInput(body: Record<string, unknown>, headers?: Record<string, string>) {
  return createMockHttpRequest({ method: 'POST', path: '/oauth/register', headers, body });
}

const STAGES = ['parseInput', 'validateInput', 'registerClient', 'respondRegistration'];

describe('OAuth Register Flow (#462 DCR)', () => {
  describe('default behavior (no dcr config)', () => {
    it('registers a localhost client and returns 201 with a client_id', async () => {
      const { scope, registry } = createDcrScope();
      const flow = new OauthRegisterFlow(
        createRegisterMetadata(),
        registerInput({ redirect_uris: ['http://localhost:8080/cb'] }),
        scope,
        jest.fn(),
        new Map(),
      );

      const { output } = await runFlowStages(flow, STAGES);
      expect(output.kind).toBe('json');
      expect(output.status).toBe(201);
      expect(typeof output.body.client_id).toBe('string');
      // The minted client is recorded in the registry for the authorize/token flows.
      expect(registry.has(output.body.client_id)).toBe(true);
    });

    it('rejects a non-localhost redirect_uri (400 invalid_redirect_uri)', async () => {
      const { scope } = createDcrScope();
      const flow = new OauthRegisterFlow(
        createRegisterMetadata(),
        registerInput({ redirect_uris: ['https://evil.example.com/cb'] }),
        scope,
        jest.fn(),
        new Map(),
      );

      const { output } = await runFlowStages(flow, STAGES);
      expect(output.status).toBe(400);
      expect(output.body.error).toBe('invalid_redirect_uri');
    });
  });

  describe('dcr.enabled === false', () => {
    it('responds 404 and does not register', async () => {
      const { scope, registry } = createDcrScope({ enabled: false });
      const flow = new OauthRegisterFlow(
        createRegisterMetadata(),
        registerInput({ redirect_uris: ['http://localhost:8080/cb'] }),
        scope,
        jest.fn(),
        new Map(),
      );

      const { output } = await runFlowStages(flow, STAGES);
      expect(output.status).toBe(404);
      expect(output.body.error).toBe('access_denied');
      // Nothing was registered.
      expect((registry as unknown as { clients: Map<string, unknown> }).clients.size).toBe(0);
    });
  });

  describe('dcr.initialAccessToken', () => {
    it('returns 401 when the Authorization bearer is missing', async () => {
      const { scope } = createDcrScope({ initialAccessToken: 'iat-secret' });
      const flow = new OauthRegisterFlow(
        createRegisterMetadata(),
        registerInput({ redirect_uris: ['http://localhost:8080/cb'] }),
        scope,
        jest.fn(),
        new Map(),
      );

      const { output } = await runFlowStages(flow, STAGES);
      expect(output.status).toBe(401);
      expect(output.body.error).toBe('invalid_token');
    });

    it('returns 401 when the bearer token is wrong', async () => {
      const { scope } = createDcrScope({ initialAccessToken: 'iat-secret' });
      const flow = new OauthRegisterFlow(
        createRegisterMetadata(),
        registerInput({ redirect_uris: ['http://localhost:8080/cb'] }, { authorization: 'Bearer nope' }),
        scope,
        jest.fn(),
        new Map(),
      );

      const { output } = await runFlowStages(flow, STAGES);
      expect(output.status).toBe(401);
    });

    it('returns 201 when the correct bearer token is presented', async () => {
      const { scope, registry } = createDcrScope({ initialAccessToken: 'iat-secret' });
      const flow = new OauthRegisterFlow(
        createRegisterMetadata(),
        registerInput({ redirect_uris: ['http://localhost:8080/cb'] }, { authorization: 'Bearer iat-secret' }),
        scope,
        jest.fn(),
        new Map(),
      );

      const { output } = await runFlowStages(flow, STAGES);
      expect(output.status).toBe(201);
      expect(registry.has(output.body.client_id)).toBe(true);
    });
  });

  describe('dcr.allowedRedirectUris', () => {
    it('rejects a redirect_uri not on the allowlist (400)', async () => {
      const { scope } = createDcrScope({ allowedRedirectUris: ['https://app.example.com/cb'] });
      const flow = new OauthRegisterFlow(
        createRegisterMetadata(),
        registerInput({ redirect_uris: ['https://other.example.com/cb'] }),
        scope,
        jest.fn(),
        new Map(),
      );

      const { output } = await runFlowStages(flow, STAGES);
      expect(output.status).toBe(400);
      expect(output.body.error).toBe('invalid_redirect_uri');
    });

    it('accepts a redirect_uri on the allowlist even when not localhost (201)', async () => {
      const { scope } = createDcrScope({ allowedRedirectUris: ['https://app.example.com/cb'] });
      const flow = new OauthRegisterFlow(
        createRegisterMetadata(),
        registerInput({ redirect_uris: ['https://app.example.com/cb'] }),
        scope,
        jest.fn(),
        new Map(),
      );

      const { output } = await runFlowStages(flow, STAGES);
      expect(output.status).toBe(201);
    });
  });

  describe('dcr.allowedClientIds without pre-registered clients', () => {
    it('rejects DCR with 400 (cannot satisfy a client-id allowlist via DCR)', async () => {
      const { scope } = createDcrScope({ allowedClientIds: ['dashboard'] });
      const flow = new OauthRegisterFlow(
        createRegisterMetadata(),
        registerInput({ redirect_uris: ['http://localhost:8080/cb'] }),
        scope,
        jest.fn(),
        new Map(),
      );

      const { output } = await runFlowStages(flow, STAGES);
      expect(output.status).toBe(400);
      expect(output.body.error).toBe('access_denied');
    });
  });
});
