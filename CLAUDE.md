# FrontMCP Monorepo - Development Guide

## Repository Structure

- **Monorepo**: Nx-based monorepo managing multiple TypeScript libraries
- **Libraries Location**: `/libs/*`
- each library is independent and publishable

### Primary Libraries (scoped under `@frontmcp/*`)

Located in `/libs/*`:

- **cli** (`libs/cli`) - Command-line interface
- **sdk** (`libs/sdk`) - Core FrontMCP SDK
- **adapters** (`libs/adapters`) - Framework adapters and integrations
- **plugins** (`libs/plugins`) - Plugin system and extensions

> **Note:** `ast-guard`, `vectoriadb`, `enclave-vm`, `json-schema-to-zod-v3`, and `mcp-from-openapi` have been moved to external repositories.

### Demo Apps

Located in `/apps/*`:

- **demo** (`apps/demo`) - Demo application for development and testing

## Technology Stack

- **Build System**: Nx (commands: `nx build sdk`, `nx test ast-guard`, `nx run-many -t test`)
- **Language**: TypeScript with strict mode enabled
- **Testing**: Jest with 95%+ coverage requirement
- **Package Manager**: yarn

## Code Quality Standards

- **Coverage Requirement**: 95%+ across all metrics (statements, branches, functions, lines)
- **No Warnings**: Build must complete without TypeScript warnings
- **All Tests Passing**: 100% test pass rate required
- **Strict TypeScript**: Use strict type checking, no `any` types without justification

### Barrel Exports (index.ts)

```typescript
// Export everything users need
export { JSAstValidator } from './validator';
export * from './interfaces';
export * from './rules';
export * from './presets';
export * from './errors';

// NO legacy exports!
// ❌ export { JSAstValidator as AstGuard } // WRONG
// ❌ export { AstGuardError as JSAstValidatorError } // WRONG
```

## Project-Specific Notes

### Primary Packages (`@frontmcp/*`)

#### @frontmcp/sdk

- **Purpose**: Core FrontMCP SDK for building MCP servers and clients
- **Scope**: Main package that other libraries build upon

#### @frontmcp/cli

- **Purpose**: Command-line interface for FrontMCP
- **Scope**: Developer tooling and utilities

#### @frontmcp/adapters

- **Purpose**: Framework adapters (Express, Fastify, etc.)
- **Scope**: Integration layer for different frameworks

#### @frontmcp/plugins

- **Purpose**: Plugin system and extensions
- **Scope**: Extensibility framework

#### @frontmcp/auth

- **Purpose**: Authentication, session management, credential vault, CIMD, and OAuth extensions
- **Scope**: Standalone auth library used by SDK and other packages
- **Note**: All authentication-related code should be placed in this library, not in SDK

### Demo Applications

#### demo (`apps/demo`)

- **Type**: Demo application
- **Purpose**: Development and testing playground for FrontMCP packages
- **Usage**: Testing integrations, examples, and development workflows

## SDK Code Guidelines

### Type Safety Philosophy

FrontMCP is a TypeScript-first schema validation framework. All types should align with MCP protocol definitions.

#### MCP Response Types (DO NOT use `unknown` for protocol types)

- **Tools**: `execute()` returns `Promise<Out>` where `Out` is the typed output schema
- **Prompts**: `execute()` returns `Promise<GetPromptResult>` (MCP-defined type)
- **Resources**: `read()` returns `Promise<ReadResourceResult>` (MCP-defined type)

```typescript
// ✅ Good - strict MCP protocol types
abstract execute(args: Record<string, string>): Promise<GetPromptResult>;

// ❌ Bad - using unknown defeats TypeScript-first development
abstract execute(args: Record<string, string>): Promise<unknown>;
```

#### Validation Flow Pattern

1. `execute/read` methods return strictly typed MCP responses
2. `parseOutput/safeParseOutput` normalize various input shapes to the strict type
3. Flows finalize output using the entry's parse methods

```typescript
// In flow finalize stage:
const parseResult = prompt.safeParseOutput(rawOutput);
if (!parseResult.success) throw new InvalidOutputError();
this.respond(parseResult.data); // data is GetPromptResult
```

### Type System Patterns

**Use `unknown` instead of `any` for generic type defaults (NOT for MCP protocol types):**

```typescript
// ✅ Good - explicit constraint with unknown default
class ResourceContext<
  Params extends Record<string, string> = Record<string, string>,
  Out = unknown,
> extends ExecutionContextBase<Out>

// ❌ Bad - loose any types
class ResourceContext<In = any, Out = any>
```

**Use type parameters with constraints:**

```typescript
// ✅ Good - constrained generic
export type ResourceCtorArgs<Params extends Record<string, string> = Record<string, string>>

// ❌ Bad - unconstrained
export type ResourceCtorArgs<Params = any>
```

**Create shared base classes for common functionality:**

```typescript
// ExecutionContextBase provides: get(), tryGet(), scope, fail(), mark(), fetch()
export abstract class ToolContext extends ExecutionContextBase<Out>
export abstract class ResourceContext extends ExecutionContextBase<Out>
```

### Error Handling

**Use specific error classes with MCP error codes:**

```typescript
export const MCP_ERROR_CODES = {
  RESOURCE_NOT_FOUND: -32002,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  PARSE_ERROR: -32700,
} as const;

export class ResourceNotFoundError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.RESOURCE_NOT_FOUND;

  toJsonRpcError() {
    return { code: this.mcpErrorCode, message: this.getPublicMessage(), data: { uri: this.uri } };
  }
}
```

**Avoid non-null assertions - use proper error handling:**

```typescript
// ✅ Good
const rec = this.defs.get(token);
if (!rec) {
  throw new DependencyNotFoundError('AuthRegistry', tokenName(token));
}

// ❌ Bad - non-null assertion
const rec = this.defs.get(token)!;
```

### Registry Patterns

**Use getCapabilities() for dynamic capability exposure:**

```typescript
// In registry
getCapabilities(): { subscribe: boolean; listChanged: boolean } {
  return { subscribe: false, listChanged: this.hasAny() };
}

// In transport adapter
resources: this.scope.resources.getCapabilities(), // Not hardcoded!
```

### Change Events

**Use `changeScope` instead of `scope` to avoid confusion with Scope class:**

```typescript
export type ResourceChangeEvent = {
  kind: ResourceChangeKind;
  changeScope: ResourceChangeScope; // Not 'scope'!
  // ...
};
```

### URI Validation

**Validate URIs per RFC 3986 at metadata level:**

```typescript
uri: z.string().min(1).refine(isValidMcpUri, {
  message: 'URI must have a valid scheme (e.g., file://, https://, custom://)',
}),
```

### Hook Validation

**Fail fast on invalid hook flows:**

```typescript
const validFlows = ['resources:read-resource', 'resources:list-resources'];
const invalidHooks = allHooks.filter((hook) => !validFlows.includes(hook.metadata.flow));

if (invalidHooks.length > 0) {
  throw new InvalidHookFlowError(`Resource "${className}" has hooks for unsupported flows: ${invalidFlowNames}`);
}
```

### Record Types

**Centralize record types in common/records:**

```typescript
// In libs/sdk/src/common/records/resource.record.ts
export type AnyResourceRecord = ResourceRecord | ResourceTemplateRecord;

// Import from common, not from module-specific files
import { AnyResourceRecord } from '../common/records';
```

## Git Operations

**IMPORTANT: Never run git commit or git push commands.** The user handles all git operations themselves. Claude should only:

- Create/edit files
- Stage files with `git add` if explicitly asked
- Check status with `git status`, `git diff`, `git log`

Never:

- `git commit`
- `git push`
- `git commit --amend`
- Any command that modifies git history

## Task Completion Checklist

**Before completing a task**, run the following cleanup:

```bash
# Remove unused imports from changed files
node scripts/fix-unused-imports.mjs
```

This script automatically:

- Finds all files changed in the current branch (compared to main)
- Removes unused imports using ESLint
- Supports custom base branch: `node scripts/fix-unused-imports.mjs <branch-name>`

## Plugin Development

### Creating Plugins with Context Extensions

Plugins can extend `ExecutionContextBase` (ToolContext, etc.) to add properties like `this.remember`:

1. **Module Augmentation** (TypeScript types):

```typescript
declare module '@frontmcp/sdk' {
  interface ExecutionContextBase {
    readonly myProperty: MyType;
  }
}
```

2. **Runtime Extension** (prototype modification):

```typescript
export function installMyContextExtension(): void {
  const { ExecutionContextBase } = require('@frontmcp/sdk');

  Object.defineProperty(ExecutionContextBase.prototype, 'myProperty', {
    get: function () {
      return this.get(MyToken);
    },
    configurable: true,
    enumerable: false,
  });
}
```

See `plugins/plugin-remember/src/remember.context-extension.ts` for a complete example.

### Crypto Utilities

**IMPORTANT**: Always use `@frontmcp/utils` for cryptographic operations. Never use `node:crypto` directly or implement custom crypto functions.

```typescript
import {
  // PKCE (RFC 7636)
  generateCodeVerifier, // PKCE code verifier (43-128 chars)
  generateCodeChallenge, // PKCE code challenge (S256)
  generatePkcePair, // Generate both verifier and challenge

  // Hashing
  sha256, // SHA-256 hash (Uint8Array)
  sha256Hex, // SHA-256 hash (hex string)
  sha256Base64url, // SHA-256 hash (base64url string)

  // Encryption
  hkdfSha256, // HKDF-SHA256 key derivation (RFC 5869)
  encryptAesGcm, // AES-256-GCM encryption
  decryptAesGcm, // AES-256-GCM decryption

  // Random generation
  randomBytes, // Cryptographic random bytes
  randomUUID, // UUID v4 generation

  // Encoding
  base64urlEncode, // Base64url encoding
  base64urlDecode, // Base64url decoding
} from '@frontmcp/utils';
```

This ensures cross-platform support (Node.js and browser) with consistent behavior.

```typescript
// ✅ Good - use utils for PKCE
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';
const verifier = generateCodeVerifier();
const challenge = sha256Base64url(verifier);

// ❌ Bad - custom implementation
private generatePkceVerifier(): string {
  const chars = 'ABC...';
  // Don't do this - use generateCodeVerifier() instead
}
```

### File System Utilities

**IMPORTANT**: Always use `@frontmcp/utils` for file system operations. Never use `fs/promises` or `node:fs` directly.

```typescript
import {
  readFile, // Read file as string
  readFileBuffer, // Read file as Buffer
  writeFile, // Write content to file
  mkdir, // Create directory
  rename, // Rename/move file or directory
  unlink, // Delete file
  stat, // Get file/directory stats
  copyFile, // Copy file
  cp, // Copy file or directory recursively
  readdir, // List directory contents
  rm, // Remove file or directory
  mkdtemp, // Create temporary directory
  access, // Check file accessibility
  fileExists, // Check if file exists (returns boolean)
  readJSON, // Read and parse JSON file
  writeJSON, // Write object as JSON
  ensureDir, // Ensure directory exists
  isDirEmpty, // Check if directory is empty
  runCmd, // Run command as child process
} from '@frontmcp/utils';
```

Benefits:

- Cross-platform support (Node.js only, throws in browser)
- Lazy-loaded modules to avoid import errors in browser builds
- Consistent API across the codebase
- Centralized error handling and logging

### Storage Factory Pattern

**IMPORTANT**: When creating stores (session stores, elicitation stores, etc.), always use the factory pattern. Never construct stores directly with raw Redis clients.

```typescript
// ✅ Good - Use factory function
import { createSessionStore } from '@frontmcp/sdk/auth/session';
import { createElicitationStore } from '@frontmcp/sdk/elicitation';

const sessionStore = await createSessionStore({
  provider: 'redis',
  host: 'localhost',
  port: 6379,
  keyPrefix: 'mcp:session:',
});

const { store, type } = createElicitationStore({
  redis: { provider: 'redis', host: 'localhost', port: 6379 },
  keyPrefix: 'mcp:elicit:',
  logger,
});

// ❌ Bad - Direct construction with raw Redis client
const Redis = require('ioredis');
const client = new Redis({ host: 'localhost' });
const store = new RedisElicitationStore(client, logger); // DON'T DO THIS
```

**Factory Pattern Benefits:**

- Automatic provider detection (Redis, Vercel KV, etc.)
- Consistent key prefix handling
- Lazy-loading of dependencies (avoids bundling ioredis when not used)
- Built-in error handling and logging
- Support for fallback to memory store in development
- Edge runtime detection and appropriate error messages

**Creating New Store Factories:**

1. Create a factory file (e.g., `my-store.factory.ts`)
2. Use `RedisOptions` type for configuration
3. Use type guards (`isRedisProvider()`, `isVercelKvProvider()`) for provider detection
4. Lazy-require implementations: `const { MyStore } = require('./my.store')`
5. Return store type information: `{ store, type: 'redis' | 'memory' }`
6. Handle Edge runtime restrictions (throw if memory not supported)

See `libs/sdk/src/elicitation/elicitation-store.factory.ts` for a complete example.

### RememberPlugin Usage

When `RememberPlugin` is installed, tools can use `this.remember` and `this.approval`:

```typescript
@Tool({ name: 'my_tool' })
class MyTool extends ToolContext {
  async execute(input) {
    // Store/retrieve session memory
    await this.remember.set('key', 'value');
    const val = await this.remember.get('key');

    // Check tool approval
    const approved = await this.approval.isApproved('other-tool');
  }
}
```

## Skills Feature Organization

### Keep scope.instance.ts Lean

Use helper functions for feature-specific registration logic:

```typescript
// ✅ Good - use helper from skill module
import { registerSkillCapabilities } from '../skill/skill-scope.helper';

await registerSkillCapabilities({
  skillRegistry: this.scopeSkills,
  flowRegistry: this.scopeFlows,
  toolRegistry: this.scopeTools,
  providers: this.scopeProviders,
  skillsConfig: this.metadata.skillsConfig,
  logger: this.logger,
});

// ❌ Bad - inline 40+ lines of skill registration logic in scope.instance.ts
```

### Skills-Only Mode Detection

Use the utility from skill module instead of inline detection:

```typescript
// ✅ Good - use utility
import { detectSkillsOnlyMode } from '../../skill/skill-mode.utils';
const skillsOnlyMode = detectSkillsOnlyMode(query);

// ❌ Bad - duplicated inline logic
const mode = query?.['mode'];
const skillsOnlyMode = mode === 'skills_only' || (Array.isArray(mode) && mode.includes('skills_only'));
```

### Type Usage for Visibility

Use the `SkillVisibility` type from common/metadata instead of inline literals:

```typescript
// ✅ Good - use exported type
import { SkillVisibility } from '../common/metadata/skill.metadata';
private readonly visibility: SkillVisibility;

// ❌ Bad - inline literal union
private readonly visibility: 'mcp' | 'http' | 'both';
```

### Private Fields in Entry Classes

Use `private` keyword without underscore prefix, expose via getters:

```typescript
// ✅ Good - idiomatic TypeScript
private readonly tags: string[];
private readonly priority: number;
private cachedContent?: CachedSkillContent;

getTags(): string[] { return this.tags; }
getPriority(): number { return this.priority; }

// ❌ Bad - underscore prefix pattern
private readonly _tags: string[];
getTags(): string[] { return this._tags; }
```

### Tool Schema Access

Use `ToolEntry.getInputJsonSchema()` for single source of truth:

```typescript
// ✅ Good - use entry method
const inputSchema = tool.getInputJsonSchema();

// ❌ Bad - duplicated conversion logic
if (tool.rawInputSchema) { ... }
else if (tool.inputSchema) { try { toJSONSchema(z.object(...)) } }
```

### Skills HTTP Caching

Configure via `skillsConfig.cache` option, supports memory (default) and Redis:

```typescript
@FrontMcp({
  skillsConfig: {
    enabled: true,
    cache: {
      enabled: true,
      redis: { provider: 'redis', host: 'localhost' },
      ttlMs: 60000,
    },
  },
})
```

### Skills HTTP Authentication

Configure via `skillsConfig.auth` option:

```typescript
// API key auth
@FrontMcp({
  skillsConfig: {
    enabled: true,
    auth: 'api-key',
    apiKeys: ['sk-xxx', 'sk-yyy'],
  },
})

// JWT bearer auth
@FrontMcp({
  skillsConfig: {
    enabled: true,
    auth: 'bearer',
    jwt: {
      issuer: 'https://auth.example.com',
      audience: 'skills-api',
    },
  },
})
```

## Anti-Patterns to Avoid

❌ **Don't**: Use `node:crypto` directly (use `@frontmcp/utils` for cross-platform support)
❌ **Don't**: Use `fs/promises` or `node:fs` directly (use `@frontmcp/utils` for consistent file ops)
❌ **Don't**: Add backwards compatibility exports in new libraries
❌ **Don't**: Use prefixes like "PT-001" in test names
❌ **Don't**: Skip constructor validation tests
❌ **Don't**: Ignore error class `instanceof` checks in tests
❌ **Don't**: Use `any` type without strong justification
❌ **Don't**: Commit code with test failures or build warnings
❌ **Don't**: Use non-null assertions (`!`) - throw proper errors instead
❌ **Don't**: Mutate rawInput in flows - use state.set() for flow state
❌ **Don't**: Hardcode capabilities in adapters - use registry.getCapabilities()
❌ **Don't**: Name event properties `scope` when they don't refer to Scope class
❌ **Don't**: Put auth-related code in libs/sdk/src/auth (use libs/auth instead)

✅ **Do**: Use clean, descriptive names for everything
✅ **Do**: Use `@frontmcp/utils` for file system and crypto operations
✅ **Do**: Test all code paths including errors
✅ **Do**: Document known limitations clearly
✅ **Do**: Follow the preset pattern for hierarchical configurations
✅ **Do**: Achieve 95%+ test coverage
✅ **Do**: Use strict TypeScript settings
✅ **Do**: Write comprehensive security documentation
✅ **Do**: Use `unknown` instead of `any` for generic type defaults
✅ **Do**: Validate hooks match their entry type (fail fast)
✅ **Do**: Use specific MCP error classes with JSON-RPC codes
✅ **Do**: Place authentication logic in `libs/auth`, import via `@frontmcp/auth`
