# AST Guard

[![npm version](https://img.shields.io/npm/v/ast-guard.svg)](https://www.npmjs.com/package/ast-guard)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

> A production-ready, extensible AST validator for JavaScript with rule-based validation

AST Guard is a powerful static analysis tool for JavaScript code. It provides a flexible, rule-based architecture for validating Abstract Syntax Trees (AST) with comprehensive built-in rules and support for custom validation logic.

## Bank-Grade Security

### Hardened Against All Known Sandbox Escape Exploits

| Metric         | Value                                                |
| -------------- | ---------------------------------------------------- |
| CVE Protection | 100% (all known vm2, isolated-vm, node-vm exploits)  |
| Security Tests | 613 tests, 100% pass rate                            |
| Code Coverage  | 95%+                                                 |
| Defense Layers | 4 (AST validation, transformation, proxy, isolation) |

**Protected Against:**

- **vm2 CVEs**: CVE-2023-29017, CVE-2023-30547, CVE-2023-32313, CVE-2023-37466
- **Constructor chain escapes**: `[].constructor.constructor('code')()`
- **Prototype pollution**: `__proto__`, `Object.setPrototypeOf`
- **Reflection API bypasses**: `Reflect.get`, `Reflect.construct`
- **Global object access**: `window`, `globalThis`, `this`

For detailed CVE analysis, see [CVE-COVERAGE.md](./docs/CVE-COVERAGE.md). For the full list of 100+ blocked attack vectors, see [SECURITY-AUDIT.md](./docs/SECURITY-AUDIT.md).

## Features

- **Production-Ready**: Comprehensive error handling, type-safe APIs, and battle-tested rules
- **Extensible**: Plugin architecture with custom rule support
- **Type-Safe**: Full TypeScript support with strict typing
- **Zero Dependencies**: Lightweight with only `acorn` and `acorn-walk` as dependencies
- **Comprehensive Rules**: Built-in rules for common validation scenarios
- **Security-Focused**: Rules to prevent dangerous code patterns
- **Performance**: Fast validation with configurable limits
- **Detailed Reporting**: Rich error messages with source locations

## Installation

```bash
npm install ast-guard
# or
yarn add ast-guard
# or
pnpm add ast-guard
```

## Quick Start

```typescript
import { JSAstValidator, DisallowedIdentifierRule, NoEvalRule } from 'ast-guard';

// Create validator with built-in rules
const validator = new JSAstValidator([
  new DisallowedIdentifierRule({ disallowed: ['eval', 'Function'] }),
  new NoEvalRule(),
]);

// Validate code
const result = await validator.validate(`
  const x = 1;
  eval("alert('hello')");
`);

if (!result.valid) {
  console.log('Validation failed:');
  result.issues.forEach((issue) => {
    console.log(`- [${issue.severity}] ${issue.message} (${issue.code})`);
    if (issue.location) {
      console.log(`  at line ${issue.location.line}, column ${issue.location.column}`);
    }
  });
}
```

## Presets

AST Guard provides pre-configured security presets for quick and easy setup. Choose from five security levels, from maximum lockdown to minimal restrictions.

### Available Presets

| Preset         | Security Level | Description                                          | Use Case                            |
| -------------- | -------------- | ---------------------------------------------------- | ----------------------------------- |
| **STRICT**     | Maximum        | Blocks all dangerous patterns, loops, and async      | Untrusted code execution            |
| **SECURE**     | High           | Blocks most dangerous patterns, allows bounded loops | Semi-trusted code with restrictions |
| **STANDARD**   | Medium         | Sensible defaults, blocks critical risks only        | Trusted code with safety checks     |
| **PERMISSIVE** | Low            | Minimal restrictions, only blocks eval               | Internal scripts                    |

### Quick Start with Presets

```typescript
import { JSAstValidator, Presets, PresetLevel } from 'ast-guard';

// Option 1: Use the Presets object
const lockdownRules = Presets.strict();
const validator = new JSAstValidator(lockdownRules);

// Option 2: Use createPreset with level
import { createPreset } from 'ast-guard';
const securedRules = createPreset(PresetLevel.SECURE);
const validator = new JSAstValidator(securedRules);

// Option 3: Use individual preset function
import { createStandardPreset } from 'ast-guard';
const balancedRules = createStandardPreset();
const validator = new JSAstValidator(balancedRules);
```

### Preset Details

#### STRICT Preset

**Maximum security for untrusted code. Bank-grade protection.**

Includes all security rules to block known sandbox escape exploits:

- ✅ NoEvalRule - Blocks eval() and Function constructor
- ✅ NoGlobalAccessRule - Blocks constructor chains, Reflect API, global object access
- ✅ NoAsyncRule - Blocks async/await patterns
- ✅ DisallowedIdentifierRule - Blocks dangerous identifiers
- ✅ ForbiddenLoopRule - Blocks loops (or optionally allow bounded loops)
- ✅ And more...

```typescript
import { Presets } from 'ast-guard';

// Maximum lockdown
const rules = Presets.strict();

// With customization
const rules = Presets.strict({
  // Allow specific loops
  allowedLoops: { allowFor: true, allowForOf: true },

  // Require specific API calls
  requiredFunctions: ['callTool'],
  minFunctionCalls: 1,
  maxFunctionCalls: 10,

  // Validate function arguments
  functionArgumentRules: {
    callTool: {
      minArgs: 2,
      expectedTypes: ['string', 'object'],
    },
  },

  // Add custom blocked identifiers
  additionalDisallowedIdentifiers: ['window', 'document'],
});
```

**Blocks:**

- All eval-like constructs (`eval`, `Function`, `setTimeout` with strings)
- All loops (for, while, do-while, for-in, for-of)
- All async/await
- Dangerous identifiers: `process`, `require`, `global`, `__dirname`, `constructor`, `__proto__`, etc.

#### SECURE Preset

High security with some flexibility for semi-trusted code.

```typescript
import { Presets } from 'ast-guard';

const rules = Presets.secured({
  requiredFunctions: ['callTool'],
  maxFunctionCalls: 20,
});
```

**Blocks:**

- All eval-like constructs
- Dangerous identifiers: `process`, `require`, `global`, `__dirname`
- Infinite loops (while, do-while)
- Async function declarations

**Allows:**

- Bounded for/for-of loops
- Await expressions (but not async functions)

#### STANDARD Preset

Medium security with sensible defaults for most use cases.

```typescript
import { Presets } from 'ast-guard';

const rules = Presets.balanced({
  requiredFunctions: ['callTool'],
  additionalDisallowedIdentifiers: ['window', 'document'], // Browser-specific
});
```

**Blocks:**

- eval() and Function constructor
- Critical identifiers: `process`, `require`, `eval`, `Function`
- Infinite while/do-while loops

**Allows:**

- All for loops (for, for-in, for-of)
- Async/await
- Constructor and prototype access

#### PERMISSIVE Preset

Low security for internal or trusted scripts.

```typescript
import { Presets } from 'ast-guard';

const rules = Presets.naive({
  requiredFunctions: ['callTool'], // Optional API enforcement
});
```

**Blocks:**

- eval() only

**Allows:**

- All loops
- Async/await
- All identifiers
- Constructor and prototype access

### Customizing Presets

All presets accept options to customize their behavior:

```typescript
import { Presets } from 'ast-guard';

const rules = Presets.secured({
  // Add more blocked identifiers
  additionalDisallowedIdentifiers: ['window', 'document', 'localStorage'],

  // Require specific functions
  requiredFunctions: ['callTool', 'getTool'],
  minFunctionCalls: 1,
  maxFunctionCalls: 50,

  // Override default loop restrictions
  allowedLoops: {
    allowFor: true,
    allowWhile: true, // Override: allow while in secured preset
    allowDoWhile: false,
    allowForIn: false,
    allowForOf: true,
  },

  // Override default async restrictions
  allowAsync: {
    allowAsyncFunctions: true, // Override: allow async in secured preset
    allowAwait: true,
  },

  // Validate specific function arguments
  functionArgumentRules: {
    callTool: {
      minArgs: 2,
      maxArgs: 3,
      expectedTypes: ['string', 'object'],
      validator: (args) => {
        // Custom validation
        if (args[0]?.value === '') {
          return 'Tool name cannot be empty';
        }
        return null;
      },
    },
  },
});
```

### Real-World Examples

#### Example 1: Untrusted Code Sandbox

```typescript
import { JSAstValidator, Presets } from 'ast-guard';

// Maximum security for untrusted user code
const validator = new JSAstValidator(
  Presets.strict({
    requiredFunctions: ['callTool'],
    functionArgumentRules: {
      callTool: {
        minArgs: 2,
        expectedTypes: ['string', 'object'],
      },
    },
  }),
);

const userCode = `
  // User-submitted code
  callTool("getData", { id: 123 });
`;

const result = await validator.validate(userCode, {
  rules: {
    'no-eval': true,
    'disallowed-identifier': true,
    'forbidden-loop': true,
    'required-function-call': true,
    'call-argument-validation': true,
  },
});

if (result.valid) {
  // Safe to execute in sandbox
  executeInSandbox(userCode);
}
```

#### Example 2: Plugin System

```typescript
import { JSAstValidator, Presets } from 'ast-guard';

// Balanced security for plugin code
const validator = new JSAstValidator(
  Presets.balanced({
    requiredFunctions: ['registerPlugin'],
    additionalDisallowedIdentifiers: ['process', 'require', 'fs'],
  }),
);

const pluginCode = await loadPluginCode();
const result = await validator.validate(pluginCode, {
  rules: {
    'no-eval': true,
    'disallowed-identifier': true,
    'required-function-call': true,
  },
});
```

#### Example 3: Internal Automation Scripts

```typescript
import { JSAstValidator, Presets } from 'ast-guard';

// Minimal security for trusted internal scripts
const validator = new JSAstValidator(
  Presets.naive({
    requiredFunctions: ['execute'],
  }),
);
```

### Preset Comparison Matrix

| Feature              | STRICT | SECURE | STANDARD | PERMISSIVE |
| -------------------- | ------ | ------ | -------- | ---------- |
| **eval()**           | ❌     | ❌     | ❌       | ❌         |
| **Function()**       | ❌     | ❌     | ❌       | ✅         |
| **for loops**        | ❌     | ✅     | ✅       | ✅         |
| **while loops**      | ❌     | ❌     | ❌       | ✅         |
| **async/await**      | ❌     | ⚠️     | ✅       | ✅         |
| **process**          | ❌     | ❌     | ❌       | ✅         |
| **require**          | ❌     | ❌     | ❌       | ✅         |
| **global**           | ❌     | ❌     | ✅       | ✅         |
| **constructor**      | ❌     | ✅     | ✅       | ✅         |
| **Unreachable code** | ⚠️     | ⚠️     | ⚠️       | ⚠️         |

Legend: ❌ Blocked (error) | ⚠️ Detected (warning) | ✅ Allowed

### AgentScript Preset

The AgentScript preset is specifically designed for safe AI agent orchestration. It provides security rules tailored for executing LLM-generated code that calls tools via `callTool()`.

```typescript
import { JSAstValidator, createAgentScriptPreset } from 'ast-guard';

// Basic usage - secure defaults for AgentScript
const rules = createAgentScriptPreset();
const validator = new JSAstValidator(rules);

// With requireCallTool - enforce that code must call tools
const rules = createAgentScriptPreset({
  requireCallTool: true, // Require at least one callTool() invocation
});
```

**Options:**

| Option                            | Type       | Default                     | Description                                              |
| --------------------------------- | ---------- | --------------------------- | -------------------------------------------------------- |
| `requireCallTool`                 | `boolean`  | `false`                     | Require at least one `callTool()` invocation in the code |
| `allowedGlobals`                  | `string[]` | `['callTool', 'Math', ...]` | List of allowed global identifiers                       |
| `additionalDisallowedIdentifiers` | `string[]` | `[]`                        | Additional identifiers to block beyond the default set   |
| `allowArrowFunctions`             | `boolean`  | `true`                      | Whether to allow arrow functions (for array methods)     |
| `allowedLoops`                    | `object`   | `{ allowFor, allowForOf }`  | Override default loop restrictions                       |
| `reservedPrefixes`                | `string[]` | `['__ag_', '__safe_']`      | Reserved prefixes that user code cannot use              |
| `staticCallTarget`                | `object`   | `{ enabled: true }`         | Configuration for static call target validation          |
| `callToolValidation`              | `object`   | -                           | Validation rules for callTool arguments                  |

**Example with all options:**

```typescript
const rules = createAgentScriptPreset({
  // Require the code to actually call tools
  requireCallTool: true,

  // Customize allowed globals
  allowedGlobals: ['callTool', 'getTool', 'Math', 'JSON', 'Array', 'Object'],

  // Block additional identifiers
  additionalDisallowedIdentifiers: ['fetch', 'XMLHttpRequest'],

  // Allow arrow functions for array methods (default: true)
  allowArrowFunctions: true,

  // Allow specific loops (default: for and for-of allowed)
  allowedLoops: {
    allowFor: true,
    allowForOf: true,
    allowWhile: false, // Block while loops
    allowDoWhile: false, // Block do-while loops
    allowForIn: false, // Block for-in loops
  },

  // Static call target validation
  staticCallTarget: {
    enabled: true,
    allowedToolNames: ['users:list', 'users:get'], // Optional whitelist
  },
});
```

The AgentScript preset is used internally by the `@frontmcp/enclave` package for secure code execution.

## Built-in Rules

### DisallowedIdentifierRule

Prevents usage of specific identifiers (e.g., `eval`, `Function`, `process`).

```typescript
import { DisallowedIdentifierRule } from 'ast-guard';

const rule = new DisallowedIdentifierRule({
  disallowed: ['eval', 'Function', 'process', 'require'],
  messageTemplate: 'Access to "{identifier}" is forbidden',
});
```

### ForbiddenLoopRule

Prevents usage of loop constructs. Configurable to allow specific loop types.

```typescript
import { ForbiddenLoopRule } from 'ast-guard';

const rule = new ForbiddenLoopRule({
  allowFor: false,
  allowWhile: false,
  allowDoWhile: false,
  allowForOf: true, // Allow for-of loops
  allowForIn: false,
  message: 'Loops are not allowed in this context',
});
```

### RequiredFunctionCallRule

Ensures specific functions are called at least once.

```typescript
import { RequiredFunctionCallRule } from 'ast-guard';

const rule = new RequiredFunctionCallRule({
  required: ['callTool'],
  minCalls: 1,
  maxCalls: 10,
  messageTemplate: 'Must call {function} at least once',
});
```

**Mode Options:**

- `mode: 'all'` (default) - All functions in `required` must be called
- `mode: 'any'` - At least one function from `required` must be called

```typescript
// Require either callTool or invokeAPI to be called
const rule = new RequiredFunctionCallRule({
  required: ['callTool', 'invokeAPI'],
  mode: 'any',
  minCalls: 1,
});
```

### UnreachableCodeRule

Detects unreachable code (code after return/throw/break/continue).

```typescript
import { UnreachableCodeRule } from 'ast-guard';

const rule = new UnreachableCodeRule();
// Automatically detects unreachable code
```

### CallArgumentValidationRule

Validates function call arguments (count and types).

```typescript
import { CallArgumentValidationRule } from 'ast-guard';

const rule = new CallArgumentValidationRule({
  functions: {
    callTool: {
      minArgs: 2,
      maxArgs: 2,
      expectedTypes: ['string', 'object'],
    },
    getTool: {
      minArgs: 1,
      maxArgs: 1,
      expectedTypes: ['string'],
      validator: (args, node) => {
        // Custom validation logic
        const firstArg = args[0];
        if (firstArg.type === 'Literal' && firstArg.value === '') {
          return 'Tool name cannot be empty';
        }
        return null; // Valid
      },
    },
  },
});
```

### NoEvalRule

Prevents usage of `eval()`, `Function()` constructor, and string-based `setTimeout`/`setInterval`.

```typescript
import { NoEvalRule } from 'ast-guard';

const rule = new NoEvalRule();
// Blocks: eval(), new Function(), setTimeout("code", ...)
```

### NoAsyncRule

Prevents usage of async/await constructs.

```typescript
import { NoAsyncRule } from 'ast-guard';

const rule = new NoAsyncRule({
  allowAsyncFunctions: false,
  allowAwait: false,
  message: 'Async code is not supported',
});
```

## Custom Rules

Create your own validation rules by implementing the `ValidationRule` interface:

```typescript
import { ValidationRule, ValidationContext, ValidationSeverity } from 'ast-guard';
import * as walk from 'acorn-walk';

class NoConsoleRule implements ValidationRule {
  readonly name = 'no-console';
  readonly description = 'Prevents usage of console methods';
  readonly defaultSeverity = ValidationSeverity.WARNING;
  readonly enabledByDefault = true;

  validate(context: ValidationContext): void {
    walk.simple(context.ast as any, {
      MemberExpression: (node: any) => {
        if (node.object.type === 'Identifier' && node.object.name === 'console') {
          context.report({
            code: 'NO_CONSOLE',
            message: 'Console usage is not recommended',
            location: node.loc
              ? {
                  line: node.loc.start.line,
                  column: node.loc.start.column,
                }
              : undefined,
          });
        }
      },
    });
  }
}

// Use your custom rule
const validator = new JSAstValidator([new NoConsoleRule()]);
```

## Configuration

### Validator Configuration

```typescript
const result = await validator.validate(code, {
  // Parse options (passed to acorn)
  parseOptions: {
    ecmaVersion: 'latest',
    sourceType: 'script',
  },

  // Rule configuration
  rules: {
    'disallowed-identifier': true, // Enable with default options
    'no-eval': false, // Disable rule
    'required-function-call': {
      // Enable with custom options
      enabled: true,
      severity: ValidationSeverity.ERROR,
      options: { required: ['callTool'] },
    },
  },

  // Stop on first error
  stopOnFirstError: false,

  // Maximum number of issues (0 = unlimited)
  maxIssues: 100,
});
```

### Rule Management

```typescript
const validator = new JSAstValidator();

// Register rules
validator.registerRule(new DisallowedIdentifierRule({ disallowed: ['eval'] }));
validator.registerRule(new NoEvalRule());

// Get all rules
const rules = validator.getRules();

// Get specific rule
const rule = validator.getRule('no-eval');

// Unregister rule
validator.unregisterRule('no-eval');
```

## Validation Results

```typescript
interface ValidationResult {
  valid: boolean; // true if no errors
  issues: ValidationIssue[]; // All issues found
  ast?: acorn.Node; // Parsed AST (if parsing succeeded)
  parseError?: Error; // Parse error (if parsing failed)
}

interface ValidationIssue {
  code: string; // Unique issue code
  severity: ValidationSeverity; // ERROR | WARNING | INFO
  message: string; // Human-readable message
  location?: SourceLocation; // Source location
  data?: Record<string, unknown>; // Additional context
}
```

## Error Handling

All errors extend `JSAstValidatorError` with specific error types:

```typescript
import {
  JSAstValidatorError,
  ParseError,
  RuleConfigurationError,
  ConfigurationError,
  RuleNotFoundError,
  InvalidSourceError,
} from 'ast-guard';

try {
  const result = await validator.validate(code);
} catch (error) {
  if (error instanceof ParseError) {
    console.error(`Parse error at line ${error.line}:`, error.message);
  } else if (error instanceof InvalidSourceError) {
    console.error('Invalid source:', error.message);
  } else if (error instanceof RuleConfigurationError) {
    console.error(`Rule ${error.ruleName} misconfigured:`, error.message);
  }
}
```

## Statistics

```typescript
const result = await validator.validate(code);
const stats = validator.getStats(result, Date.now() - startTime);

console.log(`Total issues: ${stats.totalIssues}`);
console.log(`Errors: ${stats.errors}`);
console.log(`Warnings: ${stats.warnings}`);
console.log(`Duration: ${stats.durationMs}ms`);
```

## Use Cases

### 1. Sandboxed Code Execution

Validate code before executing in a sandboxed environment:

```typescript
const validator = new JSAstValidator([
  new DisallowedIdentifierRule({ disallowed: ['eval', 'Function', 'process'] }),
  new NoEvalRule(),
  new ForbiddenLoopRule(), // Prevent infinite loops
  new RequiredFunctionCallRule({ required: ['callTool'] }),
]);

const result = await validator.validate(userCode);
if (result.valid) {
  // Safe to execute
  vm.runInContext(userCode, sandbox);
}
```

### 2. API Contract Validation

Ensure code follows API contracts:

```typescript
const validator = new JSAstValidator([
  new RequiredFunctionCallRule({ required: ['callTool'] }),
  new CallArgumentValidationRule({
    functions: {
      callTool: {
        minArgs: 2,
        expectedTypes: ['string', 'object'],
      },
    },
  }),
]);
```

### 3. Security Analysis

Detect potentially dangerous code patterns:

```typescript
const validator = new JSAstValidator([
  new NoEvalRule(),
  new DisallowedIdentifierRule({
    disallowed: ['eval', 'Function', 'require', 'process', 'child_process'],
  }),
]);
```

### 4. Code Quality Checks

Detect code quality issues:

```typescript
const validator = new JSAstValidator([
  new UnreachableCodeRule(),
  // Add custom rules for your quality standards
]);
```

## Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## Performance

- **Parse time**: ~1-5ms for typical scripts (depends on size)
- **Validation time**: ~1-10ms per rule (depends on complexity)
- **Memory**: Minimal overhead, AST is shared across rules

## Comparison

| Feature                | AST Guard      | ESLint       | TypeScript    |
| ---------------------- | -------------- | ------------ | ------------- |
| **Focus**              | AST validation | Code linting | Type checking |
| **Extensible**         | ✅             | ✅           | ⚠️            |
| **Lightweight**        | ✅             | ❌           | ❌            |
| **Type-safe**          | ✅             | ⚠️           | ✅            |
| **Security rules**     | ✅             | ⚠️           | ❌            |
| **Runtime validation** | ✅             | ❌           | ❌            |

## Defense-in-Depth Architecture

AST Guard provides 4 layers of protection:

```text
Layer 1: AST Validation
├── NoEvalRule - Blocks eval(), Function()
├── NoGlobalAccessRule - Blocks window, globalThis, .constructor
├── NoAsyncRule - Blocks async/await (optional)
├── DisallowedIdentifierRule - Blocks dangerous identifiers
└── ForbiddenLoopRule - Blocks/transforms loops

Layer 2: AST Transformation
├── Direct identifiers: console → __safe_console
├── Computed access: obj['eval'] → obj['__safe_eval']
└── Static string literals transformed

Layer 3: Runtime Proxy Layer
├── __safe_callTool() - Validates tool calls
├── __safe_console() - Captures logs
└── All proxied functions enforce security

Layer 4: Worker Isolation
├── Separate worker thread
├── Sandboxed VM context
└── No access to Node.js globals
```

### Known Limitations

These are inherent to **any** static analyzer (not vulnerabilities):

| Limitation                   | Example              | Mitigation                        |
| ---------------------------- | -------------------- | --------------------------------- |
| Computed property access     | `obj['constructor']` | `Object.freeze(Object.prototype)` |
| Runtime string construction  | `'con' + 'structor'` | VM isolation                      |
| Destructuring property names | `{ constructor: c }` | Freeze prototypes                 |

## Documentation

| Document                                                     | Purpose                                         |
| ------------------------------------------------------------ | ----------------------------------------------- |
| [docs/AGENTSCRIPT.md](./docs/AGENTSCRIPT.md)                 | AgentScript language reference for AI agents    |
| [docs/CVE-COVERAGE.md](./docs/CVE-COVERAGE.md)               | Detailed CVE analysis and protection mechanisms |
| [docs/SECURITY-AUDIT.md](./docs/SECURITY-AUDIT.md)           | Full list of 67+ blocked attack vectors         |
| [docs/STDLIB-SECURITY.md](./docs/STDLIB-SECURITY.md)         | Standard library security analysis              |
| [docs/LOOP-TRANSFORMATION.md](./docs/LOOP-TRANSFORMATION.md) | Future loop transformation design               |

## Roadmap

- [x] Core validator architecture
- [x] Built-in security rules
- [x] Argument validation
- [x] Unreachable code detection
- [x] Comprehensive test suite (613 tests)
- [x] CVE protection (vm2, isolated-vm, node-vm)
- [ ] Loop transformation (design complete)
- [ ] CLI tool
- [ ] VS Code extension

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

## License

Apache-2.0

## Credits

Built with:

- [acorn](https://github.com/acornjs/acorn) - JavaScript parser
- [acorn-walk](https://github.com/acornjs/acorn) - AST walker
- Part of the [FrontMCP](https://github.com/agentfront/frontmcp) ecosystem
