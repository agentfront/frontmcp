import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  createScratchDir,
  createWorkspace,
  executorContext,
  generate,
  loadExecutor,
  tsc,
  typecheck,
  type TempWorkspace,
} from './helpers/workspace';

type Executor = (
  options: Record<string, unknown>,
  context: ReturnType<typeof executorContext>,
) => Promise<{ success: boolean }>;

const LIB_TYPES = ['generic', 'plugin', 'adapter', 'tool-register'] as const;

// Regression for #643: the published package did not contain the lib templates,
// so `nx g @frontmcp/nx:lib` failed for every libType.
describe('lib generator from the built package', () => {
  let scratch: TempWorkspace;

  beforeAll(() => {
    scratch = createScratchDir();
  });
  afterAll(() => scratch.cleanup());

  it.each(LIB_TYPES)('generates a %s library', async (libType) => {
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

// Regression for #679: plugin and adapter libraries imported types the SDK does not export (TS2614)
// and the adapter missed the abstract `options` member (TS2515); no library had a spec to run.
describe.each(LIB_TYPES)('generated %s library', (libType) => {
  let workspace: TempWorkspace & { ws: string };
  const name = `lib-${libType}`;

  beforeAll(async () => {
    workspace = await createWorkspace({ sampleApp: false });
    await generate(workspace.ws, 'lib', { name, libType });
  });

  afterAll(() => workspace.cleanup());

  it('type-checks its sources against the SDK', () => {
    const result = typecheck(workspace.ws, `libs/${name}/tsconfig.lib.json`);
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
  });

  it('type-checks its starter spec', () => {
    const result = typecheck(workspace.ws, `libs/${name}/tsconfig.spec.json`);
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
  });

  it('passes its starter spec with the test executor', async () => {
    const run = loadExecutor<Executor>('test');
    const result = await run({}, executorContext(workspace.ws, name, `libs/${name}`));
    expect(result.success).toBe(true);
  });
});

// The workspace no longer registers @nx/js/typescript, whose inferred `build` was the only one a library had,
// so a publishable library has its own build target and a package.json that points at what it writes.
describe('generated publishable library', () => {
  let workspace: TempWorkspace & { ws: string };
  let root: string;

  beforeAll(async () => {
    workspace = await createWorkspace({ sampleApp: false });
    await generate(workspace.ws, 'lib', {
      name: 'billing-plugin',
      libType: 'plugin',
      publishable: true,
      importPath: '@acme/billing-plugin',
    });
    root = join(workspace.ws, 'libs', 'billing-plugin');
  });

  afterAll(() => workspace.cleanup());

  it('builds with its build target into the files its package.json publishes', () => {
    const project = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8')) as {
      targets: Record<string, { executor: string; options: { command: string; cwd: string } }>;
    };
    const { executor, options } = project.targets['build'];
    expect(executor).toBe('nx:run-commands');
    expect(options.cwd).toBe('{projectRoot}');
    const [bin, ...args] = options.command.split(' ');
    expect(bin).toBe('tsc');

    const result = tsc(root, args);
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);

    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name: string;
      main: string;
      types: string;
      files: string[];
    };
    expect(pkg.name).toBe('@acme/billing-plugin');
    expect(pkg.files).toEqual(['dist']);
    expect(existsSync(join(root, pkg.types))).toBe(true);

    // Load it the way a consumer does: through the package folder and its `main`.
    const exported = execFileSync(
      process.execPath,
      ['-e', 'console.log(Object.keys(require(process.argv[1])).join(","))', root],
      { encoding: 'utf8' },
    );
    expect(exported.trim()).toBe('BillingPluginPlugin');
  });
});
