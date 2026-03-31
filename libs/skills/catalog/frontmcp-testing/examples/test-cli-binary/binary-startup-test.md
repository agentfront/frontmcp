---
name: binary-startup-test
reference: test-cli-binary
level: basic
description: 'Verify that a compiled CLI binary starts correctly and responds to health checks.'
tags: [testing, cli, binary, startup]
features:
  - 'Using `execSync` to test that `--help` flag exits with code 0 and prints usage info'
  - 'Spawning the binary as a child process with `PORT=0` for dynamic port assignment'
  - 'Waiting for the "listening" log message before sending requests'
  - 'Testing the `/health` endpoint for server readiness'
  - 'Cleaning up the child process with `child.kill()`'
---

# Testing CLI Binary Startup and Health Check

Verify that a compiled CLI binary starts correctly and responds to health checks.

## Code

```typescript
// src/__tests__/cli-binary.spec.ts
import { spawn, execSync } from 'child_process';
import * as path from 'path';

const BINARY = path.resolve(__dirname, '../dist/my-server');

describe('CLI Binary', () => {
  it('should exit with code 0 on --help', () => {
    const output = execSync(`${BINARY} --help`, { encoding: 'utf-8' });
    expect(output).toContain('Usage');
  });

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
});
```

## What This Demonstrates

- Using `execSync` to test that `--help` flag exits with code 0 and prints usage info
- Spawning the binary as a child process with `PORT=0` for dynamic port assignment
- Waiting for the "listening" log message before sending requests
- Testing the `/health` endpoint for server readiness
- Cleaning up the child process with `child.kill()`

## Related

- See `test-cli-binary` for the full CLI binary testing reference
