/**
 * @frontmcp/react + @frontmcp/sdk in a plain Vite app on the built packages (#681).
 *
 * The app (../../published-app) is copied into a temporary project whose node_modules link each
 * @frontmcp package to its built `dist`, the layout `npm install` produces, so the packages resolve
 * through their published `exports` / `imports` maps (no source aliases, no `development`
 * condition). Before the fix a production build died at load with `process is not defined` (the
 * stdio client inlined into @frontmcp/protocol), then on `http.ServerResponse` (express inlined
 * into the SDK's ESM bundle); Vite 7 failed the build on `"PassThrough" is not exported by
 * "__vite-browser-external"`. The page must create the server, list its tool and call it with no
 * page error, from `vite build` and from the dev server. A CommonJS dependency's
 * `require('@frontmcp/sdk')` (../../published-cjs-app) must be bundled from the SDK's browser build too.
 *
 * Needs the packages built: `nx run-many -t build -p sdk react`.
 */
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { cp, mkdir, mkdtemp, realpath, rm, symlink } from '@frontmcp/utils';

const workspace = resolve(__dirname, '../../../../..');
const appSource = resolve(__dirname, '../../published-app');
const cjsAppSource = resolve(__dirname, '../../published-cjs-app');
const FRONTMCP_PACKAGES = ['sdk', 'react', 'utils', 'protocol', 'di', 'lazy-zod', 'auth', 'guard', 'uipack'];
const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

const initialNodeEnv = process.env['NODE_ENV'];

let project: string;

test.afterEach(() => {
  // vite.build() and vite.preview() leave NODE_ENV=production, which would start the dev server in production mode
  if (initialNodeEnv === undefined) delete process.env['NODE_ENV'];
  else process.env['NODE_ENV'] = initialNodeEnv;
});

async function createPublishedProject(source: string, prefix: string): Promise<string> {
  // The real path: Vite rejects a root reached through a symlink (macOS /var → /private/var)
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  await cp(source, root, { recursive: true });
  await mkdir(join(root, 'node_modules', '@frontmcp'), { recursive: true });
  for (const name of FRONTMCP_PACKAGES) {
    await symlink(join(workspace, 'libs', name, 'dist'), join(root, 'node_modules', '@frontmcp', name), LINK_TYPE);
  }
  for (const name of ['react', 'react-dom']) {
    await symlink(join(workspace, 'node_modules', name), join(root, 'node_modules', name), LINK_TYPE);
  }
  return root;
}

async function expectWorkingPage(page: Page, url: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(url);
  await expect(page.locator('#tools')).toHaveText('tools:ping result:{"pong":true}', { timeout: 60_000 });
  expect(errors).toEqual([]);
}

test.describe('published packages in a plain Vite app', () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    project = await createPublishedProject(appSource, 'frontmcp-published-app-');
  });

  test.afterAll(async () => {
    if (project) await rm(project, { recursive: true, force: true });
  });

  test('a production build loads and runs', async ({ page }) => {
    const vite = await import('vite');
    const configFile = join(project, 'vite.config.mjs');
    await vite.build({ root: project, configFile });
    const server = await vite.preview({ root: project, configFile, preview: { port: 4411, strictPort: true } });
    try {
      await expectWorkingPage(page, 'http://localhost:4411/');
    } finally {
      await new Promise<void>((done) => server.httpServer.close(() => done()));
    }
  });

  test('the dev server loads and runs', async ({ page }) => {
    const vite = await import('vite');
    const server = await vite.createServer({
      root: project,
      configFile: join(project, 'vite.config.mjs'),
      server: { port: 4412, strictPort: true },
      optimizeDeps: { force: true },
    });
    await server.listen();
    try {
      await expectWorkingPage(page, 'http://localhost:4412/');
    } finally {
      await server.close();
    }
  });
});

test.describe('a CommonJS dependency requiring @frontmcp/sdk in a plain Vite app', () => {
  let cjsProject: string;

  test.setTimeout(180_000);

  test.beforeAll(async () => {
    cjsProject = await createPublishedProject(cjsAppSource, 'frontmcp-published-cjs-app-');
    await cp(join(cjsProject, 'cjs-consumer'), join(cjsProject, 'node_modules', 'frontmcp-cjs-consumer'), {
      recursive: true,
    });
  });

  test.afterAll(async () => {
    if (cjsProject) await rm(cjsProject, { recursive: true, force: true });
  });

  test('the require() is bundled from the SDK browser build and runs', async ({ page }) => {
    const vite = await import('vite');
    const configFile = join(cjsProject, 'vite.config.mjs');
    const result = await vite.build({ root: cjsProject, configFile });
    const outputs = Array.isArray(result) ? result : [result];
    const moduleIds = outputs
      .flatMap((output) => ('output' in output ? output.output : []))
      .flatMap((item) => (item.type === 'chunk' ? item.moduleIds : []))
      .map((id) => id.split('\\').join('/'));

    expect(moduleIds.filter((id) => id.includes('/libs/sdk/dist/'))).toEqual([
      join(workspace, 'libs/sdk/dist/browser/index.mjs').split('\\').join('/'),
    ]);

    const server = await vite.preview({ root: cjsProject, configFile, preview: { port: 4413, strictPort: true } });
    try {
      await expectWorkingPage(page, 'http://localhost:4413/');
    } finally {
      await new Promise<void>((done) => server.httpServer.close(() => done()));
    }
  });
});
