/**
 * E2E for adapter-target build wiring (#374 / #375 round-2).
 *
 * Drives the published `frontmcp` CLI against a synthetic tmp project so the
 * full plumbing — config schema → runBuild → runAdapterBuild → loadEntryDecoratorInfo
 * → adapter.validate / adapter.getConfig — is exercised end-to-end. Round 1
 * left two regressions in this path:
 *
 *   #374 — wrangler.toml ignored `frontmcp.config.deployments[].wrangler` and
 *          always shipped hardcoded `name = "frontmcp-worker"` and the wrong
 *          `compatibility_date`. Round 2 forwards the deployment object into
 *          `template.getConfig(cwd, deployment)` so the merged TOML wins.
 *
 *   #375 — Cloudflare's `validate` hook only inspected the runtime-evaluated
 *          decorator config object. The reporter's failure case was
 *          `sqlite: process.env.X ? {...} : undefined` — a ternary that
 *          evaluates to undefined when X isn't set, so the runtime check saw
 *          nothing while the bundle still shipped the Node-only branch.
 *          Round 2 also scans the @FrontMcp({...}) source AST for the keys
 *          themselves, regardless of value evaluation.
 */
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

import { ensureDir, fileExists, mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

const ROOT_DIR = path.resolve(__dirname, '../../../..');
const FRONTMCP_BIN = path.join(ROOT_DIR, 'libs', 'cli', 'dist', 'src', 'core', 'cli.js');

// Tmp fixtures live INSIDE the monorepo so `npx tsc` resolves TypeScript
// from the workspace `node_modules` via parent-directory lookup. A normal
// `os.tmpdir()` location would force every test to install typescript first.
const TMP_ROOT = path.resolve(__dirname, '..', '.tmp-build-targets');

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runFrontmcp(cwd: string, args: string[]): CliResult {
  try {
    const stdout = execFileSync('node', [FRONTMCP_BIN, ...args], {
      cwd,
      timeout: 60000,
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: 'test', FRONTMCP_LOG_LEVEL: 'error' },
    });
    return { stdout: stdout.toString(), stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number };
    return {
      stdout: (e.stdout ?? '').toString(),
      stderr: (e.stderr ?? '').toString(),
      exitCode: e.status ?? 1,
    };
  }
}

async function makeTmpProject(prefix: string): Promise<string> {
  await ensureDir(TMP_ROOT);
  return mkdtemp(path.join(TMP_ROOT, `${prefix}-`));
}

async function writeTextFile(dir: string, rel: string, content: string): Promise<void> {
  const full = path.join(dir, rel);
  await ensureDir(path.dirname(full));
  await writeFile(full, content);
}

describe('Adapter build E2E — wrangler config + Cloudflare AST validate (#374, #375)', () => {
  let tmp: string;

  beforeAll(async () => {
    if (!(await fileExists(FRONTMCP_BIN))) {
      throw new Error(
        `frontmcp CLI not built at ${FRONTMCP_BIN}. ` + `Run \`yarn nx build cli\` before this E2E suite.`,
      );
    }
  });

  afterEach(async () => {
    if (tmp && (await fileExists(tmp))) {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    if (await fileExists(TMP_ROOT)) await rm(TMP_ROOT, { recursive: true, force: true });
  });

  describe('#375 — Cloudflare validate aborts on env-gated sqlite/redis (round-2 reporter repro)', () => {
    async function writeMain(dir: string, decoratorBody: string): Promise<void> {
      await writeTextFile(
        dir,
        'src/main.ts',
        `import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp(${decoratorBody})
export default class App {}
`,
      );
      await writeTextFile(
        dir,
        'package.json',
        JSON.stringify({ name: 'cf-validate-fixture', version: '0.0.0', type: 'commonjs' }, null, 2),
      );
      await writeTextFile(
        dir,
        'frontmcp.config.js',
        `module.exports = {
  name: 'cf-validate-fixture',
  entry: './src/main.ts',
  deployments: [{ target: 'cloudflare' }],
};
`,
      );
    }

    it('aborts the build when @FrontMcp({...}) source has env-gated sqlite (the reporter repro)', async () => {
      tmp = await makeTmpProject('cf-sqlite');
      await writeMain(
        tmp,
        `{
  http: { port: 3000 },
  sqlite: process.env.REDIS_HOST
    ? undefined
    : { path: process.env.FRONTMCP_DB_PATH || '~/.frontegg-bin/data.db' },
}`,
      );

      const { stderr, stdout, exitCode } = runFrontmcp(tmp, ['build', '--target', 'cloudflare']);
      expect(exitCode).not.toBe(0);
      const combined = stdout + stderr;
      expect(combined).toMatch(/sqlite storage is not supported on --target cloudflare/i);
      // Ensure the failure happened pre-bundle — no dist artifacts written.
      expect(await fileExists(path.join(tmp, 'dist', 'cloudflare', 'index.js'))).toBe(false);
    });

    it('aborts the build when @FrontMcp({...}) source has env-gated redis', async () => {
      tmp = await makeTmpProject('cf-redis');
      await writeMain(
        tmp,
        `{
  http: { port: 3000 },
  redis: process.env.REDIS_HOST
    ? { host: process.env.REDIS_HOST, port: parseInt(process.env.REDIS_PORT || '6379', 10) }
    : undefined,
}`,
      );

      const { stderr, stdout, exitCode } = runFrontmcp(tmp, ['build', '--target', 'cloudflare']);
      expect(exitCode).not.toBe(0);
      expect(stdout + stderr).toMatch(/redis.*not supported on --target cloudflare/i);
    });

    it('aborts even on unconditional literal sqlite (round-1 case still covered)', async () => {
      tmp = await makeTmpProject('cf-sqlite-literal');
      await writeMain(
        tmp,
        `{
  http: { port: 3000 },
  sqlite: { path: '~/db.sqlite' },
}`,
      );

      const { stderr, stdout, exitCode } = runFrontmcp(tmp, ['build', '--target', 'cloudflare']);
      expect(exitCode).not.toBe(0);
      expect(stdout + stderr).toMatch(/sqlite storage is not supported on --target cloudflare/i);
    });
  });

  describe('#374 — wrangler.toml merges deployments[].wrangler config', () => {
    // The validate hook must pass for the build to reach `generateAdapterFiles`.
    // We bypass tsc entirely by giving the build a pre-baked .js entry that
    // doesn't actually need to compile — wrangler.toml emission happens in
    // `generateAdapterFiles` regardless of whether the bundler step succeeds
    // (the bundler is only invoked for `shouldBundle` adapters, which
    // cloudflare is not — it has its own non-bundling path).
    async function writeCloudflareFixture(dir: string, deploymentExtras: string): Promise<void> {
      await writeTextFile(
        dir,
        'src/main.js',
        `// Plain JS entry — no @FrontMcp metadata, no sqlite/redis literals,
// so cloudflareAdapter.validate is a no-op.
module.exports = {};
`,
      );
      await writeTextFile(
        dir,
        'package.json',
        JSON.stringify({ name: 'cf-wrangler-fixture', version: '0.0.0', type: 'commonjs' }, null, 2),
      );
      await writeTextFile(
        dir,
        'frontmcp.config.js',
        `module.exports = {
  name: 'cf-wrangler-fixture',
  entry: './src/main.js',
  deployments: [{ target: 'cloudflare'${deploymentExtras} }],
};
`,
      );
    }

    it('writes deployments[].wrangler.{name, compatibilityDate} into wrangler.toml', async () => {
      tmp = await makeTmpProject('cf-wrangler-merge');
      await writeCloudflareFixture(tmp, `, wrangler: { name: 'frontegg-bin', compatibilityDate: '2025-01-01' }`);

      const { stdout, stderr, exitCode } = runFrontmcp(tmp, ['build', '--target', 'cloudflare']);
      // Assert the build itself succeeded — otherwise a future regression that
      // (a) writes a wrangler.toml early and (b) crashes downstream could leave
      // these contents-only assertions passing while the actual build is broken.
      if (exitCode !== 0) {
        throw new Error(`Build exited ${exitCode}. Output:\n${stdout}${stderr}`);
      }
      expect(exitCode).toBe(0);

      const wranglerPath = path.join(tmp, 'wrangler.toml');

      // wrangler.toml MUST exist after the build — the test asserts its
      // contents, so silently skipping when it's missing would mask the
      // regression we're trying to catch (#374 round-1 + round-2).
      const exists = await fileExists(wranglerPath);
      if (!exists) {
        // Surface build output so the failure mode is debuggable.
        throw new Error(`wrangler.toml not written. Build output:\n${stdout}${stderr}`);
      }
      expect(exists).toBe(true);

      const toml = await readFile(wranglerPath);
      expect(toml).toContain('name = "frontegg-bin"');
      expect(toml).toContain('compatibility_date = "2025-01-01"');
      // main path must always reflect the build's actual output dir (#374 round-1 fix).
      expect(toml).toContain('main = "dist/cloudflare/index.js"');
    });

    it('falls back to defaults when deployments[].wrangler is omitted', async () => {
      tmp = await makeTmpProject('cf-wrangler-defaults');
      await writeCloudflareFixture(tmp, ''); // no `wrangler` field

      const { stdout, stderr, exitCode } = runFrontmcp(tmp, ['build', '--target', 'cloudflare']);
      if (exitCode !== 0) {
        throw new Error(`Build exited ${exitCode}. Output:\n${stdout}${stderr}`);
      }
      expect(exitCode).toBe(0);

      const wranglerPath = path.join(tmp, 'wrangler.toml');
      const exists = await fileExists(wranglerPath);
      if (!exists) {
        throw new Error(`wrangler.toml not written. Build output:\n${stdout}${stderr}`);
      }
      expect(exists).toBe(true);

      const toml = await readFile(wranglerPath);
      expect(toml).toContain('name = "frontmcp-worker"');
      expect(toml).toContain('compatibility_date = "2024-01-01"');
    });

    it('overwrites an existing wrangler.toml on every build (#374 round-1 alwaysWriteConfig)', async () => {
      tmp = await makeTmpProject('cf-wrangler-overwrite');
      await writeCloudflareFixture(tmp, `, wrangler: { name: 'updated-name', compatibilityDate: '2025-06-01' }`);
      // Pre-seed a stale wrangler.toml that points at the wrong main path.
      await writeTextFile(
        tmp,
        'wrangler.toml',
        `name = "stale-name"
main = "dist/index.js"
compatibility_date = "2024-01-01"
`,
      );

      const { stdout, stderr, exitCode } = runFrontmcp(tmp, ['build', '--target', 'cloudflare']);
      if (exitCode !== 0) {
        throw new Error(`Build exited ${exitCode}. Output:\n${stdout}${stderr}`);
      }
      expect(exitCode).toBe(0);

      const wranglerPath = path.join(tmp, 'wrangler.toml');
      if (!(await fileExists(wranglerPath))) {
        throw new Error(`wrangler.toml not written. Build output:\n${stdout}${stderr}`);
      }
      const toml = await readFile(wranglerPath);
      expect(toml).toContain('name = "updated-name"');
      expect(toml).toContain('compatibility_date = "2025-06-01"');
      expect(toml).toContain('main = "dist/cloudflare/index.js"');
      expect(toml).not.toContain('stale-name');
      expect(toml).not.toContain('main = "dist/index.js"');
    });
  });
});
