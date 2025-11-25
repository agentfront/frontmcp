# @frontmcp/enclave

[![npm version](https://img.shields.io/npm/v/@frontmcp/enclave.svg)](https://www.npmjs.com/package/@frontmcp/enclave)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

> Secure AgentScript execution environment with defense-in-depth architecture

The enclave package provides a hardened execution environment for running LLM-generated JavaScript code (AgentScript) safely. It combines AST validation, code transformation, runtime guards, and VM sandboxing to prevent sandbox escapes and resource exhaustion.

## Bank-Grade Security

| Metric         | Value                                           |
| -------------- | ----------------------------------------------- |
| Security Tests | 400+ tests, 100% pass rate                      |
| Attack Vectors | 72+ blocked                                     |
| CVE Protection | 100% (vm2, isolated-vm, node-vm exploits)       |
| Defense Layers | 4 (AST validation, transformation, runtime, VM) |

For the full security audit report, see [SECURITY-AUDIT.md](./SECURITY-AUDIT.md).

## Features

- **Defense-in-Depth**: 4 layers of security (AST validation → transformation → runtime guards → VM sandbox)
- **Safe Tool Calls**: Secure `callTool()` execution with iteration and call limits
- **Reference Sidecar**: Handle large data without embedding it in the script
- **Configurable Security Levels**: From STRICT to PERMISSIVE based on trust level
- **Resource Limits**: Timeout, iteration limits, and tool call limits
- **Zero Dependencies on Vulnerable Packages**: Uses Node.js native `vm` module

## Installation

```bash
npm install @frontmcp/enclave
# or
yarn add @frontmcp/enclave
# or
pnpm add @frontmcp/enclave
```

## Quick Start

```typescript
import { Enclave } from '@frontmcp/enclave';

// Create enclave with a tool handler
const enclave = new Enclave({
  timeout: 5000,
  maxToolCalls: 10,
  maxIterations: 1000,
  toolHandler: async (toolName, args) => {
    // Your tool execution logic
    return { success: true, data: `Called ${toolName}` };
  },
});

// Execute AgentScript code
const result = await enclave.run(`
  const user = await callTool('getUser', { id: 123 });
  const orders = await callTool('getOrders', { userId: user.id });
  return { user, orderCount: orders.length };
`);

if (result.success) {
  console.log('Result:', result.value);
} else {
  console.error('Error:', result.error);
}

// Always dispose when done
enclave.dispose();
```

## Configuration

### CreateEnclaveOptions

```typescript
interface CreateEnclaveOptions {
  // Execution limits
  timeout?: number; // Execution timeout in ms (default: 5000)
  maxToolCalls?: number; // Maximum tool calls allowed (default: 100)
  maxIterations?: number; // Maximum loop iterations (default: 10000)

  // Security
  securityLevel?: SecurityLevel; // STRICT | SECURE | STANDARD | PERMISSIVE
  validate?: boolean; // Enable AST validation (default: true)
  transform?: boolean; // Enable code transformation (default: true)

  // Tool execution
  toolHandler?: ToolHandler; // Function to execute tool calls

  // Custom globals
  globals?: Record<string, unknown>; // Additional globals for the VM
  allowFunctionsInGlobals?: boolean; // Allow functions in globals (default: false)

  // Sidecar (large data handling)
  sidecar?: ReferenceSidecarOptions;
}
```

### Security Levels

| Level        | Description                                 | Use Case             |
| ------------ | ------------------------------------------- | -------------------- |
| `STRICT`     | Maximum security, blocks all risky patterns | Untrusted code       |
| `SECURE`     | High security with some flexibility         | Semi-trusted code    |
| `STANDARD`   | Balanced security for most use cases        | Trusted code         |
| `PERMISSIVE` | Minimal restrictions                        | Internal/development |

```typescript
import { Enclave, SecurityLevel } from '@frontmcp/enclave';

const enclave = new Enclave({
  securityLevel: SecurityLevel.STRICT,
  toolHandler: async (name, args) => {
    /* ... */
  },
});
```

## Reference Sidecar

The Reference Sidecar is a powerful feature for handling large data in AgentScript without embedding it directly in the script. This is essential when:

- Tool responses contain large datasets
- You need to pass large data between tool calls
- Script size must be kept small for security validation

### How It Works

1. **Large Data Extraction**: When a tool returns large data, it's stored in a sidecar storage and replaced with a reference token (`__ref_abc123`)
2. **Lazy Resolution**: When the script accesses the reference, it's resolved just-in-time
3. **Safe Property Access**: Only specific properties can be accessed, preventing data exfiltration

### Enabling Sidecar

```typescript
const enclave = new Enclave({
  toolHandler: async (name, args) => {
    /* ... */
  },
  sidecar: {
    enabled: true,
    maxTotalSize: 10 * 1024 * 1024, // 10MB total storage
    maxReferenceSize: 1 * 1024 * 1024, // 1MB per reference
    extractionThreshold: 1024, // Extract strings > 1KB
    maxResolvedSize: 5 * 1024 * 1024, // 5MB max resolved size
    allowComposites: false, // Block string concatenation with refs
  },
});
```

### Sidecar Options

| Option                | Type      | Default | Description                                      |
| --------------------- | --------- | ------- | ------------------------------------------------ |
| `enabled`             | `boolean` | `false` | Enable the sidecar feature                       |
| `maxTotalSize`        | `number`  | 10MB    | Maximum total size of all stored references      |
| `maxReferenceSize`    | `number`  | 1MB     | Maximum size of a single reference               |
| `extractionThreshold` | `number`  | 1024    | Minimum string size to extract to sidecar        |
| `maxResolvedSize`     | `number`  | 5MB     | Maximum size when resolving references           |
| `allowComposites`     | `boolean` | `false` | Allow string concatenation with reference tokens |

### Example with Sidecar

```typescript
const enclave = new Enclave({
  sidecar: {
    enabled: true,
    extractionThreshold: 100, // Extract strings > 100 bytes
    allowComposites: false, // Block: ref + "suffix" (security measure)
  },
  toolHandler: async (name, args) => {
    if (name === 'getLargeData') {
      // Returns 1MB of data - automatically stored in sidecar
      return { data: 'x'.repeat(1024 * 1024) };
    }
  },
});

const result = await enclave.run(`
  // Large data is transparently handled via sidecar
  const response = await callTool('getLargeData', {});

  // Access properties - resolved on demand
  return { hasData: response.data.length > 0 };
`);
```

### Security Considerations

The `allowComposites: false` setting (default) blocks string concatenation with reference tokens. This prevents attacks like:

```javascript
// BLOCKED when allowComposites: false
const malicious = ref + '__proto__'; // Attempting prototype pollution
```

Set `allowComposites: true` only if you need to concatenate strings and understand the security implications.

## Custom Globals

You can provide custom globals to the VM:

```typescript
const enclave = new Enclave({
  globals: {
    config: { apiUrl: 'https://api.example.com' },
    helpers: {
      formatDate: (date: Date) => date.toISOString(),
    },
  },
  allowFunctionsInGlobals: true, // Required when globals contain functions
  toolHandler: async (name, args) => {
    /* ... */
  },
});

const result = await enclave.run(`
  const url = config.apiUrl;
  const formatted = helpers.formatDate(new Date());
  return { url, formatted };
`);
```

**Security Note**: Set `allowFunctionsInGlobals: true` only when you intentionally provide functions. Functions in globals can potentially leak host scope via closures.

## Execution Result

```typescript
interface ExecutionResult<T> {
  success: boolean;
  value?: T; // Result when success is true
  error?: {
    message: string;
    name: string;
    code?: string; // Error code (e.g., 'VALIDATION_ERROR', 'TIMEOUT')
    stack?: string;
    data?: Record<string, unknown>;
  };
  stats: {
    duration: number; // Execution time in ms
    toolCallCount: number; // Number of tool calls made
    iterationCount: number; // Number of loop iterations
  };
}
```

### Error Codes

| Code               | Description                            |
| ------------------ | -------------------------------------- |
| `VALIDATION_ERROR` | AST validation failed (dangerous code) |
| `TIMEOUT`          | Execution exceeded timeout             |
| `MAX_TOOL_CALLS`   | Exceeded maximum tool calls            |
| `MAX_ITERATIONS`   | Exceeded maximum loop iterations       |
| `TOOL_ERROR`       | Tool handler threw an error            |
| `RUNTIME_ERROR`    | General runtime error in script        |

## Defense-in-Depth Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Code Input                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: AST Validation (ast-guard)                        │
│  ├── NoEvalRule - Blocks eval(), Function()                 │
│  ├── NoGlobalAccessRule - Blocks dangerous globals          │
│  ├── DisallowedIdentifierRule - Blocks reserved prefixes    │
│  └── RequiredFunctionCallRule - Enforces callTool usage     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Code Transformation                               │
│  ├── Wraps in async function __ag_main()                    │
│  ├── callTool → __safe_callTool (tracked)                   │
│  ├── Loops → __safe_for, __safe_forOf (guarded)             │
│  └── String literals → extracted to sidecar (if enabled)   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Runtime Wrappers                                  │
│  ├── __safe_callTool - Enforces maxToolCalls                │
│  ├── __safe_forOf - Enforces maxIterations                  │
│  ├── __safe_for - Guards traditional for loops              │
│  └── Reference resolver - Handles sidecar references        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: VM Sandbox (Node.js vm module)                    │
│  ├── Isolated execution context                             │
│  ├── Controlled global access                               │
│  ├── No process, require, fs access                         │
│  └── Timeout enforcement                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Safe Execution Result                    │
└─────────────────────────────────────────────────────────────┘
```

## API Reference

### Enclave Class

```typescript
class Enclave {
  constructor(options?: CreateEnclaveOptions);

  // Execute AgentScript code
  run<T = unknown>(code: string): Promise<ExecutionResult<T>>;

  // Clean up resources
  dispose(): void;
}
```

### ToolHandler Type

```typescript
type ToolHandler = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
```

## Testing

```bash
# Run tests
nx test enclave

# Run tests with coverage
nx test enclave --coverage
```

## Related Packages

- [`ast-guard`](../ast-guard) - AST validation rules used by enclave
- [`@frontmcp/plugins`](../plugins) - CodeCall plugin that uses enclave

## License

Apache-2.0
