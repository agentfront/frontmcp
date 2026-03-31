---
name: stdio-transport-error-handling
reference: production-cli-binary
level: intermediate
description: 'Shows how to handle stdin/stdout transport correctly, implement proper exit codes, and handle edge cases like EOF and broken pipes.'
tags: [production, json-rpc, cli, transport, binary, stdio]
features:
  - 'Exit code conventions: 0 (success), 1 (user error), 2 (internal error)'
  - 'Using stderr for all logging since stdout is the MCP JSON-RPC channel'
  - 'Handling EOF on stdin and broken pipe on stdout gracefully'
  - 'Showing helpful error messages for unknown flags instead of stack traces'
  - 'Validating file paths to prevent writes to unexpected locations'
---

# Stdio Transport with Error Handling and Exit Codes

Shows how to handle stdin/stdout transport correctly, implement proper exit codes, and handle edge cases like EOF and broken pipes.

## Code

```typescript
#!/usr/bin/env node
// src/cli.ts

// Handle flags early — before any heavy imports
const args = process.argv.slice(2);
const unknownFlags = args.filter((a) => a.startsWith('-') && !['--version', '--help'].includes(a));

if (unknownFlags.length > 0) {
  // User error: unknown flags — show helpful message, not stack trace
  console.error(`Error: Unknown flag(s): ${unknownFlags.join(', ')}`);
  console.error('Run "my-mcp-cli --help" for usage.');
  process.exit(1); // Exit code 1: user error
}

if (args.includes('--version')) {
  console.error('my-mcp-cli v1.0.0');
  process.exit(0);
}

async function main() {
  try {
    // Lazy-load to keep startup fast
    const { FrontMcp } = await import('@frontmcp/sdk');
    const { MyApp } = await import('./my.app');

    // stderr for all logging — stdout is the MCP JSON-RPC channel
    console.error('[my-mcp-cli] Starting MCP server via stdio...');

    // Handle EOF on stdin gracefully
    process.stdin.on('end', () => {
      console.error('[my-mcp-cli] stdin closed. Exiting.');
      process.exit(0);
    });

    // Handle broken pipe on stdout gracefully
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        console.error('[my-mcp-cli] stdout pipe broken. Exiting.');
        process.exit(0);
      }
      console.error('[my-mcp-cli] stdout error:', err.message);
      process.exit(2); // Exit code 2: internal error
    });

    // Start the server (stdio transport)
    @FrontMcp({
      info: { name: 'my-mcp-cli', version: '1.0.0' },
      apps: [MyApp],
    })
    class CliServer {}
  } catch (err) {
    // Internal error: log to stderr, exit with code 2
    console.error('[my-mcp-cli] Fatal error:', err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

main();
```

```typescript
// src/tools/safe-tool.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'process_file',
  description: 'Process a file path safely',
  inputSchema: {
    path: z.string().min(1).describe('File path to process'),
  },
  outputSchema: {
    result: z.string(),
    path: z.string(),
  },
})
export class SafeFileTool extends ToolContext {
  async execute(input: { path: string }) {
    // Use os.homedir() and os.tmpdir() — no hardcoded paths
    const os = await import('os');
    const pathMod = await import('path');

    // Ensure we only read from safe locations
    const resolved = pathMod.resolve(input.path);
    const home = os.homedir();
    const tmp = os.tmpdir();

    const relToHome = pathMod.relative(home, resolved);
    const relToTmp = pathMod.relative(tmp, resolved);
    const isInHome = !relToHome.startsWith('..') && !pathMod.isAbsolute(relToHome);
    const isInTmp = !relToTmp.startsWith('..') && !pathMod.isAbsolute(relToTmp);
    if (!isInHome && !isInTmp) {
      this.fail(new Error('Path must be within home directory or temp directory'));
    }

    return { result: 'processed', path: resolved };
  }
}
```

## What This Demonstrates

- Exit code conventions: 0 (success), 1 (user error), 2 (internal error)
- Using stderr for all logging since stdout is the MCP JSON-RPC channel
- Handling EOF on stdin and broken pipe on stdout gracefully
- Showing helpful error messages for unknown flags instead of stack traces
- Validating file paths to prevent writes to unexpected locations

## Related

- See `production-cli-binary` for the full stdin/stdout transport and exit behavior checklist
