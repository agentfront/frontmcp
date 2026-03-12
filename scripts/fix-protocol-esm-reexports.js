/**
 * Post-build fix for @frontmcp/protocol ESM output.
 *
 * esbuild converts `export * from '@modelcontextprotocol/sdk/types.js'`
 * into a runtime __reExport() helper, but that doesn't create static ESM
 * named exports. ESM consumers (e.g. `import { AudioContentSchema }`)
 * fail because the names aren't in the static export list.
 *
 * This script appends a proper `export *` statement to the ESM bundle
 * so all MCP SDK type exports are visible to ESM consumers.
 */
const fs = require('fs');
const path = require('path');

const esmIndex = path.resolve(__dirname, '../libs/protocol/dist/esm/index.mjs');

if (!fs.existsSync(esmIndex)) {
  console.error(`❌ ESM index not found: ${esmIndex}`);
  process.exit(1);
}

const reexport = '\nexport * from "@modelcontextprotocol/sdk/types.js";\n';
const content = fs.readFileSync(esmIndex, 'utf8');

if (content.includes('export * from "@modelcontextprotocol/sdk/types.js"')) {
  console.log('✅ ESM re-export already present, skipping.');
  process.exit(0);
}

fs.appendFileSync(esmIndex, reexport);
console.log('✅ Appended MCP types re-export to protocol ESM bundle.');
