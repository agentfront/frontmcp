# @frontmcp/plugins - Development Guidelines

## Overview

`@frontmcp/plugins` provides extensible plugins for the FrontMCP SDK, including caching, code execution, dashboard, and session memory (RememberPlugin).

## Plugin Architecture

### Creating a DynamicPlugin

Plugins should extend `DynamicPlugin<Options, OptionsInput>` for configurable behavior:

```typescript
import { DynamicPlugin, Plugin, ProviderType } from '@frontmcp/sdk';

@Plugin({
  name: 'my-plugin',
  description: 'Description',
  providers: [
    /* static providers */
  ],
})
export default class MyPlugin extends DynamicPlugin<MyPluginOptions, MyPluginOptionsInput> {
  static defaultOptions: MyPluginOptions = {
    /* defaults */
  };

  static override dynamicProviders = (options: MyPluginOptionsInput): ProviderType[] => {
    // Return providers based on options
    return [];
  };
}
```

### Extending Tool Metadata

Plugins can extend tool metadata using `declare global` pattern. This allows tools to specify plugin-specific options in their decorators:

```typescript
// In your plugin's types file
declare global {
  interface ExtendFrontMcpToolMetadata {
    myOption?: MyOptionType | boolean;
  }
}
```

This enables usage like:

```typescript
@Tool({
  name: 'my_tool',
  myOption: { enabled: true }, // TypeScript knows about this!
})
class MyTool extends ToolContext { ... }
```

### Accessing Plugin Services via Context Extensions

Plugins can extend ExecutionContextBase with new properties like `this.remember` using the SDK's context extension mechanism.

**Two parts are required:**

1. **TypeScript types** (declared by plugin developer via `declare module`)
2. **Runtime installation** (handled by SDK via `contextExtensions` in plugin metadata)

**Pattern used by RememberPlugin:**

```typescript
// 1. TypeScript types (in context-extension.ts)
declare module '@frontmcp/sdk' {
  interface ExecutionContextBase {
    readonly myService: MyService;
  }
}

// 2. Plugin metadata with contextExtensions (in plugin.ts)
@Plugin({
  name: 'my-plugin',
  contextExtensions: [
    {
      property: 'myService',
      token: MyServiceToken,
      errorMessage: 'MyPlugin is not installed.',
    },
  ],
})
class MyPlugin extends DynamicPlugin { ... }
```

**How it works:**

- Plugin declares `contextExtensions` array in metadata
- SDK processes this during plugin registration
- SDK adds lazy getters to `ExecutionContextBase.prototype`
- Plugin does NOT directly access SDK internals

**Usage in tools:**

```typescript
// this.myService is now available when MyPlugin is installed
class MyTool extends ToolContext {
  async execute(input) {
    await this.myService.doSomething();
  }
}
```

### Crypto Utilities

**IMPORTANT**: Always use `@frontmcp/utils` for cryptographic operations. Never use `node:crypto` directly.

```typescript
import {
  hkdfSha256, // HKDF-SHA256 key derivation
  encryptAesGcm, // AES-256-GCM encryption
  decryptAesGcm, // AES-256-GCM decryption
  randomBytes, // Cryptographic random bytes
  sha256,
  sha256Hex, // SHA-256 hashing
  base64urlEncode, // Base64url encoding
  base64urlDecode, // Base64url decoding
} from '@frontmcp/utils';
```

This ensures cross-platform support (Node.js and browser).

## RememberPlugin

### Usage in Tools

When RememberPlugin is installed, `this.remember` and `this.approval` are automatically available on any execution context (ToolContext, AgentContext, etc.):

```typescript
@Tool({ name: 'my_tool' })
class MyTool extends ToolContext {
  async execute(input) {
    // Direct property access - available when plugin is installed
    // Throws clear error if plugin not installed

    // Store a value (session-scoped by default)
    await this.remember.set('theme', 'dark');

    // Retrieve a value
    const theme = await this.remember.get('theme', { defaultValue: 'light' });

    // Store with user scope (persists across sessions)
    await this.remember.set('language', 'en', { scope: 'user' });

    // Store with TTL (forgets after 5 minutes)
    await this.remember.set('temp_token', 'xyz', { ttl: 300 });

    // Check if something is remembered
    if (await this.remember.knows('onboarding_complete')) {
      // Skip onboarding
    }

    // Forget something
    await this.remember.forget('temp_token');

    // List remembered keys
    const keys = await this.remember.list({ pattern: 'user:*' });

    // Check tool approval (if approval is enabled)
    const isApproved = await this.approval.isApproved('dangerous-tool');
  }
}
```

### Alternative: Helper Functions

If you prefer explicit function calls or need graceful degradation:

```typescript
import { getRemember, tryGetRemember } from '@frontmcp/plugins/remember';

class MyTool extends ToolContext {
  async execute(input) {
    // Option 1: Explicit function call (same as this.remember)
    const remember = getRemember(this);
    await remember.set('key', 'value');

    // Option 2: Safe access (returns undefined if plugin not installed)
    const maybeRemember = tryGetRemember(this);
    if (maybeRemember) {
      await maybeRemember.set('key', 'value');
    }
  }
}
```

### Scopes

- `session` - Valid only for current session (default)
- `user` - Persists for user across sessions
- `tool` - Tied to specific tool + session
- `global` - Shared across all sessions/users

### Approval System

Configure approval requirements on tools:

```typescript
@Tool({
  name: 'file_write',
  approval: {
    required: true,
    defaultScope: 'session',
    category: 'write',
    riskLevel: 'medium',
    approvalMessage: 'Allow file writing for this session?',
  },
})
class FileWriteTool extends ToolContext { ... }
```

## Testing Requirements

- **Coverage**: 95%+ across all metrics
- **Unit Tests**: Test all providers, services, and utilities
- **Mock Store**: Use `MockStore` implementing `RememberStoreInterface` for tests

## Anti-Patterns to Avoid

- **Using `node:crypto` directly** - use `@frontmcp/utils` for cross-platform support
- **Module-level side effects for context extension** - causes circular dependencies
- **Using `any` type** without justification
- **Hardcoding encryption keys** - use environment variables
- **Missing `override` keyword** on inherited methods
- **Exposing internal error details** in public messages

### Correct vs. Incorrect Patterns

```typescript
// ❌ WRONG: Side effect at module load (causes circular deps)
// At top level of module:
installExtension(); // Called immediately when module loads

// ✅ CORRECT: Extension in plugin constructor
class MyPlugin extends DynamicPlugin {
  constructor(options) {
    super();
    installExtension(); // Called when plugin is instantiated
  }
}

// ❌ WRONG: Using require() for SDK imports
const sdk = require('@frontmcp/sdk');
const ExecutionContextBase = sdk.ExecutionContextBase;

// ✅ CORRECT: Proper ES module imports
import { ExecutionContextBase } from '@frontmcp/sdk';

// ✅ CORRECT: Module augmentation for context properties (with runtime extension)
declare module '@frontmcp/sdk' {
  interface ExecutionContextBase {
    readonly myService: MyService;
  }
}
// Runtime: install in plugin constructor, not module side effect

// ✅ CORRECT: Module augmentation for tool metadata
declare global {
  interface ExtendFrontMcpToolMetadata {
    myOption?: MyOptionType;
  }
}
```
