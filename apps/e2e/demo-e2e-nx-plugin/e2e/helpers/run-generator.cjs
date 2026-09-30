/* Runs one generator from the built @frontmcp/nx package in a plain Node process (outside jest), the way the Nx CLI does. */
const { readFileSync } = require('fs');
const { join } = require('path');
const { FsTree, flushChanges } = require('nx/src/generators/tree');

async function main() {
  const [, , pluginDist, root, name, optionsJson] = process.argv;
  const manifest = JSON.parse(readFileSync(join(pluginDist, 'generators.json'), 'utf8'));
  const entry = manifest.generators[name];
  if (!entry) throw new Error(`Generator "${name}" is not registered in generators.json`);
  const generator = require(join(pluginDist, entry.factory)).default;
  const tree = new FsTree(root, false);
  const task = await generator(tree, JSON.parse(optionsJson));
  flushChanges(root, tree.listChanges());
  void task;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
