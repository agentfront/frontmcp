---
name: security-and-permissions
reference: production-cli-daemon
level: advanced
description: 'Shows how to secure a local daemon with restrictive socket permissions, XDG-compliant config storage, and file-based secret management.'
tags: [production, cli, transport, security, local, node]
features:
  - 'XDG Base Directory compliance for config and data storage'
  - 'Restrictive file permissions: config at `700`, secrets at `600`'
  - 'Verifying secret file permissions before reading (fail if insecure)'
  - 'Socket-only transport with no TCP network exposure'
  - 'Using `@frontmcp/utils` for file operations instead of `node:fs`'
---

# Daemon Security: Socket Permissions, Config Storage, and Secret Management

Shows how to secure a local daemon with restrictive socket permissions, XDG-compliant config storage, and file-based secret management.

## Code

```typescript
// src/lifecycle/daemon-security.ts
import { stat, writeFile, fileExists, ensureDir, readFile } from '@frontmcp/utils';
import { chmod } from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// XDG Base Directory compliance
function getConfigDir(appName: string): string {
  return process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, appName)
    : path.join(os.homedir(), '.config', appName);
}

function getDataDir(appName: string): string {
  return process.env.XDG_DATA_HOME
    ? path.join(process.env.XDG_DATA_HOME, appName)
    : path.join(os.homedir(), '.local', 'share', appName);
}

export async function ensureSecureSetup(appName: string): Promise<{
  configDir: string;
  dataDir: string;
}> {
  const configDir = getConfigDir(appName);
  const dataDir = getDataDir(appName);

  // Create directories with restrictive permissions
  await ensureDir(configDir);
  await ensureDir(dataDir);

  // Config directory: owner-only access (700)
  await chmod(configDir, 0o700);

  // Secrets file: owner-only read/write (600)
  const secretsFile = path.join(configDir, 'secrets.json');
  if (await fileExists(secretsFile)) {
    await chmod(secretsFile, 0o600);
  }

  return { configDir, dataDir };
}

export async function loadSecrets(configDir: string): Promise<Record<string, string>> {
  const secretsFile = path.join(configDir, 'secrets.json');

  if (!(await fileExists(secretsFile))) {
    return {};
  }

  // Verify permissions before reading
  const fileStat = await stat(secretsFile);
  const mode = fileStat.mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(
      `Secrets file has insecure permissions: ${mode.toString(8)}. Expected 600. ` +
        `Fix with: chmod 600 ${secretsFile}`,
    );
  }

  const content = await readFile(secretsFile);
  return JSON.parse(content);
}
```

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';
import { MyApp } from './my.app';

@FrontMcp({
  info: { name: 'secure-daemon', version: '1.0.0' },
  apps: [MyApp],

  // Socket-only — no TCP network exposure
  http: {
    socketPath: '/tmp/secure-daemon.sock',
  },

  // SQLite in the data directory (persistent, writable)
  sqlite: {
    path: `${process.env.XDG_DATA_HOME ?? process.env.HOME + '/.local/share'}/secure-daemon/data.db`,
    wal: true,
  },
})
export default class SecureDaemonServer {}
```

## What This Demonstrates

- XDG Base Directory compliance for config and data storage
- Restrictive file permissions: config at `700`, secrets at `600`
- Verifying secret file permissions before reading (fail if insecure)
- Socket-only transport with no TCP network exposure
- Using `@frontmcp/utils` for file operations instead of `node:fs`

## Related

- See `production-cli-daemon` for the full security and storage checklist
