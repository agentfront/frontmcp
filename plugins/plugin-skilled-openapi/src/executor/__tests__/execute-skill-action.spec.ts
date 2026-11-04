// Unit coverage for the shared skill-action executor that powers run_workflow's
// `callTool(actionId, input)` bridge: authorize → validate input → execute →
// validate output → envelope, plus opt-in audit. The outbound call
// (`executeOperation`) is mocked so these tests stay hermetic.
import type { HiddenOpEntry, OperationListings } from '../../registry/hidden-op.registry';
import { AuthorityGuard, type UnprotectedOpsPolicy } from '../../security/authority-guard';
import { authorizeAction, executeSkillAction, type SkillActionDeps } from '../execute-skill-action';

const mockExecuteOperation = jest.fn();
jest.mock('../openapi-runtime', () => ({
  executeOperation: (args: unknown) => mockExecuteOperation(args),
}));

function makeEntry(overrides: Partial<HiddenOpEntry['op']> = {}): HiddenOpEntry {
  return {
    skillId: 'content',
    bundleId: 'b1',
    bundleVersion: 'v1',
    service: { id: 'svc', baseUrl: 'https://api.example.com', description: '' } as HiddenOpEntry['service'],
    authBinding: { kind: 'none' } as HiddenOpEntry['authBinding'],
    op: {
      operationId: 'getThing',
      serviceId: 'svc',
      httpMethod: 'GET',
      pathTemplate: '/things/{id}',
      summary: 'Get a thing',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' } } },
      mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
      requiredAuthorities: undefined,
      ...overrides,
    } as HiddenOpEntry['op'],
  };
}

function makeDeps(
  over: {
    granted?: boolean;
    deniedBy?: string;
    audit?: SkillActionDeps['audit'];
    confirm?: SkillActionDeps['config']['confirm'];
    confirmAction?: SkillActionDeps['confirmAction'];
  } = {},
): SkillActionDeps & { bundleStore: unknown } {
  return {
    config: {
      outbound: {
        allowHttp: false,
        allowPrivateNetworks: true,
        defaultTimeoutMs: 5000,
        defaultMaxResponseBytes: 262144,
        maxConcurrencyPerHost: 10,
      },
      ...(over.confirm ? { confirm: over.confirm } : {}),
    } as SkillActionDeps['config'],
    confirmAction: over.confirmAction ?? jest.fn(async () => undefined),
    resolver: { resolve: jest.fn(async () => undefined) as never },
    guard: { check: jest.fn(async () => ({ granted: over.granted ?? true, deniedBy: over.deniedBy })) } as never,
    bundleStore: { current: () => undefined } as never,
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), child: () => ({ warn: jest.fn() }) } as never,
    ...(over.audit ? { audit: over.audit } : {}),
  };
}

describe('executeSkillAction', () => {
  beforeEach(() => {
    mockExecuteOperation.mockReset();
  });

  it('returns the data envelope on a successful, schema-valid call', async () => {
    mockExecuteOperation.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 1, name: 'thing' },
      contentType: 'application/json',
    });
    const res = await executeSkillAction({ listings: [makeEntry()], input: { id: 1 }, authInfo: {}, deps: makeDeps() });
    expect(res).toEqual({ ok: true, status: 200, data: { id: 1, name: 'thing' }, contentType: 'application/json' });
    expect(mockExecuteOperation).toHaveBeenCalledTimes(1);
  });

  it('denies when the authority guard rejects (executeOperation never runs)', async () => {
    const res = await executeSkillAction({
      listings: [makeEntry({ requiredAuthorities: { allOf: ['admin'] } as never })],
      input: { id: 1 },
      authInfo: {},
      deps: makeDeps({ granted: false, deniedBy: 'missing admin' }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/authority denied: missing admin/);
    expect(mockExecuteOperation).not.toHaveBeenCalled();
  });

  it('rejects input that fails the op input schema (no outbound call)', async () => {
    const res = await executeSkillAction({
      listings: [makeEntry()],
      input: { id: 'not-a-number' },
      authInfo: {},
      deps: makeDeps(),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/input validation failed/);
    expect(mockExecuteOperation).not.toHaveBeenCalled();
  });

  it('rejects when the upstream JSON response fails the output schema', async () => {
    mockExecuteOperation.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'wrong-type' },
      contentType: 'application/json',
    });
    const res = await executeSkillAction({ listings: [makeEntry()], input: { id: 1 }, authInfo: {}, deps: makeDeps() });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/output schema/);
  });

  it('reports a bodyless JSON answer (a 204) as a success, without checking it against the output schema', async () => {
    mockExecuteOperation.mockResolvedValue({ ok: true, status: 204, data: null, contentType: 'application/json' });

    const res = await executeSkillAction({ listings: [makeEntry()], input: { id: 1 }, authInfo: {}, deps: makeDeps() });

    expect(res).toEqual({ ok: true, status: 204, contentType: 'application/json' });
  });

  it('passes an upstream ok:false envelope through unchanged (no output validation)', async () => {
    mockExecuteOperation.mockResolvedValue({ ok: false, status: 404, error: 'not found' });
    const res = await executeSkillAction({ listings: [makeEntry()], input: { id: 1 }, authInfo: {}, deps: makeDeps() });
    expect(res).toMatchObject({ ok: false, status: 404, error: 'not found' });
  });

  it('writes audit records (authority-pass + http-call-success) when an audit writer is configured', async () => {
    mockExecuteOperation.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 1, name: 'x' },
      contentType: 'application/json',
    });
    const writer = {
      writeAuthorityPass: jest.fn(async (_record: unknown) => undefined),
      writeAuthorityFail: jest.fn(async () => undefined),
      writeHttpCallSuccess: jest.fn(async () => undefined),
      writeHttpCallFailure: jest.fn(async () => undefined),
    };
    const res = await executeSkillAction({
      listings: [makeEntry()],
      input: { id: 1 },
      authInfo: {},
      deps: makeDeps({ audit: { writer: writer as never, subject: 'user-1' } }),
    });
    expect(res.ok).toBe(true);
    // Detached writes — allow microtasks to flush.
    await new Promise((r) => setTimeout(r, 0));
    expect(writer.writeAuthorityPass).toHaveBeenCalledTimes(1);
    expect(writer.writeHttpCallSuccess).toHaveBeenCalledTimes(1);
    expect(writer.writeAuthorityPass.mock.calls[0][0]).toMatchObject({
      subject: 'user-1',
      actionId: 'getThing',
      skillId: 'content',
    });
  });

  it('audits authority-fail on denial', async () => {
    const writer = {
      writeAuthorityPass: jest.fn(async () => undefined),
      writeAuthorityFail: jest.fn(async () => undefined),
      writeHttpCallSuccess: jest.fn(async () => undefined),
      writeHttpCallFailure: jest.fn(async () => undefined),
    };
    await executeSkillAction({
      listings: [makeEntry({ requiredAuthorities: { allOf: ['admin'] } as never })],
      input: { id: 1 },
      authInfo: {},
      deps: makeDeps({ granted: false, deniedBy: 'nope', audit: { writer: writer as never, subject: 'u' } }),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(writer.writeAuthorityFail).toHaveBeenCalledTimes(1);
    expect(writer.writeHttpCallSuccess).not.toHaveBeenCalled();
  });

  it('rethrows when the outbound call throws, after a detached http-call-failure audit', async () => {
    const boom = new Error('network down');
    mockExecuteOperation.mockRejectedValue(boom);
    const writer = {
      writeAuthorityPass: jest.fn(async () => undefined),
      writeAuthorityFail: jest.fn(async () => undefined),
      writeHttpCallSuccess: jest.fn(async () => undefined),
      writeHttpCallFailure: jest.fn(async () => undefined),
    };
    await expect(
      executeSkillAction({
        listings: [makeEntry()],
        input: { id: 1 },
        authInfo: {},
        deps: makeDeps({ audit: { writer: writer as never, subject: 'u' } }),
      }),
    ).rejects.toThrow('network down');
    await new Promise((r) => setTimeout(r, 0));
    expect(writer.writeHttpCallFailure).toHaveBeenCalledWith(expect.anything(), { status: 0, error: boom });
  });

  it('tolerates a malformed pinned service URL (allowedHosts stays empty)', async () => {
    mockExecuteOperation.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 1, name: 'x' },
      contentType: 'application/json',
    });
    const entry = makeEntry();
    entry.service = { ...entry.service, baseUrl: 'http://[not a url' } as HiddenOpEntry['service'];
    const res = await executeSkillAction({ listings: [entry], input: { id: 1 }, authInfo: {}, deps: makeDeps() });
    expect(res.ok).toBe(true);
    const passed = mockExecuteOperation.mock.calls[0][0] as { deps: { allowedHosts: Set<string> } };
    expect(passed.deps.allowedHosts.size).toBe(0);
  });

  it('audits an upstream ok:false with a synthesized message when the envelope has no error', async () => {
    mockExecuteOperation.mockResolvedValue({ ok: false, status: 503 });
    const writer = {
      writeAuthorityPass: jest.fn(async () => undefined),
      writeAuthorityFail: jest.fn(async () => undefined),
      writeHttpCallSuccess: jest.fn(async () => undefined),
      writeHttpCallFailure: jest.fn(async () => undefined),
    };
    const res = await executeSkillAction({
      listings: [makeEntry()],
      input: { id: 1 },
      authInfo: {},
      deps: makeDeps({ audit: { writer: writer as never, subject: 'u' } }),
    });
    expect(res).toMatchObject({ ok: false, status: 503 });
    expect(res.error).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(writer.writeHttpCallFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 503, error: 'http call failed with status 503' }),
    );
  });

  it('sends the request under the signal of the workflow that made the call', async () => {
    mockExecuteOperation.mockResolvedValue({ ok: true, status: 200, data: { id: 1 }, contentType: 'application/json' });
    const workflowEnded = new AbortController();

    await executeSkillAction({
      listings: [makeEntry()],
      input: { id: 1 },
      authInfo: {},
      signal: workflowEnded.signal,
      deps: makeDeps(),
    });

    expect(mockExecuteOperation).toHaveBeenCalledWith(expect.objectContaining({ signal: workflowEnded.signal }));
  });

  it('logs a warning (never throws) when a detached audit write rejects', async () => {
    mockExecuteOperation.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 1, name: 'x' },
      contentType: 'application/json',
    });
    const warn = jest.fn();
    const writer = {
      writeAuthorityPass: jest.fn(async () => {
        throw new Error('audit backend down');
      }),
      writeAuthorityFail: jest.fn(async () => undefined),
      writeHttpCallSuccess: jest.fn(async () => undefined),
      writeHttpCallFailure: jest.fn(async () => undefined),
    };
    const deps = makeDeps({ audit: { writer: writer as never, subject: 'u' } });
    (deps.logger as unknown as { warn: jest.Mock }).warn = warn;
    const res = await executeSkillAction({ listings: [makeEntry()], input: { id: 1 }, authInfo: {}, deps });
    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('authority-pass write failed'));
  });
});

describe('executeSkillAction: an action the confirm option names', () => {
  const DELETES = { methods: ['DELETE' as const], whenUnsupported: 'refuse' as const };
  const deleteThing = () => makeEntry({ operationId: 'deleteThing', httpMethod: 'DELETE' });

  beforeEach(() => {
    mockExecuteOperation.mockReset();
    mockExecuteOperation.mockResolvedValue({ ok: true, status: 204 });
    clearCompiledSchemaCache();
  });

  it('asks with the listing and the validated input after authorization, and sends the request once confirmed', async () => {
    const confirmAction = jest.fn(async () => undefined);
    const entry = deleteThing();

    const res = await executeSkillAction({
      listings: [entry],
      input: { id: 7 },
      authInfo: {},
      deps: makeDeps({ confirm: DELETES, confirmAction }),
    });

    expect(res).toEqual({ ok: true, status: 204 });
    expect(confirmAction).toHaveBeenCalledWith({ entry, input: { id: 7 } });
    expect(mockExecuteOperation).toHaveBeenCalledTimes(1);
  });

  it('fails a refused call with the reason, sending nothing, and audits it as a failed call', async () => {
    const writer = {
      writeAuthorityPass: jest.fn(async () => undefined),
      writeAuthorityFail: jest.fn(async () => undefined),
      writeHttpCallSuccess: jest.fn(async () => undefined),
      writeHttpCallFailure: jest.fn(async () => undefined),
    };
    const deps = makeDeps({
      confirm: DELETES,
      confirmAction: jest.fn(async () => 'the user declined: deleteThing'),
      audit: { writer: writer as never, subject: 'u' },
    });

    const res = await executeSkillAction({ listings: [deleteThing()], input: { id: 7 }, authInfo: {}, deps });

    expect(res).toEqual({ ok: false, status: 0, error: 'the user declined: deleteThing' });
    expect(mockExecuteOperation).not.toHaveBeenCalled();
    expect(writer.writeAuthorityPass).toHaveBeenCalledTimes(1);
    expect(writer.writeHttpCallFailure).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'deleteThing' }), {
      status: 0,
      error: 'the user declined: deleteThing',
    });
    expect(writer.writeHttpCallSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ['the caller is denied', { granted: false, deniedBy: 'role:admin' }, { id: 7 }],
    ['the input is invalid', {}, { id: 'seven' }],
  ])('does not ask when %s', async (_case, guard, input) => {
    const confirmAction = jest.fn(async () => undefined);

    const res = await executeSkillAction({
      listings: [deleteThing()],
      input,
      authInfo: {},
      deps: makeDeps({ ...guard, confirm: DELETES, confirmAction }),
    });

    expect(res.ok).toBe(false);
    expect(confirmAction).not.toHaveBeenCalled();
    expect(mockExecuteOperation).not.toHaveBeenCalled();
  });

  it('does not ask for an action no rule names, nor when there is no confirm option', async () => {
    const confirmAction = jest.fn(async () => undefined);

    await executeSkillAction({
      listings: [makeEntry()],
      input: { id: 1 },
      authInfo: {},
      deps: makeDeps({ confirm: DELETES, confirmAction }),
    });
    await executeSkillAction({
      listings: [deleteThing()],
      input: { id: 1 },
      authInfo: {},
      deps: makeDeps({ confirmAction }),
    });

    expect(confirmAction).not.toHaveBeenCalled();
    expect(mockExecuteOperation).toHaveBeenCalledTimes(2);
  });
});

describe('authorizeAction: an operation several skills list', () => {
  const ADMIN = { roles: { any: ['admin'] } };
  const VIEWER = { user: { iss: 'test', sub: 'viewer', roles: ['viewer'] } };

  const listing = (
    skillId: string,
    skillRequiredAuthorities?: HiddenOpEntry['skillRequiredAuthorities'],
    op: Partial<HiddenOpEntry['op']> = {},
  ): HiddenOpEntry => ({
    ...makeEntry(op),
    skillId,
    ...(skillRequiredAuthorities ? { skillRequiredAuthorities } : {}),
  });

  const authorize = (listings: OperationListings, unprotectedOps: UnprotectedOpsPolicy = 'allow') =>
    authorizeAction({ listings, guard: new AuthorityGuard(), unprotectedOps, authInfo: VIEWER, input: { id: 1 } });

  it.each([
    ['the admin skill first', [listing('billing-admin', ADMIN), listing('invoices')]],
    ['the public skill first', [listing('invoices'), listing('billing-admin', ADMIN)]],
  ] as const)('runs under the skill that admits the caller, with %s', async (_order, listings) => {
    const { entry, result } = await authorize(listings);

    expect(result.granted).toBe(true);
    expect(entry.skillId).toBe('invoices');
  });

  it("returns the first listing's denial when no listing admits the caller", async () => {
    const { entry, result } = await authorize([
      listing('billing-admin', ADMIN),
      listing('finance', { roles: { any: ['finance'] } }),
    ]);

    expect(result.granted).toBe(false);
    expect(result.deniedBy).toEqual(expect.any(String));
    expect(entry.skillId).toBe('billing-admin');
  });

  it("applies the operation's own rule under every listing", async () => {
    const { result } = await authorize([listing('invoices', undefined, { requiredAuthorities: ADMIN })]);

    expect(result.granted).toBe(false);
  });

  it('keeps unprotectedOps "deny" and public: true as they are for one listing', async () => {
    const denied = await authorize([listing('invoices'), listing('billing-admin', ADMIN)], 'deny');
    const allowed = await authorize(
      [listing('invoices', undefined, { public: true }), listing('billing-admin', ADMIN, { public: true })],
      'deny',
    );

    expect(denied.result).toMatchObject({ granted: false, deniedBy: 'unprotected_operation_denied' });
    expect(allowed.result.granted).toBe(true);
    expect(allowed.entry.skillId).toBe('invoices');
  });

  it('audits the call under the skill that admitted the caller', async () => {
    mockExecuteOperation.mockResolvedValue({ ok: true, status: 200, data: { id: 1 }, contentType: 'application/json' });
    const writer = {
      writeAuthorityPass: jest.fn(async (_record: unknown) => undefined),
      writeAuthorityFail: jest.fn(async () => undefined),
      writeHttpCallSuccess: jest.fn(async (_record: unknown) => undefined),
      writeHttpCallFailure: jest.fn(async () => undefined),
    };
    const deps = {
      ...makeDeps({ audit: { writer: writer as never, subject: 'viewer' } }),
      guard: new AuthorityGuard(),
    };

    const res = await executeSkillAction({
      listings: [listing('billing-admin', ADMIN), listing('invoices')],
      input: { id: 1 },
      authInfo: VIEWER,
      deps,
    });

    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(writer.writeAuthorityPass.mock.calls[0][0]).toMatchObject({ skillId: 'invoices', actionId: 'getThing' });
    expect(writer.writeHttpCallSuccess.mock.calls[0][0]).toMatchObject({ skillId: 'invoices' });
  });
});
