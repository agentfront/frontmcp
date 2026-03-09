/**
 * Global Teardown for Component Rendering E2E Tests
 *
 * Stops Docker services and removes volumes.
 */
import { execSync } from 'child_process';
import * as path from 'path';

const DOCKER_DIR = path.resolve(__dirname, '../../docker');

async function globalTeardown(): Promise<void> {
  if (process.env['SKIP_COMPONENT_RENDER_TESTS'] === 'true') {
    return;
  }

  console.log('[teardown] Stopping Docker infrastructure...');
  try {
    execSync('docker compose down -v', {
      cwd: DOCKER_DIR,
      timeout: 30_000,
      stdio: 'pipe',
    });
    console.log('[teardown] Docker infrastructure stopped.');
  } catch (err) {
    console.warn(`[teardown] Warning: docker compose down failed: ${(err as Error).message}`);
  }
}

export default globalTeardown;
