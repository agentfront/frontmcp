// Tests that exercise execute-action.tool.ts branches reachable only when
// `executeOperation` itself throws (e.g. an unexpected programming error in
// the runtime that escapes its internal try/catch). The runtime is mocked so
// we can drive the catch+rethrow path deterministically without depending on
// internal failure modes.

import 'reflect-metadata';

import { BundleStore, SkillAuditWriterToken } from '@frontmcp/adapters/skills';
import { ScopeEntry } from '@frontmcp/sdk';

import { MemoryCredentialResolver } from '../executor/credential-resolver';
import { executeOperation } from '../executor/openapi-runtime';
import { clearCompiledSchemaCache } from '../executor/schema-cache';
import { HiddenOpRegistry, type HiddenOpEntry } from '../registry/hidden-op.registry';
import { AuthorityGuard } from '../security/authority-guard';
import { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from '../skilled-openapi.symbols';
import { BundleSyncService } from '../sync/bundle-sync.service';
import ExecuteActionTool from '../tools/execute-action.tool';

jest.mock('../executor/openapi-runtime', () => ({
  executeOperation: jest.fn(),
}));

const mockExecuteOperation = executeOperation as jest.MockedFunction<typeof executeOperation>;

beforeEach(() => {
  clearCompiledSchemaCache();
  mockExecuteOperation.mockReset();
});

const fakeLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

const buildEntry = (skillId: string, actionId: string): HiddenOpEntry => ({
  skillId,
  bundleId: 'test:bundle',
  bundleVersion: 'v1',
  service: { id: 'svc', baseUrl: 'http://localhost:9999' },
  authBinding: { kind: 'none' },
  op: {
    operationId: actionId,
    serviceId: 'svc',
    httpMethod: 'POST',
    pathTemplate: '/v1/x',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    mapper: [],
    authBindingRef: 'def',
  },
});

const baseConfig = () =>
  new SkilledOpenApiConfig({
    source: { type: 'static', path: '/none', watch: false },
    requireSignature: false,
    trustedKeys: [],
    dev: false,
    outbound: {
      allowPrivateNetworks: true,
      maxConcurrencyPerHost: 10,
      defaultTimeoutMs: 5_000,
      defaultMaxResponseBytes: 256 * 1024,
      allowHttp: true,
    },
    sourceConflictPolicy: 'static-wins',
  } as never);

function makeCtx(args: { hiddenOps: HiddenOpRegistry; auditWriter?: unknown; bundleStore?: BundleStore }) {
  const map = new Map<unknown, unknown>();
  map.set(BundleSyncService, {});
  map.set(SkilledOpenApiConfig, baseConfig());
  map.set(HiddenOpRegistry, args.hiddenOps);
  map.set(BundleStore, args.bundleStore ?? new BundleStore());
  map.set(AuthorityGuard, new AuthorityGuard());
  map.set(
    SkilledOpenApiCredentialResolver,
    new MemoryCredentialResolver({ tok: 'sk_x' }) as unknown as SkilledOpenApiCredentialResolver,
  );
  map.set(ScopeEntry, { logger: fakeLogger, skills: {} });
  if (args.auditWriter) map.set(SkillAuditWriterToken, args.auditWriter);

  return {
    get: <T>(token: unknown): T => map.get(token) as T,
    tryGet: <T>(token: unknown): T | undefined => (map.has(token) ? (map.get(token) as T) : undefined),
    logger: fakeLogger,
    authInfo: { user: { sub: 'u' } },
    progress: jest.fn(async () => false),
  } as unknown as ExecuteActionTool;
}

describe('execute_action — runtime-throw audit branches', () => {
  it('emits http-call-failure audit and re-throws when executeOperation itself throws', async () => {
    const hiddenOps = new HiddenOpRegistry();
    hiddenOps.set(buildEntry('billing', 'createInvoice'));

    const writeHttpCallFailure = jest.fn(() => Promise.resolve());
    const auditWriter = {
      writeAuthorityFail: jest.fn(() => Promise.resolve()),
      writeAuthorityPass: jest.fn(() => Promise.resolve()),
      writeHttpCallSuccess: jest.fn(() => Promise.resolve()),
      writeHttpCallFailure,
    };

    mockExecuteOperation.mockRejectedValueOnce(new Error('runtime exploded'));

    const ctx = makeCtx({ hiddenOps, auditWriter });
    await expect(
      ExecuteActionTool.prototype.execute.call(ctx, {
        skillId: 'billing',
        actionId: 'createInvoice',
        input: {},
      }),
    ).rejects.toThrow(/runtime exploded/);

    expect(writeHttpCallFailure).toHaveBeenCalledTimes(1);
    const [, extras] = writeHttpCallFailure.mock.calls[0] as unknown as [unknown, { status: number; error: Error }];
    expect(extras).toMatchObject({ status: 0 });
    expect(extras.error.message).toMatch(/runtime exploded/);
  });

  it('rethrows runtime errors WITHOUT auditing when auditWriter is absent', async () => {
    const hiddenOps = new HiddenOpRegistry();
    hiddenOps.set(buildEntry('billing', 'createInvoice'));

    mockExecuteOperation.mockRejectedValueOnce(new Error('boom'));

    const ctx = makeCtx({ hiddenOps }); // no auditWriter
    await expect(
      ExecuteActionTool.prototype.execute.call(ctx, {
        skillId: 'billing',
        actionId: 'createInvoice',
        input: {},
      }),
    ).rejects.toThrow(/boom/);
  });
});
