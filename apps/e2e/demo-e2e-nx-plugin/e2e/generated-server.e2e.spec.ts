import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  createWorkspace,
  executorContext,
  generate,
  loadExecutor,
  typecheck,
  write,
  type TempWorkspace,
} from './helpers/workspace';

type Executor = (
  options: Record<string, unknown>,
  context: ReturnType<typeof executorContext>,
) => Promise<{ success: boolean }>;

// Regression for #643: `server` output imported the app from the wrong path and could not be built.
describe.each(['node', 'vercel'] as const)('generated %s server', (deploymentTarget) => {
  let workspace: TempWorkspace & { ws: string };
  let ws: string;
  const server = `gateway-${deploymentTarget}`;

  beforeAll(async () => {
    workspace = await createWorkspace();
    ws = workspace.ws;
    await generate(ws, 'lib', { name: 'shared', directory: 'libs/group/shared' });
    write(join(ws, 'libs/group/shared/src/shared.ts'), `export const SHARED_MARKER = 'shared-lib-marker-643';\n`);
    write(join(ws, 'libs/group/shared/src/index.ts'), `export { SHARED_MARKER } from './shared';\n`);
    write(
      join(ws, 'apps/demo/src/demo.app.ts'),
      [
        `import { App } from '@frontmcp/sdk';`,
        `import { SHARED_MARKER } from '@frontmcp/shared';`,
        `import HelloTool from './tools/hello.tool';`,
        ``,
        `export const MARKER = SHARED_MARKER;`,
        ``,
        `@App({ id: 'demo', name: 'Demo', tools: [HelloTool] })`,
        `export class DemoApp {}`,
        ``,
      ].join('\n'),
    );
    await generate(ws, 'server', { name: server, apps: 'demo', deploymentTarget });
  });

  afterAll(() => workspace.cleanup());

  it('imports the app through a path that resolves and type-checks', () => {
    const main = readFileSync(join(ws, 'servers', server, 'src/main.ts'), 'utf8');
    expect(main).toContain('apps/demo/src/demo.app');
    const result = typecheck(ws, `servers/${server}/tsconfig.lib.json`);
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
  });

  it('builds with the build executor', async () => {
    const run = loadExecutor<Executor>('build');
    const result = await run(
      { entry: `servers/${server}/src/main.ts`, outputPath: `servers/${server}/dist`, target: deploymentTarget },
      executorContext(ws, server, `servers/${server}`),
    );
    expect(result.success).toBe(true);

    // The alias-imported lib is inlined into the bundle (nothing is left to resolve at runtime).
    const dist = join(ws, 'servers', server, 'dist');
    const bundled = readdirSync(dist, { recursive: true })
      .map(String)
      .filter((f) => /\.(c|m)?js$/.test(f) && !f.includes('node_modules'))
      .some((f) => readFileSync(join(dist, f), 'utf8').includes('shared-lib-marker-643'));
    expect(bundled).toBe(true);
  });
});
