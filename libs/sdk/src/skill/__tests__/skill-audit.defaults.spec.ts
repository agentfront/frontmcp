import 'reflect-metadata';

import { skillsConfigAuditOptionsSchema } from '../../common/types/options/skills-http/schema';
import { registerSkillAuditWriter, setSkillAuditFactory, type AuditModuleShape } from '../skill-audit.helper';

const logger = () => ({ warn: jest.fn(), verbose: jest.fn() }) as never;
const providers = () => ({ injectProvider: jest.fn() }) as never;

class FakeWriter {
  static lastOptions: unknown;
  constructor(_store: unknown, _signer: unknown, _logger: unknown, _metrics: unknown, options: unknown) {
    FakeWriter.lastOptions = options;
  }
}

const auditModule: AuditModuleShape = {
  SkillAuditWriterToken: Symbol.for('test:audit-defaults'),
  SkillAuditWriter: FakeWriter as never,
  Hs256AuditSigner: class {} as never,
  MemoryAuditStore: class {} as never,
};

describe('skill audit registration defaults', () => {
  const previousNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    process.env['NODE_ENV'] = previousNodeEnv;
    setSkillAuditFactory(undefined);
  });

  it('does not suggest that a signer and store replace the audit module', () => {
    process.env['NODE_ENV'] = 'development';
    const log = logger() as unknown as { warn: jest.Mock };
    registerSkillAuditWriter({
      providers: providers(),
      audit: { enabled: true, signer: {}, store: {} },
      logger: log as never,
    });

    expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(/supply a signer \+ store/);
    expect(JSON.stringify(log.warn.mock.calls)).toMatch(/plugin-skilled-openapi registers it/);
  });

  it('refuses the in-memory store in production, as it refuses the default signer', () => {
    process.env['NODE_ENV'] = 'production';
    setSkillAuditFactory(() => auditModule);

    expect(() =>
      registerSkillAuditWriter({ providers: providers(), audit: { enabled: true, signer: {} }, logger: logger() }),
    ).toThrow(/Configure skillsConfig\.audit\.store with a persistent store, e\.g\. new StorageAdapterAuditStore/);
  });

  it('keeps the in-memory store, with a warning, outside production', () => {
    process.env['NODE_ENV'] = 'development';
    setSkillAuditFactory(() => auditModule);
    const log = logger() as unknown as { warn: jest.Mock };

    registerSkillAuditWriter({ providers: providers(), audit: { enabled: true, signer: {} }, logger: log as never });

    expect(JSON.stringify(log.warn.mock.calls)).toMatch(/using in-memory store/);
  });

  it('does not check the store in production while audit is off', () => {
    process.env['NODE_ENV'] = 'production';
    setSkillAuditFactory(() => auditModule);

    expect(() =>
      registerSkillAuditWriter({ providers: providers(), audit: { enabled: false }, logger: logger() }),
    ).not.toThrow();
  });

  it('keeps subjectHashSecret in skillsConfig.audit and hands it to the writer', () => {
    setSkillAuditFactory(() => auditModule);
    const audit = skillsConfigAuditOptionsSchema.parse({
      enabled: true,
      signer: {},
      store: {},
      subjectHashSecret: 'host-managed-subject-key-0123456789',
    });

    registerSkillAuditWriter({ providers: providers(), audit, logger: logger() });

    expect(FakeWriter.lastOptions).toEqual({
      subjectHashSecret: new TextEncoder().encode('host-managed-subject-key-0123456789'),
    });
  });

  it.each([
    ['a short string', 'too-short'],
    ['a short byte array', new Uint8Array(16)],
  ])('refuses %s as subjectHashSecret', (_label, subjectHashSecret) => {
    expect(skillsConfigAuditOptionsSchema.safeParse({ enabled: true, subjectHashSecret }).success).toBe(false);
  });

  it('accepts a 32-byte array as subjectHashSecret', () => {
    expect(
      skillsConfigAuditOptionsSchema.safeParse({ enabled: true, subjectHashSecret: new Uint8Array(32) }).success,
    ).toBe(true);
  });
});
