import { readdirSync, readFileSync, symlinkSync } from 'fs';
import { join } from 'path';

import {
  createScratchDir,
  executorContext,
  generate,
  loadExecutor,
  REPO_ROOT,
  typecheck,
  write,
  type TempWorkspace,
} from './helpers/workspace';

type Executor = (
  options: Record<string, unknown>,
  context: ReturnType<typeof executorContext>,
) => Promise<{ success: boolean }>;

/**
 * The root configs `create-nx-workspace --preset=ts` writes: a solution-style `tsconfig.json`
 * and a base that builds declaration-only composite projects with `customConditions`.
 */
function writeTsSolutionWorkspace(root: string): void {
  write(join(root, 'package.json'), JSON.stringify({ name: '@org/source', private: true }, null, 2));
  write(join(root, 'nx.json'), JSON.stringify({ namedInputs: { default: ['{projectRoot}/**/*'] } }, null, 2));
  write(
    join(root, 'tsconfig.base.json'),
    JSON.stringify(
      {
        compilerOptions: {
          composite: true,
          declarationMap: true,
          emitDeclarationOnly: true,
          importHelpers: true,
          isolatedModules: true,
          lib: ['es2022'],
          module: 'nodenext',
          moduleResolution: 'nodenext',
          noEmitOnError: true,
          skipLibCheck: true,
          strict: true,
          target: 'es2022',
          customConditions: ['@org/source'],
        },
      },
      null,
      2,
    ),
  );
  write(
    join(root, 'tsconfig.json'),
    JSON.stringify({ extends: './tsconfig.base.json', compileOnSave: false, files: [], references: [] }, null, 2),
  );
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
}

// Regression for #679: in an Nx TS-solution workspace the app inherited `customConditions` next to its
// `node10` resolution (TS5098) and declaration-only emit (no JavaScript), and the lib path alias had no
// `baseUrl` to resolve against (TS5090).
describe('generated projects in an Nx TS-solution workspace', () => {
  let scratch: TempWorkspace;
  let ws: string;

  beforeAll(async () => {
    scratch = createScratchDir();
    ws = scratch.root;
    writeTsSolutionWorkspace(ws);

    await generate(ws, 'app', { name: 'demo' });
    await generate(ws, 'lib', { name: 'shared' });
    // Keep the generated class (its starter spec runs below) and export a marker next to it.
    write(join(ws, 'libs/shared/src/marker.ts'), `export const SHARED_MARKER = 'shared-lib-marker-679';\n`);
    write(
      join(ws, 'libs/shared/src/index.ts'),
      `export { Shared } from './shared';\nexport { SHARED_MARKER } from './marker';\n`,
    );
    write(
      join(ws, 'apps/demo/src/demo.app.ts'),
      [
        `import { App } from '@frontmcp/sdk';`,
        `import { SHARED_MARKER } from '@org/shared';`,
        `import HelloTool from './tools/hello.tool';`,
        ``,
        `export const MARKER = SHARED_MARKER;`,
        ``,
        `@App({ id: 'demo', name: 'Demo', tools: [HelloTool] })`,
        `export class DemoApp {}`,
        ``,
      ].join('\n'),
    );
  });

  afterAll(() => scratch.cleanup());

  it('registers the lib alias relative to the base config', () => {
    const base = JSON.parse(readFileSync(join(ws, 'tsconfig.base.json'), 'utf8')) as {
      compilerOptions: { paths: Record<string, string[]> };
    };
    expect(base.compilerOptions.paths['@org/shared']).toEqual(['./libs/shared/src/index.ts']);
  });

  it.each([
    ['the app', 'apps/demo/tsconfig.lib.json'],
    ['the app specs', 'apps/demo/tsconfig.spec.json'],
    ['the lib', 'libs/shared/tsconfig.lib.json'],
    ['the lib specs', 'libs/shared/tsconfig.spec.json'],
  ])('type-checks %s', (_label, project) => {
    const result = typecheck(ws, project);
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
  });

  it('builds JavaScript for the app, bundling the lib', async () => {
    const run = loadExecutor<Executor>('build');
    const result = await run(
      { entry: 'apps/demo/src/main.ts', outputPath: 'apps/demo/dist' },
      executorContext(ws, 'demo', 'apps/demo'),
    );
    expect(result.success).toBe(true);

    const out = join(ws, 'apps/demo/dist');
    const bundle = readdirSync(out, { recursive: true })
      .map(String)
      .find((f) => f.endsWith('.bundle.js'));
    expect(bundle).toBeDefined();
    expect(readFileSync(join(out, bundle as string), 'utf8')).toContain('shared-lib-marker-679');
  });

  it('runs the starter specs of the app and the lib', async () => {
    const run = loadExecutor<Executor>('test');
    expect((await run({}, executorContext(ws, 'demo', 'apps/demo'))).success).toBe(true);
    expect((await run({}, executorContext(ws, 'shared', 'libs/shared'))).success).toBe(true);
  });
});
