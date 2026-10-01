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
 * page error, from `vite build` and from the dev server.
 *
 * Needs the packages built: `nx run-many -t build -p sdk react`.
 */
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { cp, mkdir, mkdtemp, realpath, rm, symlink } from '@frontmcp/utils';

const workspace = resolve(__dirname, '../../../../..');
const appSource = resolve(__dirname, '../../published-app');
const FRONTMCP_PACKAGES = ['sdk', 'react', 'utils', 'protocol', 'di', 'lazy-zod', 'auth', 'guard', 'uipack'];
const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

let project: string;

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
    // The real path: Vite rejects a root reached through a symlink (macOS /var → /private/var)
    project = await realpath(await mkdtemp(join(tmpdir(), 'frontmcp-published-app-')));
    await cp(appSource, project, { recursive: true });
    await mkdir(join(project, 'node_modules', '@frontmcp'), { recursive: true });
    for (const name of FRONTMCP_PACKAGES) {
      await symlink(join(workspace, 'libs', name, 'dist'), join(project, 'node_modules', '@frontmcp', name), LINK_TYPE);
    }
    for (const name of ['react', 'react-dom']) {
      await symlink(join(workspace, 'node_modules', name), join(project, 'node_modules', name), LINK_TYPE);
    }
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
