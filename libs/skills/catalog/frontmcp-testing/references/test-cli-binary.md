---
name: test-cli-binary
description: Test CLI binary and SEA build for startup, health check, and JS bundle import
---

# Testing CLI Binary / SEA Build

After building with `frontmcp build --target cli`, test the binary:

```typescript
import { execSync, spawn } from 'child_process';
import * as path from 'path';

const BINARY = path.resolve(__dirname, '../dist/my-server');

describe('CLI Binary', () => {
  it('should start and respond to health check', async () => {
    const child = spawn(BINARY, [], {
      env: { ...process.env, PORT: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for server to start
    await new Promise<void>((resolve) => {
      child.stdout.on('data', (data: Buffer) => {
        if (data.toString().includes('listening')) resolve();
      });
    });

    // Test health endpoint
    const res = await fetch('http://localhost:3001/health');
    expect(res.ok).toBe(true);

    child.kill();
  });

  it('should exit with code 0 on --help', () => {
    const output = execSync(`${BINARY} --help`, { encoding: 'utf-8' });
    expect(output).toContain('Usage');
  });
});
```

## Testing JS Bundle

```typescript
describe('JS Bundle', () => {
  it('should be importable', async () => {
    const mod = await import('../dist/my-server.cjs.js');
    expect(mod).toBeDefined();
  });
});
```

## Examples

| Example                                                                         | Level        | Description                                                                                                        |
| ------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| [`binary-startup-test`](../examples/test-cli-binary/binary-startup-test.md)     | Basic        | Verify that a compiled CLI binary starts correctly and responds to health checks.                                  |
| [`js-bundle-import-test`](../examples/test-cli-binary/js-bundle-import-test.md) | Intermediate | Verify that the compiled JS bundle can be imported and exports the expected modules after a `frontmcp build` step. |

> See all examples in [`examples/test-cli-binary/`](../examples/test-cli-binary/)
