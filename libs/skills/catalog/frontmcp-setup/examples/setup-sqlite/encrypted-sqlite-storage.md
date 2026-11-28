---
name: encrypted-sqlite-storage
reference: setup-sqlite
level: intermediate
description: 'Enable AES-256-GCM at-rest encryption of the values stored in SQLite.'
tags: [setup, sqlite, session, database, encrypted, storage]
features:
  - '`encryption.secret` enables AES-256-GCM encryption of every value, with HKDF-SHA256 key derivation'
  - 'Keys are stored as written: never put a secret in a key'
  - 'The secret must be at least 32 characters and sourced from environment variables'
  - 'The same secret must be used across server restarts to decrypt existing data'
  - 'Never hardcode the encryption secret in source code'
---

# Encrypted SQLite Storage

Enable AES-256-GCM at-rest encryption of the values stored in SQLite.

The keys stay readable to whoever can read the file: FrontMCP's auth stores keep no code or token in one.

## Code

```typescript
// src/main.ts
import 'reflect-metadata';

import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'secure-server', version: '0.1.0' },
  apps: [
    /* ... */
  ],
  sqlite: {
    path: '~/.frontmcp/data/sessions.sqlite',
    walMode: true,
    encryption: {
      secret: process.env['SQLITE_ENCRYPTION_SECRET']!,
    },
  },
})
export default class Server {}
```

```env
# .env (secret must be at least 32 characters)
SQLITE_ENCRYPTION_SECRET=my-super-secret-key-at-least-32-characters-long
```

## What This Demonstrates

- `encryption.secret` enables AES-256-GCM encryption of every value, with HKDF-SHA256 key derivation
- Keys are stored as written: never put a secret in a key
- The secret must be at least 32 characters and sourced from environment variables
- The same secret must be used across server restarts to decrypt existing data
- Never hardcode the encryption secret in source code

## Related

- See `setup-sqlite` for WAL mode details, TTL cleanup, and migration to Redis
