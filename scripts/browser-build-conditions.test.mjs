// Guards the builds that let a browser bundler use the browser variants the @frontmcp packages
// declare in their `imports` maps (#681).
//
// A `#` subpath import that the package's own esbuild build resolves is baked to its default
// (Node) variant: @frontmcp/protocol shipped the stdio client (cross-spawn → `process.platform`
// at load) and @frontmcp/utils the Node runtime-context (`process.platform`) inside their ESM
// bundles, so a plain Vite app died at load. A split must stay external, with each variant built
// as its own entry point, so the consumer's bundler picks the variant. The SDK's own splits
// (`#express-host`, `#sse-transport`) wrap SDK internals, so it instead ships a browser-conditioned
// bundle (`dist/browser`) exposed through a `browser` export condition.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8'));

for (const pkgDir of ['libs/utils', 'libs/protocol']) {
  const pkg = read(`${pkgDir}/package.json`);
  const project = read(`${pkgDir}/project.json`);

  for (const targetName of ['build-cjs', 'build-esm']) {
    test(`${pkgDir} ${targetName}: every subpath import stays external and each variant is built`, () => {
      const options = project.targets[targetName].options;
      const external = options.esbuildOptions?.external ?? [];
      const entries = new Set(options.additionalEntryPoints ?? []);
      for (const [specifier, variants] of Object.entries(pkg.imports ?? {})) {
        assert.ok(external.includes(specifier), `${specifier} must be external in ${targetName}`);
        for (const file of new Set(Object.values(variants))) {
          const entry = path.posix.join(pkgDir, file.replace(/^\.\//, ''));
          assert.ok(entries.has(entry), `${entry} (${specifier}) must be an entry point of ${targetName}`);
        }
      }
    });
  }
}

test('libs/sdk: a browser bundler gets the browser-conditioned bundle', () => {
  const pkg = read('libs/sdk/package.json');
  const project = read('libs/sdk/project.json');
  const root = pkg.exports['.'];
  const keys = Object.keys(root);

  assert.equal(root.browser?.import, './dist/browser/index.mjs');
  assert.ok(keys.indexOf('browser') < keys.indexOf('import'), '"browser" must come before "import"');

  const browserBuild = project.targets['build-esm-browser'];
  assert.equal(browserBuild.options.outputPath, 'libs/sdk/dist/browser');
  assert.ok(browserBuild.options.esbuildOptions.conditions.includes('browser'));
  assert.deepEqual(
    [...browserBuild.options.esbuildOptions.external].sort(),
    [...project.targets['build-esm'].options.esbuildOptions.external].sort(),
    'the browser bundle must keep the same packages external as the ESM bundle',
  );

  const build = project.targets.build;
  assert.ok(build.dependsOn.includes('build-esm-browser'));
  assert.ok(build.options.commands.some((cmd) => /inject-esm-require-banner\.js .*libs\/sdk\/dist\/browser/.test(cmd)));
});
