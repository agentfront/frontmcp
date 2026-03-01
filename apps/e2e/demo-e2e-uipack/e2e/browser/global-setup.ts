/**
 * Global Setup for Component Rendering E2E Tests
 *
 * Starts Docker infrastructure (Verdaccio + esm.sh), builds and publishes
 * @frontmcp packages, and warms up esm.sh before tests run.
 *
 * If Docker is unavailable, sets SKIP_COMPONENT_RENDER_TESTS=true so
 * component tests skip gracefully while existing tests still run.
 */
import { execSync } from 'child_process';
import * as path from 'path';
import * as http from 'http';

const VERDACCIO_URL = 'http://localhost:14873';
const ESM_SH_URL = 'http://localhost:8088';
const DOCKER_DIR = path.resolve(__dirname, '../../docker');
const WORKSPACE_ROOT = path.resolve(__dirname, '../../../../..');

function exec(cmd: string, options: { cwd?: string; timeout?: number } = {}): string {
  return execSync(cmd, {
    cwd: options.cwd ?? WORKSPACE_ROOT,
    timeout: options.timeout ?? 120_000,
    stdio: 'pipe',
    encoding: 'utf-8',
  }).trim();
}

function httpGet(url: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    }, timeoutMs);

    const req = http.get(url, (res) => {
      clearTimeout(timeout);
      res.resume();
      resolve(res.statusCode ?? 0);
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function waitForService(url: string, label: string, maxWaitMs: number): Promise<void> {
  const start = Date.now();
  const intervalMs = 2000;

  while (Date.now() - start < maxWaitMs) {
    try {
      const status = await httpGet(url, 5000);
      if (status >= 200 && status < 400) {
        console.log(`  [setup] ${label} is ready (${Date.now() - start}ms)`);
        return;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`${label} did not become ready within ${maxWaitMs}ms`);
}

async function warmUpEsmSh(): Promise<void> {
  const urls = [
    `${ESM_SH_URL}/react`,
    `${ESM_SH_URL}/react-dom`,
    `${ESM_SH_URL}/react-dom/client`,
    `${ESM_SH_URL}/@frontmcp/ui/components/Card`,
    `${ESM_SH_URL}/@frontmcp/ui/components/Button`,
    `${ESM_SH_URL}/@frontmcp/ui/components/Alert`,
  ];

  for (const url of urls) {
    const label = url.replace(ESM_SH_URL, '');
    try {
      await httpGet(url, 90_000);
      console.log(`  [setup] Warmed up: ${label}`);
    } catch (err) {
      console.warn(`  [setup] Warning: Failed to warm up ${label}: ${(err as Error).message}`);
    }
  }
}

function publishPackage(pkgDir: string): void {
  const distDir = path.join(WORKSPACE_ROOT, 'dist', pkgDir);
  console.log(`  [setup] Publishing ${pkgDir}...`);
  exec(`npm publish --registry ${VERDACCIO_URL} --access public --tag e2e`, {
    cwd: distDir,
    timeout: 30_000,
  });
}

async function globalSetup(): Promise<void> {
  // 1. Check Docker availability
  try {
    exec('docker info', { timeout: 10_000 });
  } catch {
    console.warn('[setup] Docker not available — skipping component render tests.');
    process.env['SKIP_COMPONENT_RENDER_TESTS'] = 'true';
    return;
  }

  console.log('[setup] Starting Docker infrastructure...');

  // 2. Start Docker services
  try {
    exec(`docker compose up -d --build --wait`, {
      cwd: DOCKER_DIR,
      timeout: 180_000,
    });
  } catch (err) {
    console.warn(`[setup] Docker compose failed — skipping component render tests: ${(err as Error).message}`);
    process.env['SKIP_COMPONENT_RENDER_TESTS'] = 'true';
    return;
  }

  // 3. Wait for Verdaccio
  console.log('[setup] Waiting for Verdaccio...');
  await waitForService(`${VERDACCIO_URL}/-/ping`, 'Verdaccio', 30_000);

  // 4. Build packages
  console.log('[setup] Building packages...');
  exec('npx nx build ui', { timeout: 180_000 });

  // 5. Publish packages in dependency order
  console.log('[setup] Publishing packages to Verdaccio...');
  publishPackage('libs/utils');
  publishPackage('libs/uipack');
  publishPackage('libs/ui');

  // 6. Wait for esm.sh
  console.log('[setup] Waiting for esm.sh...');
  await waitForService(ESM_SH_URL, 'esm.sh', 60_000);

  // 7. Warm up esm.sh with key dependencies
  console.log('[setup] Warming up esm.sh...');
  await warmUpEsmSh();

  console.log('[setup] Infrastructure ready.');
}

export default globalSetup;
