import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { createScratchDir, generate, type TempWorkspace } from './helpers/workspace';

// Regression for #643: the published package did not contain the lib templates,
// so `nx g @frontmcp/nx:lib` failed for every libType.
describe('lib generator from the built package', () => {
  let scratch: TempWorkspace;

  beforeAll(() => {
    scratch = createScratchDir();
  });
  afterAll(() => scratch.cleanup());

  it.each(['generic', 'plugin', 'adapter', 'tool-register'] as const)('generates a %s library', async (libType) => {
    const name = `my-${libType}`;
    await generate(scratch.root, 'lib', { name, libType });

    const root = join(scratch.root, 'libs', name);
    expect(existsSync(join(root, 'project.json'))).toBe(true);
    expect(existsSync(join(root, 'tsconfig.json'))).toBe(true);
    expect(existsSync(join(root, 'jest.config.cjs'))).toBe(true);
    expect(existsSync(join(root, 'src', 'index.ts'))).toBe(true);
    expect(readFileSync(join(root, 'project.json'), 'utf8')).toContain(`"name": "${name}"`);
  });
});
