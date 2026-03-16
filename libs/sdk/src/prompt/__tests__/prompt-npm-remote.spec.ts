import { Prompt } from '../../common/decorators/prompt.decorator';
import { PromptKind } from '../../common/records/prompt.record';
import type { PromptEsmTargetRecord, PromptRemoteRecord } from '../../common/records/prompt.record';
import { normalizePrompt, promptDiscoveryDeps } from '../prompt.utils';

describe('Prompt.esm()', () => {
  it('creates PromptEsmTargetRecord with kind ESM', () => {
    const record = Prompt.esm('@acme/tools@^1.0.0', 'greeting') as PromptEsmTargetRecord;
    expect(record.kind).toBe(PromptKind.ESM);
  });

  it('parses scoped specifier correctly', () => {
    const record = Prompt.esm('@acme/tools@^1.0.0', 'greeting') as PromptEsmTargetRecord;
    expect(record.specifier.scope).toBe('@acme');
    expect(record.specifier.name).toBe('tools');
    expect(record.specifier.fullName).toBe('@acme/tools');
    expect(record.specifier.range).toBe('^1.0.0');
  });

  it('parses unscoped specifier', () => {
    const record = Prompt.esm('prompts-lib@2.0.0', 'welcome') as PromptEsmTargetRecord;
    expect(record.specifier.scope).toBeUndefined();
    expect(record.specifier.fullName).toBe('prompts-lib');
    expect(record.specifier.range).toBe('2.0.0');
  });

  it('sets targetName', () => {
    const record = Prompt.esm('@acme/tools@^1.0.0', 'greeting') as PromptEsmTargetRecord;
    expect(record.targetName).toBe('greeting');
  });

  it('creates unique symbol provide token', () => {
    const record = Prompt.esm('@acme/tools@^1.0.0', 'greeting') as PromptEsmTargetRecord;
    expect(typeof record.provide).toBe('symbol');
    expect(record.provide.toString()).toContain('esm-prompt:@acme/tools:greeting');
  });

  it('creates different symbols for different targets', () => {
    const r1 = Prompt.esm('@acme/tools@^1.0.0', 'greeting') as PromptEsmTargetRecord;
    const r2 = Prompt.esm('@acme/tools@^1.0.0', 'farewell') as PromptEsmTargetRecord;
    expect(r1.provide).not.toBe(r2.provide);
  });

  it('passes options through', () => {
    const record = Prompt.esm('@acme/tools@^1.0.0', 'greeting', {
      cacheTTL: 120000,
    }) as PromptEsmTargetRecord;
    expect(record.options?.cacheTTL).toBe(120000);
  });

  it('generates placeholder metadata with arguments array', () => {
    const record = Prompt.esm('@acme/tools@^1.0.0', 'greeting') as PromptEsmTargetRecord;
    expect(record.metadata.name).toBe('greeting');
    expect(record.metadata.description).toContain('greeting');
    expect(record.metadata.arguments).toEqual([]);
  });

  it('allows overriding metadata via options', () => {
    const record = Prompt.esm('@acme/tools@^1.0.0', 'greeting', {
      metadata: { description: 'Custom greeting prompt' },
    }) as PromptEsmTargetRecord;
    expect(record.metadata.description).toBe('Custom greeting prompt');
    expect(record.metadata.name).toBe('greeting');
    expect(record.metadata.arguments).toEqual([]);
  });

  it('throws on empty specifier', () => {
    expect(() => Prompt.esm('', 'greeting')).toThrow('Package specifier cannot be empty');
  });

  it('throws on invalid specifier', () => {
    expect(() => Prompt.esm('!!!', 'greeting')).toThrow('Invalid package specifier');
  });
});

describe('Prompt.remote()', () => {
  it('creates PromptRemoteRecord with kind REMOTE', () => {
    const record = Prompt.remote('https://api.example.com/mcp', 'greeting') as PromptRemoteRecord;
    expect(record.kind).toBe(PromptKind.REMOTE);
  });

  it('sets url and targetName', () => {
    const record = Prompt.remote('https://api.example.com/mcp', 'greeting') as PromptRemoteRecord;
    expect(record.url).toBe('https://api.example.com/mcp');
    expect(record.targetName).toBe('greeting');
  });

  it('creates unique symbol provide token', () => {
    const record = Prompt.remote('https://api.example.com/mcp', 'greeting') as PromptRemoteRecord;
    expect(typeof record.provide).toBe('symbol');
    expect(record.provide.toString()).toContain('remote-prompt:https://api.example.com/mcp:greeting');
  });

  it('passes transportOptions and remoteAuth', () => {
    const record = Prompt.remote('https://api.example.com/mcp', 'greeting', {
      transportOptions: { timeout: 15000 },
      remoteAuth: { mode: 'static', credentials: { type: 'bearer', value: 'abc' } },
    }) as PromptRemoteRecord;
    expect(record.transportOptions).toEqual({ timeout: 15000 });
    expect(record.remoteAuth).toEqual({
      mode: 'static',
      credentials: { type: 'bearer', value: 'abc' },
    });
  });

  it('generates placeholder metadata with arguments array', () => {
    const record = Prompt.remote('https://api.example.com/mcp', 'greeting') as PromptRemoteRecord;
    expect(record.metadata.name).toBe('greeting');
    expect(record.metadata.arguments).toEqual([]);
  });

  it('throws on invalid URI without a scheme', () => {
    expect(() => Prompt.remote('not-a-uri', 'test')).toThrow('URI must have a valid scheme');
  });
});

describe('normalizePrompt() with ESM/REMOTE records', () => {
  it('passes through PromptEsmTargetRecord unchanged', () => {
    const record = Prompt.esm('@acme/tools@^1.0.0', 'greeting') as PromptEsmTargetRecord;
    const normalized = normalizePrompt(record);
    expect(normalized).toBe(record);
    expect(normalized.kind).toBe(PromptKind.ESM);
  });

  it('passes through PromptRemoteRecord unchanged', () => {
    const record = Prompt.remote('https://api.example.com/mcp', 'greeting') as PromptRemoteRecord;
    const normalized = normalizePrompt(record);
    expect(normalized).toBe(record);
    expect(normalized.kind).toBe(PromptKind.REMOTE);
  });
});

describe('promptDiscoveryDeps() with ESM/REMOTE records', () => {
  it('returns empty array for ESM record', () => {
    const record = Prompt.esm('@acme/tools@^1.0.0', 'greeting') as PromptEsmTargetRecord;
    expect(promptDiscoveryDeps(record)).toEqual([]);
  });

  it('returns empty array for REMOTE record', () => {
    const record = Prompt.remote('https://api.example.com/mcp', 'greeting') as PromptRemoteRecord;
    expect(promptDiscoveryDeps(record)).toEqual([]);
  });
});
