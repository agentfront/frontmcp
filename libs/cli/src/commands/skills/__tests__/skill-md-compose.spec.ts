import { composeSkillMd, hasFrontmatter } from '../skill-md-compose';

describe('hasFrontmatter', () => {
  it('returns true for a body that starts with --- and contains a closing fence', () => {
    const body = '---\nname: foo\n---\n\nbody';
    expect(hasFrontmatter(body)).toBe(true);
  });

  it('returns false when --- appears but no closing fence exists', () => {
    expect(hasFrontmatter('---\nincomplete')).toBe(false);
  });

  it('returns false for a body that does not start with ---', () => {
    expect(hasFrontmatter('# Heading\n\nbody')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(hasFrontmatter('')).toBe(false);
  });
});

describe('composeSkillMd', () => {
  it('prepends frontmatter when the body has none', () => {
    const result = composeSkillMd(
      { name: 'example-project', description: 'Use when editing the example project' },
      '# Example Project\n\nBody content.',
    );
    expect(result.startsWith('---\n')).toBe(true);
    expect(result).toContain('name: example-project');
    expect(result).toContain('description: Use when editing the example project');
    expect(result).toContain('# Example Project');
    expect(result).toContain('Body content.');
  });

  it('returns the body verbatim when frontmatter is already present', () => {
    const body = ['---', 'name: from-source', 'description: existing description', '---', '', '# Heading'].join('\n');
    const result = composeSkillMd({ name: 'ignored', description: 'will-not-be-used' }, body);
    expect(result).toBe(body);
    expect(result).not.toContain('will-not-be-used');
  });

  it('falls back to a synthesized description when the decorator omits one', () => {
    const result = composeSkillMd({ name: 'no-desc' }, '');
    expect(result).toContain('description: no-desc skill');
  });

  it('emits a tags array when decorator metadata includes tags', () => {
    const result = composeSkillMd({ name: 'with-tags', description: 'has tags', tags: ['alpha', 'beta'] }, '');
    expect(result).toContain('tags: [alpha, beta]');
  });

  it('emits the license field when present', () => {
    const result = composeSkillMd({ name: 'licensed', description: 'has license', license: 'MIT' }, '');
    expect(result).toContain('license: MIT');
  });

  it('quotes scalars that contain YAML-significant characters', () => {
    const result = composeSkillMd({ name: 'tricky', description: 'a: colon and a # hash' }, '');
    expect(result).toContain('description: "a: colon and a # hash"');
  });

  it('writes a placeholder heading when the body is empty', () => {
    const result = composeSkillMd({ name: 'empty-body' }, '');
    expect(result).toContain('# empty-body');
  });
});
