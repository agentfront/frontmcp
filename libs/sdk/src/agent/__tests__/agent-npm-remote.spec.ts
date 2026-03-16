import { Agent } from '../../common/decorators/agent.decorator';
import { AgentKind } from '../../common/records/agent.record';
import type { AgentEsmTargetRecord, AgentRemoteRecord } from '../../common/records/agent.record';

describe('Agent.esm()', () => {
  it('creates AgentEsmTargetRecord with kind ESM', () => {
    const record = (Agent as any).esm('@acme/agents@^1.0.0', 'research') as AgentEsmTargetRecord;
    expect(record.kind).toBe(AgentKind.ESM);
  });

  it('parses scoped specifier correctly', () => {
    const record = (Agent as any).esm('@acme/agents@^1.0.0', 'research') as AgentEsmTargetRecord;
    expect(record.specifier.scope).toBe('@acme');
    expect(record.specifier.name).toBe('agents');
    expect(record.specifier.fullName).toBe('@acme/agents');
    expect(record.specifier.range).toBe('^1.0.0');
  });

  it('parses unscoped specifier', () => {
    const record = (Agent as any).esm('ai-agents@latest', 'writer') as AgentEsmTargetRecord;
    expect(record.specifier.scope).toBeUndefined();
    expect(record.specifier.fullName).toBe('ai-agents');
  });

  it('sets targetName', () => {
    const record = (Agent as any).esm('@acme/agents@^1.0.0', 'research') as AgentEsmTargetRecord;
    expect(record.targetName).toBe('research');
  });

  it('creates unique symbol provide token', () => {
    const record = (Agent as any).esm('@acme/agents@^1.0.0', 'research') as AgentEsmTargetRecord;
    expect(typeof record.provide).toBe('symbol');
    expect(record.provide.toString()).toContain('esm-agent:@acme/agents:research');
  });

  it('creates different symbols for different targets', () => {
    const r1 = (Agent as any).esm('@acme/agents@^1.0.0', 'research') as AgentEsmTargetRecord;
    const r2 = (Agent as any).esm('@acme/agents@^1.0.0', 'writer') as AgentEsmTargetRecord;
    expect(r1.provide).not.toBe(r2.provide);
  });

  it('passes options through', () => {
    const record = (Agent as any).esm('@acme/agents@^1.0.0', 'research', {
      loader: { url: 'https://custom.cdn' },
      cacheTTL: 300000,
    }) as AgentEsmTargetRecord;
    expect(record.options?.loader).toEqual({ url: 'https://custom.cdn' });
    expect(record.options?.cacheTTL).toBe(300000);
  });

  it('generates placeholder metadata with llm', () => {
    const record = (Agent as any).esm('@acme/agents@^1.0.0', 'research') as AgentEsmTargetRecord;
    expect(record.metadata.name).toBe('research');
    expect(record.metadata.description).toContain('research');
    expect(record.metadata.description).toContain('@acme/agents');
    expect(record.metadata.llm).toBeDefined();
  });

  it('allows overriding metadata via options', () => {
    const record = (Agent as any).esm('@acme/agents@^1.0.0', 'research', {
      metadata: { description: 'Custom agent desc' },
    }) as AgentEsmTargetRecord;
    expect(record.metadata.description).toBe('Custom agent desc');
    expect(record.metadata.name).toBe('research');
  });

  it('throws on empty specifier', () => {
    expect(() => (Agent as any).esm('', 'research')).toThrow('Package specifier cannot be empty');
  });

  it('throws on invalid specifier', () => {
    expect(() => (Agent as any).esm('!!!', 'research')).toThrow('Invalid package specifier');
  });
});

describe('Agent.remote()', () => {
  it('creates AgentRemoteRecord with kind REMOTE', () => {
    const record = (Agent as any).remote('https://api.example.com/mcp', 'assistant') as AgentRemoteRecord;
    expect(record.kind).toBe(AgentKind.REMOTE);
  });

  it('sets url and targetName', () => {
    const record = (Agent as any).remote('https://api.example.com/mcp', 'assistant') as AgentRemoteRecord;
    expect(record.url).toBe('https://api.example.com/mcp');
    expect(record.targetName).toBe('assistant');
  });

  it('creates unique symbol provide token', () => {
    const record = (Agent as any).remote('https://api.example.com/mcp', 'assistant') as AgentRemoteRecord;
    expect(typeof record.provide).toBe('symbol');
    expect(record.provide.toString()).toContain('remote-agent:https://api.example.com/mcp:assistant');
  });

  it('passes transportOptions and remoteAuth', () => {
    const record = (Agent as any).remote('https://api.example.com/mcp', 'assistant', {
      transportOptions: { timeout: 60000 },
      remoteAuth: { mode: 'static', credentials: { type: 'bearer', value: 'token' } },
    }) as AgentRemoteRecord;
    expect(record.transportOptions).toEqual({ timeout: 60000 });
    expect(record.remoteAuth).toEqual({
      mode: 'static',
      credentials: { type: 'bearer', value: 'token' },
    });
  });

  it('generates placeholder metadata with llm', () => {
    const record = (Agent as any).remote('https://api.example.com/mcp', 'assistant') as AgentRemoteRecord;
    expect(record.metadata.name).toBe('assistant');
    expect(record.metadata.description).toContain('assistant');
    expect(record.metadata.llm).toBeDefined();
  });
});
