# Required SDK Changes

Specific modifications needed in `libs/sdk` to support browser environments.

## Overview

Two approaches are possible:

1. **Approach A: Dual Build** - Modify SDK to conditionally use browser APIs
2. **Approach B: Browser Package** - Create separate `@frontmcp/browser` that doesn't depend on SDK

**Recommended: Approach B** - Keep SDK for Node.js, create new browser package.

This document covers minimal SDK changes needed if sharing code between packages.

---

## Priority 1: Create Platform-Agnostic Crypto Utilities

### New File: `libs/sdk/src/utils/platform-crypto.ts`

```typescript
/**
 * Platform-agnostic crypto utilities
 * Works in both Node.js and browser environments
 */

/**
 * Generate a UUID v4
 * Uses native crypto.randomUUID() available in both Node.js 19+ and modern browsers
 */
export function generateUUID(): string {
  // crypto.randomUUID() is available in:
  // - Node.js 19+
  // - All modern browsers
  // - Web Workers
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate random bytes
 */
export function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
    return bytes;
  }

  // Fallback (not cryptographically secure - only for non-security use)
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/**
 * Generate random bytes as hex string
 */
export function getRandomHex(length: number): string {
  const bytes = getRandomBytes(length);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create SHA-256 hash (async - required for Web Crypto)
 */
export async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  throw new Error('Web Crypto API not available');
}

/**
 * Create SHA-256 hash synchronously (Node.js only)
 * @throws in browser environment
 */
export function sha256Sync(data: string): string {
  // This will only work in Node.js
  // In browser, use sha256() async version
  if (typeof process !== 'undefined' && process.versions?.node) {
    // Dynamic import to avoid bundling issues
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHash } = require('crypto');
    return createHash('sha256').update(data).digest('hex');
  }

  throw new Error('sha256Sync is only available in Node.js. Use sha256() in browser.');
}
```

---

## Priority 2: Files to Modify

### File: `libs/sdk/src/flows/flow.instance.ts`

**Current (Line 8):**

```typescript
import { randomUUID } from 'crypto';
```

**Change to:**

```typescript
import { generateUUID } from '../utils/platform-crypto.js';
```

**Update usage:**

```typescript
// Before
const id = randomUUID();

// After
const id = generateUUID();
```

---

### File: `libs/sdk/src/flows/flow.registry.ts`

**Current (Line 4):**

```typescript
import { randomUUID } from 'crypto';
```

**Change to:**

```typescript
import { generateUUID } from '../utils/platform-crypto.js';
```

---

### File: `libs/sdk/src/errors/mcp.error.ts`

**Current (Line 3):**

```typescript
import { randomBytes } from 'crypto';
```

**Change to:**

```typescript
import { getRandomHex } from '../utils/platform-crypto.js';
```

**Update usage:**

```typescript
// Before
const errorId = randomBytes(4).toString('hex');

// After
const errorId = getRandomHex(4);
```

---

### File: `libs/sdk/src/common/interfaces/execution-context.interface.ts`

**Current (Line 3):**

```typescript
import { randomUUID } from 'crypto';
```

**Change to:**

```typescript
import { generateUUID } from '../../utils/platform-crypto.js';
```

---

### File: `libs/sdk/src/transport/transport.registry.ts`

**Current (Line 4):**

```typescript
import { createHash } from 'crypto';
```

**Change to:**

```typescript
import { sha256Sync } from '../utils/platform-crypto.js';
```

**Note:** This file uses sync hashing. For browser compatibility, this would need to be refactored to async, which is a larger change.

**Alternative for browser:** Use a simple hash function that doesn't require crypto:

```typescript
// Simple non-crypto hash for transport keys (not security-sensitive)
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}
```

---

### File: `libs/sdk/src/tool/flows/call-tool.flow.ts`

**Current (Line 5):**

```typescript
import { randomUUID } from 'crypto';
```

**Change to:**

```typescript
import { generateUUID } from '../../utils/platform-crypto.js';
```

**Also update process.env usage:**

```typescript
// Before
if (process.env['DEBUG']) { ... }
if (process.env['NODE_ENV'] === 'development') { ... }

// After - inject config
constructor(private config: { debug?: boolean; isDev?: boolean }) {}
if (this.config.debug) { ... }
if (this.config.isDev) { ... }
```

---

## Priority 3: Configuration Injection Pattern

### Replace `process.env` with Config Object

**Create:** `libs/sdk/src/config/runtime-config.ts`

```typescript
export interface RuntimeConfig {
  /** Debug mode enabled */
  debug: boolean;

  /** Development environment */
  isDevelopment: boolean;

  /** Machine identifier for distributed deployments */
  machineId: string;

  /** Session encryption secret (optional, for auth) */
  sessionSecret?: string;

  /** JWT secret (optional, for auth) */
  jwtSecret?: string;
}

let globalConfig: RuntimeConfig | null = null;

/**
 * Initialize runtime configuration
 * Call once at application startup
 */
export function initializeConfig(config: Partial<RuntimeConfig>): void {
  globalConfig = {
    debug: config.debug ?? false,
    isDevelopment: config.isDevelopment ?? false,
    machineId: config.machineId ?? generateUUID(),
    sessionSecret: config.sessionSecret,
    jwtSecret: config.jwtSecret,
  };
}

/**
 * Get runtime configuration
 * Falls back to process.env in Node.js if not initialized
 */
export function getConfig(): RuntimeConfig {
  if (globalConfig) {
    return globalConfig;
  }

  // Fallback for Node.js (backward compatibility)
  if (typeof process !== 'undefined' && process.env) {
    return {
      debug: process.env['DEBUG'] === 'true',
      isDevelopment: process.env['NODE_ENV'] === 'development',
      machineId: process.env['MACHINE_ID'] ?? generateUUID(),
      sessionSecret: process.env['MCP_SESSION_SECRET'],
      jwtSecret: process.env['JWT_SECRET'],
    };
  }

  throw new Error('Runtime config not initialized. Call initializeConfig() first.');
}
```

---

## Files to Exclude from Browser Build

These files should NOT be included in browser builds:

```
libs/sdk/src/auth/                    # All auth (OAuth, JWT, JWKS)
libs/sdk/src/server/adapters/         # Express/HTTP adapters
libs/sdk/src/transport/legacy/        # SSE transport (HTTP-based)
libs/sdk/src/store/adapters/store.redis.adapter.ts  # Redis store
```

### Package.json Exports Configuration

```json
{
  "exports": {
    ".": {
      "node": "./dist/node/index.js",
      "browser": "./dist/browser/index.js",
      "default": "./dist/node/index.js"
    },
    "./browser": {
      "browser": "./dist/browser/index.js",
      "default": "./dist/browser/index.js"
    }
  }
}
```

---

## Testing Browser Compatibility

### Create Test File: `libs/sdk/src/utils/platform-crypto.spec.ts`

```typescript
import { generateUUID, getRandomBytes, getRandomHex, sha256 } from './platform-crypto';

describe('Platform Crypto', () => {
  describe('generateUUID', () => {
    it('should generate valid UUID v4', () => {
      const uuid = generateUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set(Array.from({ length: 100 }, () => generateUUID()));
      expect(uuids.size).toBe(100);
    });
  });

  describe('getRandomBytes', () => {
    it('should return correct length', () => {
      const bytes = getRandomBytes(16);
      expect(bytes.length).toBe(16);
    });

    it('should return Uint8Array', () => {
      const bytes = getRandomBytes(8);
      expect(bytes).toBeInstanceOf(Uint8Array);
    });
  });

  describe('getRandomHex', () => {
    it('should return hex string of correct length', () => {
      const hex = getRandomHex(8);
      expect(hex.length).toBe(16); // 8 bytes = 16 hex chars
      expect(hex).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('sha256', () => {
    it('should hash string correctly', async () => {
      const hash = await sha256('hello');
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });
  });
});
```

---

## Migration Checklist

- [ ] Create `libs/sdk/src/utils/platform-crypto.ts`
- [ ] Update `libs/sdk/src/flows/flow.instance.ts`
- [ ] Update `libs/sdk/src/flows/flow.registry.ts`
- [ ] Update `libs/sdk/src/errors/mcp.error.ts`
- [ ] Update `libs/sdk/src/common/interfaces/execution-context.interface.ts`
- [ ] Update `libs/sdk/src/transport/transport.registry.ts`
- [ ] Update `libs/sdk/src/tool/flows/call-tool.flow.ts`
- [ ] Create `libs/sdk/src/config/runtime-config.ts`
- [ ] Update files using `process.env` to use config
- [ ] Add platform-crypto tests
- [ ] Configure dual build in package.json
- [ ] Test in browser environment
