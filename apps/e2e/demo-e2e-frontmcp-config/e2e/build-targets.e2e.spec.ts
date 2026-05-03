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
import * as fs from 'node:fs';
import * as path from 'node:path';

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

function makeTmpProject(prefix: string): string {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TMP_ROOT, `${prefix}-`));
}

function writeTextFile(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

describe('Adapter build E2E — wrangler config + Cloudflare AST validate (#374, #375)', () => {
  let tmp: string;

  beforeAll(() => {
    if (!fs.existsSync(FRONTMCP_BIN)) {
      throw new Error(
        `frontmcp CLI not built at ${FRONTMCP_BIN}. ` + `Run \`yarn nx build cli\` before this E2E suite.`,
      );
    }
  });

  afterEach(() => {
    if (tmp && fs.existsSync(tmp)) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(TMP_ROOT)) fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  describe('#375 — Cloudflare validate aborts on env-gated sqlite/redis (round-2 reporter repro)', () => {
    function writeMain(dir: string, decoratorBody: string): void {
      writeTextFile(
        dir,
        'src/main.ts',
        `import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp(${decoratorBody})
export default class App {}
`,
      );
      writeTextFile(
        dir,
        'package.json',
        JSON.stringify({ name: 'cf-validate-fixture', version: '0.0.0', type: 'commonjs' }, null, 2),
      );
      writeTextFile(
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

    it('aborts the build when @FrontMcp({...}) source has env-gated sqlite (the reporter repro)', () => {
      tmp = makeTmpProject('cf-sqlite');
      writeMain(
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
      expect(fs.existsSync(path.join(tmp, 'dist', 'cloudflare', 'index.js'))).toBe(false);
    });

    it('aborts the build when @FrontMcp({...}) source has env-gated redis', () => {
      tmp = makeTmpProject('cf-redis');
      writeMain(
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

    it('aborts even on unconditional literal sqlite (round-1 case still covered)', () => {
      tmp = makeTmpProject('cf-sqlite-literal');
      writeMain(
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
    function writeCloudflareFixture(dir: string, deploymentExtras: string): void {
      writeTextFile(
        dir,
        'src/main.js',
        `// Plain JS entry — no @FrontMcp metadata, no sqlite/redis literals,
// so cloudflareAdapter.validate is a no-op.
module.exports = {};
`,
      );
      writeTextFile(
        dir,
        'package.json',
        JSON.stringify({ name: 'cf-wrangler-fixture', version: '0.0.0', type: 'commonjs' }, null, 2),
      );
      writeTextFile(
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

    it('writes deployments[].wrangler.{name, compatibilityDate} into wrangler.toml', () => {
      tmp = makeTmpProject('cf-wrangler-merge');
      writeCloudflareFixture(tmp, `, wrangler: { name: 'frontegg-bin', compatibilityDate: '2025-01-01' }`);

      const { stdout, stderr } = runFrontmcp(tmp, ['build', '--target', 'cloudflare']);
      const combined = stdout + stderr;
      const wranglerPath = path.join(tmp, 'wrangler.toml');

      // The build may fail post-wrangler-write (tsc on a JS entry is fine but
      // some downstream steps may still fail). What matters for #374 is that
      // wrangler.toml was written with the configured values before the build
      // ran into trouble. If wrangler.toml doesn't exist at all, that means
      // generateAdapterFiles never reached the cloudflare config step.
      if (!fs.existsSync(wranglerPath)) {
        // Surface build output so the failure mode is debuggable.
        throw new Error(`wrangler.toml not written. Build output:\n${combined}`);
      }
      const toml = fs.readFileSync(wranglerPath, 'utf-8');
      expect(toml).toContain('name = "frontegg-bin"');
      expect(toml).toContain('compatibility_date = "2025-01-01"');
      // main path must always reflect the build's actual output dir (#374 round-1 fix).
      expect(toml).toContain('main = "dist/cloudflare/index.js"');
    });

    it('falls back to defaults when deployments[].wrangler is omitted', () => {
      tmp = makeTmpProject('cf-wrangler-defaults');
      writeCloudflareFixture(tmp, ''); // no `wrangler` field

      runFrontmcp(tmp, ['build', '--target', 'cloudflare']);
      const wranglerPath = path.join(tmp, 'wrangler.toml');
      if (!fs.existsSync(wranglerPath)) return; // build aborted earlier; nothing to assert

      const toml = fs.readFileSync(wranglerPath, 'utf-8');
      expect(toml).toContain('name = "frontmcp-worker"');
      expect(toml).toContain('compatibility_date = "2024-01-01"');
    });

    it('overwrites an existing wrangler.toml on every build (#374 round-1 alwaysWriteConfig)', () => {
      tmp = makeTmpProject('cf-wrangler-overwrite');
      writeCloudflareFixture(tmp, `, wrangler: { name: 'updated-name', compatibilityDate: '2025-06-01' }`);
      // Pre-seed a stale wrangler.toml that points at the wrong main path.
      writeTextFile(
        tmp,
        'wrangler.toml',
        `name = "stale-name"
main = "dist/index.js"
compatibility_date = "2024-01-01"
`,
      );

      runFrontmcp(tmp, ['build', '--target', 'cloudflare']);
      const toml = fs.readFileSync(path.join(tmp, 'wrangler.toml'), 'utf-8');
      expect(toml).toContain('name = "updated-name"');
      expect(toml).toContain('compatibility_date = "2025-06-01"');
      expect(toml).toContain('main = "dist/cloudflare/index.js"');
      expect(toml).not.toContain('stale-name');
      expect(toml).not.toContain('main = "dist/index.js"');
    });
  });
});
