import {
  buildGlamaPayload,
  buildSmitheryPayload,
  GLAMA_ENDPOINT,
  SMITHERY_ENDPOINT,
  type PublishableSkill,
} from '../targets';

const skill: PublishableSkill = {
  name: 'review-pr',
  description: 'Review a pull request',
  category: 'development',
  tags: ['review', 'github'],
  rating: 4.5,
  license: 'Apache-2.0',
  repository: 'https://github.com/example/repo',
  install: { type: 'npm', reference: '@frontmcp/skills' },
};

describe('buildSmitheryPayload', () => {
  it('namespaces under frontmcp/<name>', () => {
    const p = buildSmitheryPayload(skill);
    expect(p.qualifiedName).toBe('frontmcp/review-pr');
    expect(p.displayName).toBe('review-pr');
  });

  it('includes tags, category, license, homepage', () => {
    const p = buildSmitheryPayload(skill);
    expect(p.tags).toEqual(['review', 'github']);
    expect(p.category).toBe('development');
    expect(p.license).toBe('Apache-2.0');
    expect(p.homepage).toBe('https://github.com/example/repo');
  });

  it('falls back to category=general when missing', () => {
    const p = buildSmitheryPayload({ ...skill, category: undefined });
    expect(p.category).toBe('general');
  });

  it('exposes the documented endpoint', () => {
    expect(SMITHERY_ENDPOINT).toMatch(/^https:\/\//);
  });
});

describe('buildGlamaPayload', () => {
  it('wraps under mcpServer envelope', () => {
    const p = buildGlamaPayload(skill);
    expect(p.mcpServer.name).toBe('review-pr');
    expect(p.mcpServer.rating).toBe(4.5);
    expect(p.mcpServer.tags).toEqual(['review', 'github']);
  });

  it('omits rating when not set', () => {
    const p = buildGlamaPayload({ ...skill, rating: undefined });
    expect(p.mcpServer.rating).toBeUndefined();
  });

  it('exposes the documented endpoint', () => {
    expect(GLAMA_ENDPOINT).toMatch(/^https:\/\//);
  });
});
