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

const COMPONENTS = [
  'tool',
  'resource',
  'prompt',
  'skill',
  'agent',
  'provider',
  'plugin',
  'adapter',
  'auth-provider',
  'flow',
];

// Regression for #643: a workspace produced by @frontmcp/nx must type-check, test and build as generated.
describe('generated workspace', () => {
  let workspace: TempWorkspace & { ws: string };
  let ws: string;

  beforeAll(async () => {
    workspace = await createWorkspace();
    ws = workspace.ws;

    await generate(ws, 'lib', { name: 'shared', directory: 'libs/group/shared' });
    for (const kind of COMPONENTS) {
      await generate(ws, kind, { name: `gen-${kind}`, project: 'demo' });
    }
    await generate(ws, 'job', { name: 'gen-job', project: 'demo' });
    await generate(ws, 'workflow', { name: 'gen-workflow', project: 'demo' });

    // Code that lives outside the app folder, reached through the tsconfig path alias.
    write(join(ws, 'libs/group/shared/src/shared.ts'), `export const SHARED_MARKER = 'shared-lib-marker-643';\n`);
    write(join(ws, 'libs/group/shared/src/index.ts'), `export { SHARED_MARKER } from './shared';\n`);
    // The generated hello tool keeps its starter spec; the app module pulls the lib in instead.
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
    write(
      join(ws, 'apps/demo/src/hello.spec.ts'),
      [
        `import { SHARED_MARKER } from 'shared';`,
        ``,
        `describe('workspace jest setup', () => {`,
        `  it('resolves cross-project imports', () => {`,
        `    expect(SHARED_MARKER).toBe('shared-lib-marker-643');`,
        `  });`,
        `});`,
        ``,
      ].join('\n'),
    );
  });

  afterAll(() => workspace.cleanup());

  it('type-checks the app against the SDK', () => {
    const result = typecheck(ws, 'apps/demo/tsconfig.lib.json');
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
  });

  it('type-checks the generated specs', () => {
    const result = typecheck(ws, 'apps/demo/tsconfig.spec.json');
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
  });

  it('runs the test executor from the project folder with its jest config, starter spec included', async () => {
    const run = loadExecutor<Executor>('test');
    const result = await run({}, executorContext(ws, 'demo', 'apps/demo'));
    expect(result.success).toBe(true);
  });

  it('builds the app with the build executor, bundling code imported from another project', async () => {
    const run = loadExecutor<Executor>('build');
    const result = await run(
      { entry: 'apps/demo/src/main.ts', outputPath: 'apps/demo/dist' },
      executorContext(ws, 'demo', 'apps/demo'),
    );
    expect(result.success).toBe(true);

    const out = join(ws, 'apps/demo/dist');
    expect(existsSync(out)).toBe(true);
    const files = readdirSync(out, { recursive: true }).map(String);
    const bundle = files.find((f) => f.endsWith('.bundle.js'));
    expect(bundle).toBeDefined();
    expect(readFileSync(join(out, bundle as string), 'utf8')).toContain('shared-lib-marker-643');
  });
});
