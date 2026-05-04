import { exportToCopilot, exportToCursor, exportToWindsurf } from '../exporters';

const sample = {
  name: 'review-pr',
  description: 'Review a pull request end-to-end',
  instructions: '# Review PR\n\nDo the review.\n',
  category: 'development',
  tags: ['review', 'github'],
};

describe('exportToCursor', () => {
  it('writes to .cursor/rules/<name>.mdc', () => {
    const out = exportToCursor(sample);
    expect(out.relativePath).toBe('.cursor/rules/review-pr.mdc');
  });

  it('includes description and tags in frontmatter', () => {
    const out = exportToCursor(sample);
    expect(out.contents).toMatch(/^---/);
    expect(out.contents).toMatch(/description:/);
    expect(out.contents).toMatch(/tags: \["review","github"\]/);
    expect(out.contents).toMatch(/alwaysApply: false/);
  });

  it('quotes description when it contains : or #', () => {
    const out = exportToCursor({ ...sample, description: 'Foo: bar #baz', category: undefined });
    expect(out.contents).toContain('description: "Foo: bar #baz"');
  });

  it('emits the body after frontmatter', () => {
    const out = exportToCursor(sample);
    const parts = out.contents.split('---\n');
    expect(parts[parts.length - 1]).toMatch(/# review-pr/);
  });
});

describe('exportToWindsurf', () => {
  it('writes to .windsurfrules with a section heading', () => {
    const out = exportToWindsurf(sample);
    expect(out.relativePath).toBe('.windsurfrules');
    expect(out.contents).toMatch(/^## review-pr/);
  });

  it('includes tags + category lines when set', () => {
    const out = exportToWindsurf(sample);
    expect(out.contents).toContain('Tags: review, github');
    expect(out.contents).toContain('Category: development');
  });
});

describe('exportToCopilot', () => {
  it('writes to .github/instructions/<name>.md', () => {
    const out = exportToCopilot(sample);
    expect(out.relativePath).toBe('.github/instructions/review-pr.md');
  });

  it('includes description as a blockquote', () => {
    const out = exportToCopilot(sample);
    expect(out.contents).toMatch(/^# review-pr/);
    expect(out.contents).toMatch(/> Review a pull request end-to-end/);
  });
});
