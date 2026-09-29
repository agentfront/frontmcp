/**
 * SessionVerifyFlow — anonymous session id must be server-controlled.
 *
 * Regression for the anonymous transport-session hijack/fixation finding: all
 * anonymous sessions share `token: ''`, so the transport registry separates
 * them by session id alone. The flow used to echo ANY client-supplied
 * `mcp-session-id` back verbatim, letting an attacker fixate a chosen id or
 * present a victim's leaked id to resolve the victim's transport. A forged /
 * unrecognized id must now be ignored and a fresh server-minted id issued.
 */
import 'reflect-metadata';

import { encryptJson, resetCachedKey } from '@frontmcp/auth';
import { getMachineId, setMachineIdOverride } from '@frontmcp/utils';

import { createMockHttpRequest, createMockScopeEntry, runFlowStages } from '../../../__test-utils__';
import { httpRequestInputSchema, type FlowMetadata } from '../../../common';
import SessionVerifyFlow, { sessionVerifyOutputSchema } from '../session.verify.flow';

function createMetadata(): FlowMetadata<'session:verify'> {
  return {
    name: 'session:verify',
    plan: { pre: ['parseInput', 'handlePublicMode'], execute: [] },
    inputSchema: httpRequestInputSchema,
    outputSchema: sessionVerifyOutputSchema,
    access: 'authorized',
  } as unknown as FlowMetadata<'session:verify'>;
}

function runPublic(headers: Record<string, string>) {
  const scope = createMockScopeEntry({ auth: { mode: 'public' } as never });
  (scope.auth as unknown as Record<string, unknown>)['options'] = { mode: 'public' };
  const input = createMockHttpRequest({ method: 'POST', path: '/', headers });
  const flow = new SessionVerifyFlow(createMetadata(), input as never, scope, jest.fn(), new Map());
  return runFlowStages(flow, ['parseInput', 'handlePublicMode']);
}

describe('SessionVerifyFlow — anonymous session id is server-controlled', () => {
  it('ignores a forged client-supplied session id and mints a fresh one', async () => {
    const { output } = await runPublic({ 'mcp-session-id': 'attacker-chosen-id' });

    expect(output?.kind).toBe('authorized');
    if (output?.kind !== 'authorized') return;
    // The forged id must NOT be echoed back; a server-minted (encrypted) id is issued.
    expect(output.authorization.session?.id).toBeDefined();
    expect(output.authorization.session?.id).not.toBe('attacker-chosen-id');
    // A fresh server-minted session always has a payload; the forged one had none.
    expect(output.authorization.session?.payload).toBeDefined();
    expect(output.authorization.token).toBe('');
  });

  it('ignores a forged id supplied via the SSE ?sessionId= query param too', async () => {
    const scope = createMockScopeEntry({ auth: { mode: 'public' } as never });
    (scope.auth as unknown as Record<string, unknown>)['options'] = { mode: 'public' };
    const input = createMockHttpRequest({ method: 'GET', path: '/', query: { sessionId: 'attacker-via-query' } });
    const flow = new SessionVerifyFlow(createMetadata(), input as never, scope, jest.fn(), new Map());
    const { output } = await runFlowStages(flow, ['parseInput', 'handlePublicMode']);

    expect(output?.kind).toBe('authorized');
    if (output?.kind !== 'authorized') return;
    expect(output.authorization.session?.id).not.toBe('attacker-via-query');
  });

  it('honors a genuine server-minted session id when re-presented (same node)', async () => {
    // First contact (no id) → server mints an encrypted id + payload.
    const first = await runPublic({});
    expect(first.output?.kind).toBe('authorized');
    if (first.output?.kind !== 'authorized') return;
    const mintedId = first.output.authorization.session?.id as string;
    expect(mintedId).toBeTruthy();

    // Re-presenting that genuine id is honored verbatim (session continuity).
    const second = await runPublic({ 'mcp-session-id': mintedId });
    expect(second.output?.kind).toBe('authorized');
    if (second.output?.kind !== 'authorized') return;
    expect(second.output.authorization.session?.id).toBe(mintedId);
    expect(second.output.authorization.session?.payload).toBeDefined();
  });

  it('derives distinct anon subs for two genuine sessions (no same-second collision)', async () => {
    const a = await runPublic({});
    const b = await runPublic({});
    if (a.output?.kind !== 'authorized' || b.output?.kind !== 'authorized') throw new Error('not authorized');
    // Both minted fresh sessions with unique uuids → distinct subs even within the same second.
    expect(a.output.authorization.user.sub).not.toBe(b.output.authorization.user.sub);
  });

  it('keeps the anon sub a session started with when the session is resumed', async () => {
    const first = await runPublic({});
    if (first.output?.kind !== 'authorized') throw new Error('not authorized');
    const mintedId = first.output.authorization.session?.id as string;

    const second = await runPublic({ 'mcp-session-id': mintedId });
    if (second.output?.kind !== 'authorized') throw new Error('not authorized');

    // A `sub`-keyed partition (rate limits, per-caller state) must not split between the first
    // request and the rest of the session.
    expect(first.output.authorization.user.sub).toMatch(/^anon:/);
    expect(second.output.authorization.user.sub).toBe(first.output.authorization.user.sub);
  });
});

describe('SessionVerifyFlow — anonymous sessions across secrets and instances', () => {
  const originalSecret = process.env['MCP_SESSION_SECRET'];

  function useSessionSecret(secret: string | undefined): void {
    if (secret === undefined) delete process.env['MCP_SESSION_SECRET'];
    else process.env['MCP_SESSION_SECRET'] = secret;
    resetCachedKey();
  }

  function publicPayload(nodeId: string) {
    return {
      uuid: '5b0d6a52-2c8e-4c4b-9d1b-7f3a0c1e2d44',
      nodeId,
      authSig: 'public',
      iat: Math.floor(Date.now() / 1000),
      isPublic: true,
      authMode: 'public',
    };
  }

  afterEach(() => {
    setMachineIdOverride(undefined);
    useSessionSecret(originalSecret);
  });

  it('ignores an id minted under a different MCP_SESSION_SECRET and mints a fresh one', async () => {
    useSessionSecret('secret-of-another-deployment');
    const foreignId = encryptJson(publicPayload(getMachineId()));

    useSessionSecret('this-deployment-secret');
    const { output } = await runPublic({ 'mcp-session-id': foreignId });

    expect(output?.kind).toBe('authorized');
    if (output?.kind !== 'authorized') return;
    expect(output.authorization.session?.id).toBeDefined();
    expect(output.authorization.session?.id).not.toBe(foreignId);
    expect(output.authorization.session?.payload?.nodeId).toBe(getMachineId());
  });

  it('honors an id minted by another instance that shares the secret', async () => {
    // Node affinity is the transport registry's job (it keys takeover off the
    // STORED session's nodeId); the AES-GCM tag already proves this deployment
    // minted the id.
    useSessionSecret('shared-deployment-secret');
    setMachineIdOverride('instance-a');
    const first = await runPublic({});
    if (first.output?.kind !== 'authorized') throw new Error('not authorized');
    const mintedOnA = first.output.authorization.session?.id as string;
    expect(first.output.authorization.session?.payload?.nodeId).toBe('instance-a');

    setMachineIdOverride('instance-b');
    const second = await runPublic({ 'mcp-session-id': mintedOnA });

    expect(second.output?.kind).toBe('authorized');
    if (second.output?.kind !== 'authorized') return;
    expect(second.output.authorization.session?.id).toBe(mintedOnA);
    expect(second.output.authorization.session?.payload?.nodeId).toBe('instance-a');
    expect(second.output.authorization.user.sub).toBe(first.output.authorization.user.sub);
  });

  it('honors an id minted before a restart that changed the machine id', async () => {
    useSessionSecret('shared-deployment-secret');
    const beforeRestart = encryptJson(publicPayload('previous-process'));

    const { output } = await runPublic({ 'mcp-session-id': beforeRestart });

    expect(output?.kind).toBe('authorized');
    if (output?.kind !== 'authorized') return;
    expect(output.authorization.session?.id).toBe(beforeRestart);
  });
});
