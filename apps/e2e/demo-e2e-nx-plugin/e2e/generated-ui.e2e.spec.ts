import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

import { createWorkspace, generate, REPO_ROOT, typecheck, type TempWorkspace } from './helpers/workspace';

const JEST = join(REPO_ROOT, 'node_modules', 'jest', 'bin', 'jest.js');

// Regression for #643: the ui-* generators emitted packages that neither declared nor type-checked against their dependencies.
describe('generated UI packages', () => {
  let workspace: TempWorkspace & { ws: string };
  let ws: string;

  beforeAll(async () => {
    workspace = await createWorkspace();
    ws = workspace.ws;
    await generate(ws, 'ui-component', { name: 'my-button' });
    await generate(ws, 'ui-page', { name: 'home' });
    await generate(ws, 'ui-shell', { name: 'layout' });
  });

  afterAll(() => workspace.cleanup());

  it('declares the dependencies the generated code imports', () => {
    const pkg = JSON.parse(readFileSync(join(ws, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const dep of ['react', '@mui/material', '@emotion/react', '@testing-library/react', '@frontmcp/uipack']) {
      expect(all).toHaveProperty([dep]);
    }
  });

  it.each(['components', 'pages', 'shells'])('type-checks ui/%s', (pkg) => {
    const result = typecheck(ws, `ui/${pkg}/tsconfig.json`);
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
  });

  it.each(['components', 'pages', 'shells'])('runs the generated specs of ui/%s', (pkg) => {
    const cwd = join(ws, 'ui', pkg);
    const output = execFileSync(process.execPath, [JEST, '-c', 'jest.config.cjs', '--rootDir', '.'], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, CI: 'true' },
    });
    expect(output).toBeDefined();
  });
});
