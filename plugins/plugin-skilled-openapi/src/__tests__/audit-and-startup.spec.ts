import { hasSkillAuditFactory, setSkillAuditFactory } from '@frontmcp/sdk';

import { executeSkillAction, type SkillActionDeps } from '../executor/execute-skill-action';
import { clearCompiledSchemaCache } from '../executor/schema-cache';
import type { HiddenOpEntry } from '../registry/hidden-op.registry';
import SkilledOpenApiPlugin from '../skilled-openapi.plugin';

const mockExecuteOperation = jest.fn();
jest.mock('../executor/openapi-runtime', () => ({
  executeOperation: (args: unknown) => mockExecuteOperation(args),
}));

const getThing: HiddenOpEntry = {
  skillId: 'content',
  bundleId: 'b1',
  bundleVersion: 'v1',
  service: { id: 'svc', baseUrl: 'https://api.example.com' },
  authBinding: { kind: 'none' },
  op: {
    operationId: 'getThing',
    serviceId: 'svc',
    httpMethod: 'GET',
    pathTemplate: '/things/{id}',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object', properties: { id: { type: 'number' } } },
    mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
    authBindingRef: 'def',
  },
};

function auditedDeps() {
  const writer = {
    writeAuthorityPass: jest.fn(async () => undefined),
    writeAuthorityFail: jest.fn(async () => undefined),
    writeHttpCallSuccess: jest.fn(async () => undefined),
    writeHttpCallFailure: jest.fn(async () => undefined),
  };
  const deps: SkillActionDeps = {
    config: {
      outbound: {
        allowHttp: false,
        allowPrivateNetworks: false,
        defaultTimeoutMs: 5000,
        defaultMaxResponseBytes: 262144,
        maxConcurrencyPerHost: 10,
      },
      unprotectedOps: 'allow',
    },
    resolver: { resolve: jest.fn(async () => undefined) },
    guard: { check: jest.fn(async () => ({ granted: true })) } as never,
    logger: { warn: jest.fn() } as never,
    audit: { writer: writer as never, subject: 'user-1' },
  };
  return { deps, writer };
}

describe('skill action audit records', () => {
  beforeEach(() => {
    mockExecuteOperation.mockReset();
    clearCompiledSchemaCache();
  });

  it('records an action whose input fails its schema as a failure', async () => {
    const { deps, writer } = auditedDeps();

    await executeSkillAction({ entry: getThing, input: { id: 'not-a-number' }, authInfo: {}, deps });

    expect(writer.writeHttpCallFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 0, error: expect.stringMatching(/input validation failed/) }),
    );
  });

  it('records an answer that fails outputSchema as a failure, not a success', async () => {
    const { deps, writer } = auditedDeps();
    mockExecuteOperation.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'wrong-type' },
      contentType: 'application/json',
    });

    await executeSkillAction({ entry: getThing, input: { id: 1 }, authInfo: {}, deps });

    expect(writer.writeHttpCallSuccess).not.toHaveBeenCalled();
    expect(writer.writeHttpCallFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 200, error: expect.stringMatching(/output schema/) }),
    );
  });
});

describe('SkilledOpenApiPlugin at startup', () => {
  afterEach(() => setSkillAuditFactory(undefined));

  it('registers the audit module, so skillsConfig.audit works without setSkillAuditFactory()', () => {
    setSkillAuditFactory(undefined);

    new SkilledOpenApiPlugin({ source: { type: 'static', path: '/x' } });

    expect(hasSkillAuditFactory()).toBe(true);
  });

  it('warns when allowPrivateNetworks is on', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      new SkilledOpenApiPlugin({ source: { type: 'static', path: '/x' }, outbound: { allowPrivateNetworks: true } });

      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/allowPrivateNetworks/));
    } finally {
      warn.mockRestore();
    }
  });
});
