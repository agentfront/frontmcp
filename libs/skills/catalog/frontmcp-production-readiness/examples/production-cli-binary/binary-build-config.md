---
name: binary-build-config
reference: production-cli-binary
level: basic
description: 'Shows how to configure a FrontMCP CLI binary with correct package.json `bin` field, shebang, stdio transport, and npm distribution settings.'
tags: [production, cli, transport, node, binary, config]
features:
  - 'Correct `bin` field in package.json pointing to the built output'
  - 'Shebang line (`#!/usr/bin/env node`) for direct execution'
  - 'Handling `--version` and `--help` flags before server initialization'
  - 'Using stderr for logging (stdout is the MCP channel)'
  - '`files` field excluding source, tests, and config from the published package'
---

# CLI Binary Build and Package Configuration

Shows how to configure a FrontMCP CLI binary with correct package.json `bin` field, shebang, stdio transport, and npm distribution settings.

## Code

```jsonc
// package.json
{
  "name": "my-mcp-cli",
  "version": "1.0.0",
  "description": "MCP CLI tool for data processing",
  "keywords": ["mcp", "cli", "data-processing"],
  "license": "MIT",

  // Binary entry point
  "bin": {
    "my-mcp-cli": "./dist/cli.js",
  },

  // Only ship what users need
  "files": ["dist/", "README.md", "LICENSE"],

  // Required Node.js version
  "engines": {
    "node": ">=18.0.0",
  },

  "dependencies": {
    "@frontmcp/sdk": "^1.0.0",
    "zod": "^4.0.0",
  },

  "scripts": {
    "build": "frontmcp build --target cli",
    "test": "jest --coverage",
    "prepublishOnly": "npm run build && npm test",
  },
}
```

```typescript
#!/usr/bin/env node
// src/cli.ts
import { FrontMcp } from '@frontmcp/sdk';
import { MyApp } from './my.app';

// Handle --version and --help before server initialization
if (process.argv.includes('--version')) {
  console.error('my-mcp-cli v1.0.0');
  process.exit(0);
}

if (process.argv.includes('--help')) {
  console.error('Usage: my-mcp-cli');
  console.error('  Runs an MCP server via stdio transport.');
  console.error('  Reads JSON-RPC from stdin, writes to stdout.');
  console.error('');
  console.error('Options:');
  console.error('  --version  Show version');
  console.error('  --help     Show this help');
  process.exit(0);
}

@FrontMcp({
  info: { name: 'my-mcp-cli', version: '1.0.0' },
  apps: [MyApp],
  // Stdio transport: reads JSON-RPC from stdin, writes to stdout
})
class CliServer {}
```

```bash
# Build and verify
frontmcp build --target cli

# Verify binary starts quickly
time my-mcp-cli --help    # Should complete in < 500ms
time my-mcp-cli --version # Should complete in < 500ms

# Test stdio transport
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | my-mcp-cli
```

## What This Demonstrates

- Correct `bin` field in package.json pointing to the built output
- Shebang line (`#!/usr/bin/env node`) for direct execution
- Handling `--version` and `--help` flags before server initialization
- Using stderr for logging (stdout is the MCP channel)
- `files` field excluding source, tests, and config from the published package

## Related

- See `production-cli-binary` for the full build and distribution checklist
