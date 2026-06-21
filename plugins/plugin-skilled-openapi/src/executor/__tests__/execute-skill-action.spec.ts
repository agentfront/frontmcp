// Unit coverage for the shared skill-action executor that powers run_workflow's
// `callTool(actionId, input)` bridge: authorize → validate input → execute →
// validate output → envelope, plus opt-in audit. The outbound call
// (`executeOperation`) is mocked so these tests stay hermetic.
import { executeSkillAction, type SkillActionDeps } from '../execute-skill-action';
import { clearCompiledSchemaCache } from '../schema-cache';
import type { HiddenOpEntry } from '../../registry/hidden-op.registry';

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
      inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false },
      outputSchema: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' } } },
      mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
      requiredAuthorities: undefined,
      ...overrides,
    } as HiddenOpEntry['op'],
  };
}

function makeDeps(over: { granted?: boolean; deniedBy?: string; audit?: SkillActionDeps['audit'] } = {}): SkillActionDeps {
  return {
    config: { outbound: { allowHttp: false, allowPrivateNetworks: true, defaultTimeoutMs: 5000, defaultMaxResponseBytes: 262144, maxConcurrencyPerHost: 10 } as never },
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
    clearCompiledSchemaCache();
  });

  it('returns the data envelope on a successful, schema-valid call', async () => {
    mockExecuteOperation.mockResolvedValue({ ok: true, status: 200, data: { id: 1, name: 'thing' }, contentType: 'application/json' });
    const res = await executeSkillAction({ entry: makeEntry(), input: { id: 1 }, authInfo: {}, deps: makeDeps() });
    expect(res).toEqual({ ok: true, status: 200, data: { id: 1, name: 'thing' }, contentType: 'application/json' });
    expect(mockExecuteOperation).toHaveBeenCalledTimes(1);
  });

  it('denies when the authority guard rejects (executeOperation never runs)', async () => {
    const res = await executeSkillAction({
      entry: makeEntry({ requiredAuthorities: { allOf: ['admin'] } as never }),
      input: { id: 1 },
      authInfo: {},
      deps: makeDeps({ granted: false, deniedBy: 'missing admin' }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/authority denied: missing admin/);
    expect(mockExecuteOperation).not.toHaveBeenCalled();
  });

  it('rejects input that fails the op input schema (no outbound call)', async () => {
    const res = await executeSkillAction({ entry: makeEntry(), input: { id: 'not-a-number' }, authInfo: {}, deps: makeDeps() });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/input validation failed/);
    expect(mockExecuteOperation).not.toHaveBeenCalled();
  });

  it('rejects when the upstream JSON response fails the output schema', async () => {
    mockExecuteOperation.mockResolvedValue({ ok: true, status: 200, data: { id: 'wrong-type' }, contentType: 'application/json' });
    const res = await executeSkillAction({ entry: makeEntry(), input: { id: 1 }, authInfo: {}, deps: makeDeps() });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/output schema/);
  });

  it('passes an upstream ok:false envelope through unchanged (no output validation)', async () => {
    mockExecuteOperation.mockResolvedValue({ ok: false, status: 404, error: 'not found' });
    const res = await executeSkillAction({ entry: makeEntry(), input: { id: 1 }, authInfo: {}, deps: makeDeps() });
    expect(res).toMatchObject({ ok: false, status: 404, error: 'not found' });
  });

  it('writes audit records (authority-pass + http-call-success) when an audit writer is configured', async () => {
    mockExecuteOperation.mockResolvedValue({ ok: true, status: 200, data: { id: 1, name: 'x' }, contentType: 'application/json' });
    const writer = {
      writeAuthorityPass: jest.fn(async () => undefined),
      writeAuthorityFail: jest.fn(async () => undefined),
      writeHttpCallSuccess: jest.fn(async () => undefined),
      writeHttpCallFailure: jest.fn(async () => undefined),
    };
    const res = await executeSkillAction({
      entry: makeEntry(),
      input: { id: 1 },
      authInfo: {},
      deps: makeDeps({ audit: { writer: writer as never, subject: 'user-1' } }),
    });
    expect(res.ok).toBe(true);
    // Detached writes — allow microtasks to flush.
    await new Promise((r) => setTimeout(r, 0));
    expect(writer.writeAuthorityPass).toHaveBeenCalledTimes(1);
    expect(writer.writeHttpCallSuccess).toHaveBeenCalledTimes(1);
    expect(writer.writeAuthorityPass.mock.calls[0][0]).toMatchObject({ subject: 'user-1', actionId: 'getThing', skillId: 'content' });
  });

  it('audits authority-fail on denial', async () => {
    const writer = {
      writeAuthorityPass: jest.fn(async () => undefined),
      writeAuthorityFail: jest.fn(async () => undefined),
      writeHttpCallSuccess: jest.fn(async () => undefined),
      writeHttpCallFailure: jest.fn(async () => undefined),
    };
    await executeSkillAction({
      entry: makeEntry({ requiredAuthorities: { allOf: ['admin'] } as never }),
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
        entry: makeEntry(),
        input: { id: 1 },
        authInfo: {},
        deps: makeDeps({ audit: { writer: writer as never, subject: 'u' } }),
      }),
    ).rejects.toThrow('network down');
    await new Promise((r) => setTimeout(r, 0));
    expect(writer.writeHttpCallFailure).toHaveBeenCalledWith(expect.anything(), { status: 0, error: boom });
  });

  it('tolerates a malformed pinned service URL (allowedHosts stays empty)', async () => {
    mockExecuteOperation.mockResolvedValue({ ok: true, status: 200, data: { id: 1, name: 'x' }, contentType: 'application/json' });
    const entry = makeEntry();
    entry.service = { ...entry.service, baseUrl: 'http://[not a url' } as HiddenOpEntry['service'];
    const res = await executeSkillAction({ entry, input: { id: 1 }, authInfo: {}, deps: makeDeps() });
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
      entry: makeEntry(),
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

  it('logs a warning (never throws) when a detached audit write rejects', async () => {
    mockExecuteOperation.mockResolvedValue({ ok: true, status: 200, data: { id: 1, name: 'x' }, contentType: 'application/json' });
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
    const res = await executeSkillAction({ entry: makeEntry(), input: { id: 1 }, authInfo: {}, deps });
    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('authority-pass write failed'));
  });
});
