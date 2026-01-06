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

**IMPORTANT**: Always use `@frontmcp/utils` for cryptographic operations. Never use `node:crypto` directly.

```typescript
import {
  hkdfSha256, // HKDF-SHA256 key derivation (RFC 5869)
  encryptAesGcm, // AES-256-GCM encryption
  decryptAesGcm, // AES-256-GCM decryption
  randomBytes, // Cryptographic random bytes
  sha256,
  sha256Hex, // SHA-256 hashing
  base64urlEncode, // Base64url encoding
  base64urlDecode, // Base64url decoding
} from '@frontmcp/utils';
```

This ensures cross-platform support (Node.js and browser) with consistent behavior.

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
