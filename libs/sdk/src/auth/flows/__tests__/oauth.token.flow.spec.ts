/**
 * OAuth Token Flow — tolerant body parsing (#473)
 *
 * `/oauth/token` must accept the parameters whether the host body-parser
 * produced an object (clean Content-Type) OR left the raw body unparsed (e.g.
 * a hybrid `application/json, application/x-www-form-urlencoded` header that
 * stock express.json()/urlencoded() skipped — the MCP Inspector refresh).
 * On failure it must surface the actual zod issue, not an opaque message.
 */
import 'reflect-metadata';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { httpInputSchema, HttpJsonSchema, type FlowMetadata } from '../../../common';
import OauthTokenFlow from '../oauth.token.flow';

function createTokenMetadata(): FlowMetadata<'oauth:token'> {
  return {
    name: 'oauth:token',
    plan: {
      pre: ['parseInput', 'validateInput'],
      execute: [
        'handleAuthorizationCodeGrant',
        'handleRefreshTokenGrant',
        'handleAnonymousGrant',
        'buildTokenResponse',
      ],
      post: ['validateOutput'],
    },
    inputSchema: httpInputSchema,
    outputSchema: HttpJsonSchema,
    access: 'public',
    middleware: { method: 'POST', path: '/oauth/token' },
  } as FlowMetadata<'oauth:token'>;
}

function makeFlow(body: unknown, headers: Record<string, string> = {}) {
  const scope = createMockScopeEntry({ auth: { mode: 'local' } as any });
  const input = createMockHttpRequest({ method: 'POST', path: '/oauth/token', headers });
  // createMockHttpRequest forces body to null; set it explicitly.
  (input.request as any).body = body;
  return new OauthTokenFlow(createTokenMetadata(), input as any, scope, jest.fn(), new Map());
}

const validRefreshObject = { grant_type: 'refresh_token', refresh_token: 'r-123', client_id: 'c-1' };

describe('OAuth Token Flow — tolerant body parsing (#473)', () => {
  it('parses a clean pre-parsed object body (existing behavior)', async () => {
    const flow = makeFlow(validRefreshObject, { 'content-type': 'application/x-www-form-urlencoded' });
    const { output, state } = await runFlowStages(flow, ['parseInput']);
    expect(output).toBeUndefined();
    expect(state.grantType).toBe('refresh_token');
    expect(state.error).toBeUndefined();
  });

  it('parses a RAW urlencoded string body when the parser left it unparsed (hybrid Content-Type)', async () => {
    // Simulates a hybrid header that stock parsers skipped → raw string body.
    const raw = 'grant_type=refresh_token&refresh_token=r-123&client_id=c-1';
    const flow = makeFlow(raw, { 'content-type': 'application/json, application/x-www-form-urlencoded' });
    const { output, state } = await runFlowStages(flow, ['parseInput']);
    expect(output).toBeUndefined();
    expect(state.grantType).toBe('refresh_token');
    expect(state.body).toMatchObject(validRefreshObject);
  });

  it('parses a RAW JSON string body as a fallback', async () => {
    const raw = JSON.stringify(validRefreshObject);
    const flow = makeFlow(raw, { 'content-type': 'application/json' });
    const { output, state } = await runFlowStages(flow, ['parseInput']);
    expect(output).toBeUndefined();
    expect(state.grantType).toBe('refresh_token');
  });

  it('surfaces the actual zod issue (not an opaque message) on an empty body', async () => {
    const flow = makeFlow(undefined);
    const { state } = await runFlowStages(flow, ['parseInput']);
    expect(state.error).toBe('invalid_request');
    // The detail should mention the failing discriminator field, not just "Invalid request body".
    expect(state.errorDescription).toContain('Invalid request body (');
    expect(state.errorDescription.toLowerCase()).toContain('grant_type');
  });

  it('validateInput responds 400 carrying the surfaced zod detail', async () => {
    const flow = makeFlow({}); // empty object → discriminator missing
    const { output } = await runFlowStages(flow, ['parseInput', 'validateInput']);
    expect(output?.kind).toBe('json');
    expect(output.status).toBe(400);
    expect(output.body.error).toBe('invalid_request');
    expect(String(output.body.error_description)).toContain('grant_type');
  });

  it('reports the specific failing field for a malformed refresh request', async () => {
    // Missing refresh_token → zod should flag refresh_token, surfaced in the detail.
    const raw = 'grant_type=refresh_token&client_id=c-1';
    const flow = makeFlow(raw, { 'content-type': 'application/x-www-form-urlencoded' });
    const { state } = await runFlowStages(flow, ['parseInput']);
    expect(state.error).toBe('invalid_request');
    expect(state.errorDescription).toContain('refresh_token');
  });
});
