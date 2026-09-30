import { readFileSync } from 'fs';
import { join } from 'path';

import { createScratchDir, generate, write, type TempWorkspace } from './helpers/workspace';

// Regression for #643: `nx add @frontmcp/nx` installed nothing and the executors were never cacheable.
describe('init generator (nx add @frontmcp/nx)', () => {
  let scratch: TempWorkspace;

  beforeAll(async () => {
    scratch = createScratchDir();
    write(join(scratch.root, 'package.json'), JSON.stringify({ name: 'bare', devDependencies: { jest: '^29.0.0' } }));
    write(
      join(scratch.root, 'nx.json'),
      JSON.stringify({
        namedInputs: { production: ['default'] },
        targetDefaults: { '@frontmcp/nx:test': { cache: false } },
      }),
    );
    await generate(scratch.root, 'init', {});
  });

  afterAll(() => scratch.cleanup());

  it('adds the FrontMCP and jest dependencies without overriding existing versions', () => {
    const pkg = JSON.parse(readFileSync(join(scratch.root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies).toHaveProperty(['@frontmcp/sdk']);
    expect(pkg.dependencies).toHaveProperty(['frontmcp']);
    expect(pkg.devDependencies).toHaveProperty(['@frontmcp/testing']);
    expect(pkg.devDependencies).toHaveProperty(['@swc/jest']);
    expect(pkg.devDependencies['jest']).toBe('^29.0.0');
  });

  it('makes the build executors cacheable and keeps user choices', () => {
    const nx = JSON.parse(readFileSync(join(scratch.root, 'nx.json'), 'utf8')) as {
      targetDefaults: Record<string, { cache?: boolean; inputs?: string[] }>;
    };
    expect(nx.targetDefaults['@frontmcp/nx:build'].cache).toBe(true);
    expect(nx.targetDefaults['@frontmcp/nx:build'].inputs).toEqual(['production', '^production']);
    expect(nx.targetDefaults['@frontmcp/nx:build-exec'].cache).toBe(true);
    expect(nx.targetDefaults['@frontmcp/nx:test'].cache).toBe(false);
  });
});
