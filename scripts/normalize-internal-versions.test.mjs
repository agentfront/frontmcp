import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptPath = path.join(__dirname, 'normalize-internal-versions.mjs');

const tempDirs = [];

after(async () => {
  for (const dir of tempDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

/**
 * Materialize a fake workspace and run the script inside it.
 * @param {Record<string, Record<string, any>>} layout keyed by "<dir>/<name>"
 * @param {string[]} args
 */
async function run(layout, args = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'normalize-versions-'));
  tempDirs.push(root);

  for (const [rel, pkg] of Object.entries(layout)) {
    const dir = path.join(root, rel);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  }

  const res = spawnSync(process.execPath, [scriptPath, ...args], { cwd: root, encoding: 'utf8' });

  const read = async (rel) => JSON.parse(await fs.readFile(path.join(root, rel, 'package.json'), 'utf8'));
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, read };
}

test('rewrites version and internal pins to an explicit target', async () => {
  const { status, read } = await run(
    {
      'libs/sdk': {
        name: '@frontmcp/sdk',
        version: '1.5.6',
        dependencies: { '@frontmcp/utils': '1.5.6', zod: '^4.0.0' },
        peerDependencies: { '@frontmcp/observability': '1.5.6' },
      },
      'libs/utils': { name: '@frontmcp/utils', version: '1.4.0' },
    },
    ['1.4.0'],
  );

  assert.equal(status, 0);
  const sdk = await read('libs/sdk');
  assert.equal(sdk.version, '1.4.0');
  assert.equal(sdk.dependencies['@frontmcp/utils'], '1.4.0');
  assert.equal(sdk.peerDependencies['@frontmcp/observability'], '1.4.0');
});

test('leaves external dependencies untouched', async () => {
  const { read } = await run(
    {
      'libs/sdk': {
        name: '@frontmcp/sdk',
        version: '1.5.6',
        dependencies: { zod: '^4.0.0', 'mcp-from-openapi': '2.5.1', '@enclave-vm/core': '^2.15.1' },
      },
    },
    ['1.4.0'],
  );

  const sdk = await read('libs/sdk');
  assert.equal(sdk.dependencies['zod'], '^4.0.0');
  assert.equal(sdk.dependencies['mcp-from-openapi'], '2.5.1');
  assert.equal(sdk.dependencies['@enclave-vm/core'], '^2.15.1');
});

test('covers plugins/ as well as libs/', async () => {
  const { read } = await run(
    {
      'libs/sdk': { name: '@frontmcp/sdk', version: '1.4.0' },
      'plugins/plugin-codecall': {
        name: '@frontmcp/plugin-codecall',
        version: '1.5.6',
        dependencies: { '@frontmcp/sdk': '1.5.6' },
      },
    },
    ['1.4.0'],
  );

  const plugin = await read('plugins/plugin-codecall');
  assert.equal(plugin.version, '1.4.0');
  assert.equal(plugin.dependencies['@frontmcp/sdk'], '1.4.0');
});

test('infers the majority version when no target is given', async () => {
  // The real cherry-pick shape: two manifests dragged to the release line, the
  // rest still on the branch's own line. The majority must win.
  const { status, stdout, read } = await run({
    'libs/a': { name: '@frontmcp/a', version: '1.4.0' },
    'libs/b': { name: '@frontmcp/b', version: '1.4.0' },
    'libs/c': { name: '@frontmcp/c', version: '1.4.0' },
    'libs/sdk': { name: '@frontmcp/sdk', version: '1.5.6', dependencies: { '@frontmcp/a': '1.5.6' } },
  });

  assert.equal(status, 0);
  assert.match(stdout, /Target version: 1\.4\.0/);
  const sdk = await read('libs/sdk');
  assert.equal(sdk.version, '1.4.0');
  assert.equal(sdk.dependencies['@frontmcp/a'], '1.4.0');
});

test('refuses to guess when two versions are equally common', async () => {
  const { status, stderr } = await run({
    'libs/a': { name: '@frontmcp/a', version: '1.4.0' },
    'libs/b': { name: '@frontmcp/b', version: '1.5.6' },
  });

  assert.equal(status, 1);
  assert.match(stderr, /equally common/);
});

test('--check reports drift without writing', async () => {
  const { status, stderr, read } = await run(
    {
      'libs/sdk': { name: '@frontmcp/sdk', version: '1.5.6', dependencies: { '@frontmcp/utils': '1.5.6' } },
      'libs/utils': { name: '@frontmcp/utils', version: '1.4.0' },
    },
    ['1.4.0', '--check'],
  );

  assert.equal(status, 1);
  assert.match(stderr, /do not match v1\.4\.0/);
  // Unchanged on disk.
  assert.equal((await read('libs/sdk')).version, '1.5.6');
});

test('--check passes on a consistent workspace', async () => {
  const { status, stdout } = await run(
    {
      'libs/sdk': { name: '@frontmcp/sdk', version: '1.4.0', dependencies: { '@frontmcp/utils': '1.4.0' } },
      'libs/utils': { name: '@frontmcp/utils', version: '1.4.0' },
    },
    ['1.4.0', '--check'],
  );

  assert.equal(status, 0);
  assert.match(stdout, /already on v1\.4\.0/);
});

test('is idempotent', async () => {
  const layout = {
    'libs/sdk': { name: '@frontmcp/sdk', version: '1.5.6', dependencies: { '@frontmcp/utils': '1.5.6' } },
    'libs/utils': { name: '@frontmcp/utils', version: '1.4.0' },
  };
  const first = await run(layout, ['1.4.0']);
  assert.equal(first.status, 0);

  const second = await run(
    {
      'libs/sdk': await first.read('libs/sdk'),
      'libs/utils': await first.read('libs/utils'),
    },
    ['1.4.0', '--check'],
  );
  assert.equal(second.status, 0);
});

test('skips protocol ranges such as workspace:', async () => {
  // Not used today, but if the repo ever migrates internal deps to the workspace
  // protocol these must not be clobbered back into exact pins.
  const { read } = await run(
    {
      'libs/sdk': { name: '@frontmcp/sdk', version: '1.5.6', dependencies: { '@frontmcp/utils': 'workspace:^' } },
    },
    ['1.4.0'],
  );

  assert.equal((await read('libs/sdk')).dependencies['@frontmcp/utils'], 'workspace:^');
});

test('rejects a malformed explicit version', async () => {
  const { status, stderr } = await run({ 'libs/sdk': { name: '@frontmcp/sdk', version: '1.4.0' } }, ['not-a-version']);

  assert.equal(status, 1);
  assert.match(stderr, /Invalid version/);
});

test('accepts prerelease targets', async () => {
  const { status, read } = await run(
    {
      'libs/sdk': { name: '@frontmcp/sdk', version: '1.4.0', dependencies: { '@frontmcp/utils': '1.4.0' } },
    },
    ['1.5.0-beta.1'],
  );

  assert.equal(status, 0);
  const sdk = await read('libs/sdk');
  assert.equal(sdk.version, '1.5.0-beta.1');
  assert.equal(sdk.dependencies['@frontmcp/utils'], '1.5.0-beta.1');
});
