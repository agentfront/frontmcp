import { Skill } from '../../common/decorators/skill.decorator';
import { SkillKind } from '../../common/records/skill.record';
import type { SkillEsmTargetRecord, SkillRemoteRecord } from '../../common/records/skill.record';
import { normalizeSkill, isSkillRecord, skillDiscoveryDeps } from '../skill.utils';

describe('Skill.esm()', () => {
  it('creates SkillEsmTargetRecord with kind ESM', () => {
    const record = (Skill as any).esm('@acme/skills@^1.0.0', 'deploy') as SkillEsmTargetRecord;
    expect(record.kind).toBe(SkillKind.ESM);
  });

  it('parses scoped specifier correctly', () => {
    const record = (Skill as any).esm('@acme/skills@^1.0.0', 'deploy') as SkillEsmTargetRecord;
    expect(record.specifier.scope).toBe('@acme');
    expect(record.specifier.name).toBe('skills');
    expect(record.specifier.fullName).toBe('@acme/skills');
    expect(record.specifier.range).toBe('^1.0.0');
  });

  it('parses unscoped specifier', () => {
    const record = (Skill as any).esm('my-skills@latest', 'review') as SkillEsmTargetRecord;
    expect(record.specifier.scope).toBeUndefined();
    expect(record.specifier.fullName).toBe('my-skills');
  });

  it('sets targetName', () => {
    const record = (Skill as any).esm('@acme/skills@^1.0.0', 'deploy') as SkillEsmTargetRecord;
    expect(record.targetName).toBe('deploy');
  });

  it('creates unique symbol provide token', () => {
    const record = (Skill as any).esm('@acme/skills@^1.0.0', 'deploy') as SkillEsmTargetRecord;
    expect(typeof record.provide).toBe('symbol');
    expect(record.provide.toString()).toContain('esm-skill:@acme/skills:deploy');
  });

  it('creates different symbols for different targets', () => {
    const r1 = (Skill as any).esm('@acme/skills@^1.0.0', 'deploy') as SkillEsmTargetRecord;
    const r2 = (Skill as any).esm('@acme/skills@^1.0.0', 'review') as SkillEsmTargetRecord;
    expect(r1.provide).not.toBe(r2.provide);
  });

  it('passes options through', () => {
    const record = (Skill as any).esm('@acme/skills@^1.0.0', 'deploy', {
      cacheTTL: 180000,
    }) as SkillEsmTargetRecord;
    expect(record.options?.cacheTTL).toBe(180000);
  });

  it('generates placeholder metadata', () => {
    const record = (Skill as any).esm('@acme/skills@^1.0.0', 'deploy') as SkillEsmTargetRecord;
    expect(record.metadata.name).toBe('deploy');
    expect(record.metadata.description).toContain('deploy');
    expect(record.metadata.description).toContain('@acme/skills');
  });

  it('allows overriding metadata via options', () => {
    const record = (Skill as any).esm('@acme/skills@^1.0.0', 'deploy', {
      metadata: { description: 'Custom deploy skill' },
    }) as SkillEsmTargetRecord;
    expect(record.metadata.description).toBe('Custom deploy skill');
    expect(record.metadata.name).toBe('deploy');
  });

  it('throws on empty specifier', () => {
    expect(() => (Skill as any).esm('', 'deploy')).toThrow('Package specifier cannot be empty');
  });

  it('throws on invalid specifier', () => {
    expect(() => (Skill as any).esm('!!!', 'deploy')).toThrow('Invalid package specifier');
  });
});

describe('Skill.remote()', () => {
  it('creates SkillRemoteRecord with kind REMOTE', () => {
    const record = (Skill as any).remote('https://api.example.com/mcp', 'audit') as SkillRemoteRecord;
    expect(record.kind).toBe(SkillKind.REMOTE);
  });

  it('sets url and targetName', () => {
    const record = (Skill as any).remote('https://api.example.com/mcp', 'audit') as SkillRemoteRecord;
    expect(record.url).toBe('https://api.example.com/mcp');
    expect(record.targetName).toBe('audit');
  });

  it('creates unique symbol provide token', () => {
    const record = (Skill as any).remote('https://api.example.com/mcp', 'audit') as SkillRemoteRecord;
    expect(typeof record.provide).toBe('symbol');
    expect(record.provide.toString()).toContain('remote-skill:https://api.example.com/mcp:audit');
  });

  it('passes transportOptions and remoteAuth', () => {
    const record = (Skill as any).remote('https://api.example.com/mcp', 'audit', {
      transportOptions: { timeout: 45000 },
      remoteAuth: { mode: 'static', credentials: { type: 'bearer', value: 'sk-123' } },
    }) as SkillRemoteRecord;
    expect(record.transportOptions).toEqual({ timeout: 45000 });
    expect(record.remoteAuth).toEqual({
      mode: 'static',
      credentials: { type: 'bearer', value: 'sk-123' },
    });
  });

  it('generates placeholder metadata', () => {
    const record = (Skill as any).remote('https://api.example.com/mcp', 'audit') as SkillRemoteRecord;
    expect(record.metadata.name).toBe('audit');
    expect(record.metadata.description).toContain('audit');
  });
});

describe('isSkillRecord() with ESM/REMOTE records', () => {
  it('recognizes SkillEsmTargetRecord', () => {
    const record = (Skill as any).esm('@acme/skills@^1.0.0', 'deploy') as SkillEsmTargetRecord;
    expect(isSkillRecord(record)).toBe(true);
  });

  it('recognizes SkillRemoteRecord', () => {
    const record = (Skill as any).remote('https://api.example.com/mcp', 'audit') as SkillRemoteRecord;
    expect(isSkillRecord(record)).toBe(true);
  });
});

describe('normalizeSkill() with ESM/REMOTE records', () => {
  it('passes through SkillEsmTargetRecord unchanged', () => {
    const record = (Skill as any).esm('@acme/skills@^1.0.0', 'deploy') as SkillEsmTargetRecord;
    const normalized = normalizeSkill(record);
    expect(normalized).toBe(record);
    expect(normalized.kind).toBe(SkillKind.ESM);
  });

  it('passes through SkillRemoteRecord unchanged', () => {
    const record = (Skill as any).remote('https://api.example.com/mcp', 'audit') as SkillRemoteRecord;
    const normalized = normalizeSkill(record);
    expect(normalized).toBe(record);
    expect(normalized.kind).toBe(SkillKind.REMOTE);
  });
});

describe('skillDiscoveryDeps() with ESM/REMOTE records', () => {
  it('returns empty array for ESM record', () => {
    const record = (Skill as any).esm('@acme/skills@^1.0.0', 'deploy') as SkillEsmTargetRecord;
    expect(skillDiscoveryDeps(record)).toEqual([]);
  });

  it('returns empty array for REMOTE record', () => {
    const record = (Skill as any).remote('https://api.example.com/mcp', 'audit') as SkillRemoteRecord;
    expect(skillDiscoveryDeps(record)).toEqual([]);
  });
});
