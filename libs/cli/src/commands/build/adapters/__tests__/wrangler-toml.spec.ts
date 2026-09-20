// file: libs/cli/src/commands/build/adapters/__tests__/wrangler-toml.spec.ts

import { mergeWranglerToml, parseTomlStringArray, renderWranglerToml, type ManagedWranglerFields } from '../wrangler-toml';

const MANAGED: ManagedWranglerFields = {
  name: 'frontmcp-worker',
  main: 'dist/cloudflare/index.js',
  compatibilityDate: '2024-09-23',
  compatibilityFlags: ['nodejs_compat', 'nodejs_compat_populate_process_env'],
};

/** The file `frontmcp create --target cloudflare` scaffolds, trimmed. */
const SCAFFOLDED = `name = "twilio-mcp"
main = "dist/cloudflare/index.js"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[vars]
NODE_ENV = "production"

# [[kv_namespaces]]
# binding = "BUNDLE_CACHE"
`;

describe('parseTomlStringArray', () => {
  it('reads an inline array', () => {
    expect(parseTomlStringArray('["a", "b"]')).toEqual(['a', 'b']);
  });

  it('reads a multi-line array', () => {
    expect(parseTomlStringArray('[\n  "a",\n  "b",\n]')).toEqual(['a', 'b']);
  });

  it('returns an empty list for an empty array', () => {
    expect(parseTomlStringArray('[]')).toEqual([]);
  });
});

describe('renderWranglerToml', () => {
  it('renders all four managed keys', () => {
    const rendered = renderWranglerToml(MANAGED);
    expect(rendered).toContain('name = "frontmcp-worker"');
    expect(rendered).toContain('main = "dist/cloudflare/index.js"');
    expect(rendered).toContain('compatibility_date = "2024-09-23"');
    expect(rendered).toContain('compatibility_flags = ["nodejs_compat", "nodejs_compat_populate_process_env"]');
  });
});

describe('mergeWranglerToml (issue #535)', () => {
  it('keeps the name the file declares instead of renaming the worker', () => {
    const { content, warnings } = mergeWranglerToml(SCAFFOLDED, MANAGED);

    expect(content).toContain('name = "twilio-mcp"');
    expect(content).not.toContain('frontmcp-worker');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('twilio-mcp');
  });

  it('does not warn when the declared name already matches the config', () => {
    const { warnings } = mergeWranglerToml(SCAFFOLDED, { ...MANAGED, name: 'twilio-mcp' });
    expect(warnings).toEqual([]);
  });

  it('preserves [vars], bindings and comments', () => {
    const { content } = mergeWranglerToml(SCAFFOLDED, MANAGED);

    expect(content).toContain('[vars]');
    expect(content).toContain('NODE_ENV = "production"');
    expect(content).toContain('# [[kv_namespaces]]');
    expect(content).toContain('# binding = "BUNDLE_CACHE"');
  });

  it('preserves real bindings a user added after scaffolding', () => {
    const withBindings = `${SCAFFOLDED}
[[kv_namespaces]]
binding = "CACHE"
id = "abc123"

[triggers]
crontabs = ["*/5 * * * *"]
`;
    const { content } = mergeWranglerToml(withBindings, MANAGED);

    expect(content).toContain('[[kv_namespaces]]');
    expect(content).toContain('id = "abc123"');
    expect(content).toContain('crontabs = ["*/5 * * * *"]');
  });

  it('always rewrites main so it tracks the build output (#374)', () => {
    const stale = 'name = "app"\nmain = "dist/index.js"\n';
    const { content } = mergeWranglerToml(stale, MANAGED);

    expect(content).toContain('main = "dist/cloudflare/index.js"');
    expect(content).not.toContain('main = "dist/index.js"');
  });

  it('unions compatibility_flags rather than replacing them', () => {
    const custom = 'name = "app"\nmain = "x.js"\ncompatibility_flags = ["nodejs_compat", "my_flag"]\n';
    const { content } = mergeWranglerToml(custom, MANAGED);

    expect(content).toContain(
      'compatibility_flags = ["nodejs_compat", "my_flag", "nodejs_compat_populate_process_env"]',
    );
  });

  it('keeps a compatibility_date the user pinned', () => {
    const pinned = 'name = "app"\nmain = "x.js"\ncompatibility_date = "2025-06-01"\n';
    const { content } = mergeWranglerToml(pinned, MANAGED);

    expect(content).toContain('compatibility_date = "2025-06-01"');
    expect(content).not.toContain('2024-09-23');
  });

  it('adds missing managed keys to the preamble, above the first section', () => {
    const minimal = 'name = "app"\n\n[vars]\nFOO = "bar"\n';
    const { content } = mergeWranglerToml(minimal, MANAGED);

    const lines = content.split('\n');
    const sectionIndex = lines.findIndex((line) => line.trim() === '[vars]');
    const mainIndex = lines.findIndex((line) => line.startsWith('main ='));
    expect(mainIndex).toBeGreaterThanOrEqual(0);
    expect(mainIndex).toBeLessThan(sectionIndex);
    expect(content).toContain('FOO = "bar"');
  });

  it('replaces a multi-line compatibility_flags array without corrupting the file', () => {
    const multiline = ['name = "app"', 'main = "x.js"', 'compatibility_flags = [', '  "nodejs_compat",', ']', '', '[vars]', 'A = "1"', ''].join('\n');
    const { content } = mergeWranglerToml(multiline, MANAGED);

    expect(content).toContain('compatibility_flags = ["nodejs_compat", "nodejs_compat_populate_process_env"]');
    expect(content).not.toContain('  "nodejs_compat",');
    expect(content).toContain('[vars]');
    expect(content).toContain('A = "1"');
  });

  it('ignores a name declared inside a section', () => {
    const sectioned = 'main = "x.js"\n\n[vars]\nname = "not-the-worker"\n';
    const { content, warnings } = mergeWranglerToml(sectioned, MANAGED);

    expect(content).toContain('name = "frontmcp-worker"');
    expect(content).toContain('name = "not-the-worker"');
    expect(warnings).toEqual([]);
  });

  it('ignores a commented-out managed key', () => {
    const commented = '# name = "old-name"\nmain = "x.js"\n';
    const { content, warnings } = mergeWranglerToml(commented, MANAGED);

    expect(content).toContain('# name = "old-name"');
    expect(content).toContain('name = "frontmcp-worker"');
    expect(warnings).toEqual([]);
  });

  it('produces a complete file from empty input', () => {
    const { content } = mergeWranglerToml('', MANAGED);

    expect(content).toContain('name = "frontmcp-worker"');
    expect(content).toContain('main = "dist/cloudflare/index.js"');
    expect(content).toContain('compatibility_date = "2024-09-23"');
  });

  it('keeps CRLF line endings instead of rewriting every line', () => {
    const crlf = SCAFFOLDED.replace(/\n/g, '\r\n');
    const { content } = mergeWranglerToml(crlf, MANAGED);

    expect(content).toContain('\r\n');
    expect(content).not.toMatch(/[^\r]\n/);
    expect(content).toContain('main = "dist/cloudflare/index.js"');
  });

  it('does not mistake a multi-line array element for a section header', () => {
    const nested = ['main = "x.js"', 'routes = [', '  ["a"],', ']', '', '[vars]', 'A = "1"', ''].join('\n');
    const { content } = mergeWranglerToml(nested, MANAGED);

    // The managed keys belong above [vars], never inside the routes array.
    const lines = content.split('\n');
    expect(lines.indexOf('name = "frontmcp-worker"')).toBeGreaterThan(lines.indexOf(']'));
    expect(lines.indexOf('name = "frontmcp-worker"')).toBeLessThan(lines.indexOf('[vars]'));
    expect(content).toContain('  ["a"],');
  });

  it('does not mistake a bare array element for a section header', () => {
    // `["a"]` on its own line is shaped exactly like a table header; only the
    // surrounding bracket depth distinguishes the two.
    const nested = ['main = "x.js"', 'routes = [', '  ["a"]', ']', '', '[vars]', 'A = "1"', ''].join('\n');
    const { content } = mergeWranglerToml(nested, MANAGED);

    const lines = content.split('\n');
    expect(lines.indexOf('name = "frontmcp-worker"')).toBeGreaterThan(lines.indexOf(']'));
    expect(lines.indexOf('name = "frontmcp-worker"')).toBeLessThan(lines.indexOf('[vars]'));
    expect(content).toContain('  ["a"]');
    expect(content).toContain('A = "1"');
  });

  it('ignores brackets inside quoted values and comments when tracking depth', () => {
    const tricky = ['main = "x.js"', 'note = "a [bracket] in a string"', '# a [comment] too', '', '[vars]', 'A = "1"', ''].join('\n');
    const { content } = mergeWranglerToml(tricky, MANAGED);

    const lines = content.split('\n');
    expect(lines.indexOf('name = "frontmcp-worker"')).toBeLessThan(lines.indexOf('[vars]'));
    expect(content).toContain('note = "a [bracket] in a string"');
    expect(content).toContain('A = "1"');
  });

  it('applies the caller\u2019s flag reconciliation to flags declared in the file', () => {
    const optedOut = 'main = "x.js"\ncompatibility_flags = ["nodejs_compat_do_not_populate_process_env"]\n';
    const dropPopulate = (declared: readonly string[]): string[] =>
      declared.includes('nodejs_compat_do_not_populate_process_env')
        ? declared.filter((flag) => flag !== 'nodejs_compat_populate_process_env')
        : [...declared];

    const { content } = mergeWranglerToml(optedOut, MANAGED, dropPopulate);

    expect(content).toContain('"nodejs_compat_do_not_populate_process_env"');
    expect(content).not.toContain('"nodejs_compat_populate_process_env"');
  });

  it('is idempotent — merging its own output changes nothing', () => {
    const first = mergeWranglerToml(SCAFFOLDED, MANAGED).content;
    const second = mergeWranglerToml(first, MANAGED).content;

    expect(second).toBe(first);
  });
});
