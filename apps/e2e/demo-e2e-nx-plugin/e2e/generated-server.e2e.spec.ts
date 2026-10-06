import { existsSync, readdirSync, readFileSync } from 'fs';
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
        `import { SHARED_MARKER } from 'shared';`,
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

  // Regression for #679: the Dockerfile ran dist/main.js and vercel.json routed to it, which no build writes.
  it('generates deployment files that point at what the build wrote', () => {
    const root = join(ws, 'servers', server);
    if (deploymentTarget === 'node') {
      const cmd = /CMD \["node", "([^"]+)"\]/.exec(readFileSync(join(root, 'Dockerfile'), 'utf8'));
      expect(cmd?.[1]).toBe(`dist/node/server-${server}.bundle.js`);
      expect(existsSync(join(root, cmd?.[1] ?? 'missing'))).toBe(true);
    } else {
      const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as Record<string, unknown>;
      expect(vercel['buildCommand']).toBe(`cd ../../ && npx nx build server-${server}`);
      expect(vercel['builds']).toBeUndefined();
      // The build ran with this vercel.json in place and left it alone, writing the Build Output API tree.
      expect(existsSync(join(root, '.vercel', 'output', 'config.json'))).toBe(true);
      expect(existsSync(join(root, '.vercel', 'output', 'functions', 'index.func', 'handler.cjs'))).toBe(true);
    }
  });

  it('has a dev target next to build and typecheck', () => {
    const project = JSON.parse(readFileSync(join(ws, 'servers', server, 'project.json'), 'utf8')) as {
      targets: Record<string, { executor: string }>;
    };
    expect(project.targets['dev'].executor).toBe('@frontmcp/nx:dev');
    expect(project.targets['typecheck'].executor).toBe('nx:run-commands');
  });
});
