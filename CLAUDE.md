# FrontMCP Monorepo - Development Guide

## Repository Structure

- **Monorepo**: Nx-based monorepo managing multiple TypeScript libraries
- **Libraries Location**: `/libs/*` - each library is independent and publishable

### Primary Libraries (scoped under `@frontmcp/*`)

Located in `/libs/*`:

- **cli** (`libs/cli`) - Command-line interface
- **sdk** (`libs/sdk`) - Core FrontMCP SDK
- **adapters** (`libs/adapters`) - Framework adapters and integrations
- **plugins** (`libs/plugins`) - Plugin system and extensions

### Helper/Independent Libraries

Located in `/libs/*`:

- **ast-guard** (`libs/ast-guard`) - JavaScript AST security validation with extensible rules
- **json-schema-to-zod-v3** (`libs/json-schema-to-zod-v3`) - JSON Schema to Zod converter
- **mcp-from-openapi** (`libs/mcp-from-openapi`) - Generate MCP servers from OpenAPI specs
- **vectoriadb** (`libs/vectoriadb`) - Lightweight in-memory vector database

### Demo Apps

Located in `/apps/*`:

- **demo** (`apps/demo`) - Demo application for development and testing

## Technology Stack

- **Build System**: Nx (commands: `nx build ast-guard`, `nx test ast-guard`, `nx run-many -t test`)
- **Language**: TypeScript with strict mode enabled
- **Testing**: Jest with 95%+ coverage requirement
- **Parser**: Acorn (for AST analysis)
- **Package Manager**: npm/yarn

## Development Commands

```bash
# Test single library
nx test ast-guard
nx test ast-guard --coverage

# Test all libraries
nx run-many -t test
nx run-many -t test --coverage

# Build
nx build ast-guard

# Build all
nx run-many -t build
```

## Code Quality Standards

- **Coverage Requirement**: 95%+ across all metrics (statements, branches, functions, lines)
- **No Warnings**: Build must complete without TypeScript warnings
- **All Tests Passing**: 100% test pass rate required
- **Strict TypeScript**: Use strict type checking, no `any` types without justification

## Testing Conventions

### Test File Naming

- Use kebab-case: `advanced-attack-vectors.spec.ts`, `error-handling.spec.ts`
- Place in `__tests__` directory alongside source files
- NO "penetration-test" or similar security jargon in filenames

### Test Naming

- Use clean, descriptive names: `should validate argument count`, `should detect eval() calls`
- NO prefixes like "PT-001", "TEST-123", etc.
- Follow pattern: `describe('FeatureName', () => { it('should do something', ...) })`

### Test Organization

```typescript
describe('ClassName or FeatureName', () => {
  describe('methodName', () => {
    it('should handle normal case', async () => {
      // Test implementation
    });

    it('should handle edge case', async () => {
      // Test implementation
    });

    it('should throw error for invalid input', async () => {
      // Test implementation
    });
  });
});
```

## File Naming Conventions

- **Source Files**: kebab-case (e.g., `disallowed-identifier.rule.ts`)
- **Test Files**: kebab-case with `.spec.ts` suffix
- **Type Files**: kebab-case with `.types.ts` or `.interfaces.ts` suffix
- **Index Files**: `index.ts` for barrel exports

## Library Development Guidelines

### NO Backwards Compatibility

- This is a NEW codebase - no legacy exports or compatibility layers
- Remove any `// Legacy export` comments
- Remove any `export { OldName as NewName }` aliases
- If renaming, update all references and remove old exports entirely

### Preset Pattern (ast-guard specific)

```typescript
// Four-tier security hierarchy (high to low)
export enum PresetLevel {
  STRICT = 'strict', // Maximum security, blocks 90+ dangerous identifiers
  SECURE = 'secure', // High security, blocks common exploits
  STANDARD = 'standard', // Balanced security
  PERMISSIVE = 'permissive', // Minimal restrictions
}

// Export both individual functions and Presets object
export const Presets = {
  strict: createStrictPreset,
  secure: createSecurePreset,
  standard: createStandardPreset,
  permissive: createPermissivePreset,
  create: createPreset,
} as const;
```

### Validation Rule Pattern (ast-guard specific)

```typescript
export class MyRule implements ValidationRule {
  readonly name = 'my-rule';
  readonly defaultSeverity = ValidationSeverity.ERROR;

  constructor(private options: MyRuleOptions) {
    // Validate options in constructor
    if (!options.something) {
      throw new RuleConfigurationError('Message', this.name);
    }
  }

  async execute(context: ValidationContext): Promise<void> {
    // Use acorn-walk to traverse AST
    walk.simple(context.ast, {
      NodeType(node: any) {
        // Validate node
        if (isInvalid(node)) {
          context.report({
            code: 'ERROR_CODE',
            message: 'Error message',
            severity: this.defaultSeverity,
            node,
            data: { key: value },
          });
        }
      },
    });
  }
}
```

## TypeScript Conventions

- **Strict Mode**: Always use strict TypeScript configuration
- **No `any`**: Avoid `any` types - use `unknown` or proper types
- **Explicit Returns**: Always specify return types for public methods
- **Readonly**: Use `readonly` for properties that shouldn't change
- **Const Assertions**: Use `as const` for object literals that shouldn't be modified

## Testing Best Practices

### Achieving 95%+ Coverage

1. **Test All Public Methods**: Every public method needs at least one test
2. **Test Error Paths**: Test constructor validation, invalid inputs, edge cases
3. **Test Branches**: Ensure all `if/else` branches are covered
4. **Test Error Classes**: Test all custom error constructors with different parameters
5. **Test Utility Functions**: Don't forget small helper functions

### Coverage-Focused Test Patterns

```typescript
// Test constructor validation
it('should throw error when invalid options provided', () => {
  expect(() => new MyClass({})).toThrow('Expected message');
});

// Test all branches
it('should handle case when option is undefined', () => { ... });
it('should handle case when option is provided', () => { ... });

// Test error inheritance
it('should be instanceof CustomError after creation', () => {
  const error = new CustomError('test');
  expect(error instanceof CustomError).toBe(true);
  expect(error instanceof BaseError).toBe(true);
});

// Test member expressions and computed properties
it('should detect member expression calls', () => { ... });
it('should handle unknown identifier types', () => { ... });
```

## Security-Focused Development (ast-guard)

### Known Limitations of Static Analysis

1. **Computed Property Access**: Cannot detect `obj['con' + 'structor']`
2. **Unicode Escapes**: Cannot detect `\u0065val` (evaluates to "eval")
3. **Dynamic Code Paths**: Cannot analyze runtime-constructed code

### Defense-in-Depth Strategy

```typescript
// Layer 1: AST Guard (static analysis)
const validator = new JSAstValidator(Presets.strict());
const result = await validator.validate(code);

// Layer 2: Object.freeze (runtime protection)
Object.freeze(Object.prototype);
Object.freeze(Function.prototype);

// Layer 3: VM isolation
const vm = require('vm');
vm.runInNewContext(code, { /* minimal context */ });

// Layer 4: CSP headers (browser)
Content-Security-Policy: script-src 'self'
```

## Git Workflow

- **Branch Naming**: Use descriptive names (e.g., `add-codecall-plugin`, `improve-coverage`)
- **Main Branch**: `main` - use this for PRs
- **Commits**: Clear, descriptive messages
- **Before Commit**: Run tests and build to ensure everything passes

## Documentation Standards

- **README.md**: Every library needs comprehensive README with examples
- **JSDoc Comments**: Document public APIs with JSDoc
- **Type Definitions**: Provide detailed TypeScript types for better DX
- **Security Docs**: For security libraries, document known limitations and mitigations

## Common Patterns

### Error Handling

```typescript
// Use custom error classes
export class AstGuardError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'AstGuardError';
    Object.setPrototypeOf(this, AstGuardError.prototype); // Fix instanceof
  }
}

// Extend for specific errors
export class ParseError extends AstGuardError {
  constructor(message: string, public line?: number, public column?: number) {
    super(message, 'PARSE_ERROR');
    this.name = 'ParseError';
    Object.setPrototypeOf(this, ParseError.prototype);
  }
}
```

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

### Helper/Independent Libraries

#### ast-guard

- **Type**: Helper library (independent, publishable)
- **Purpose**: Bank-grade JavaScript validation using AST analysis
- **Security Model**: Four-tier preset system (STRICT > SECURE > STANDARD > PERMISSIVE)
- **Test Count**: 188 tests with 95.11% coverage
- **Key Rules**: DisallowedIdentifier, NoEval, NoAsync, CallArgumentValidation, etc.
- **Documentation**: SECURITY-AUDIT.md documents all 67 blocked attack vectors
- **Usage**: Can be used by @frontmcp packages or independently

#### vectoriadb

- **Type**: Helper library (independent, publishable)
- **Purpose**: Lightweight in-memory vector database for embeddings
- **Use Case**: Semantic search, RAG systems, similarity matching
- **Usage**: Can be used by @frontmcp packages or independently

#### json-schema-to-zod-v3

- **Type**: Helper library (independent, publishable)
- **Purpose**: Convert JSON Schema definitions to Zod schemas
- **Use Case**: Type-safe runtime validation, schema transformation
- **Usage**: Used for converting OpenAPI/JSON schemas to TypeScript Zod validators

#### mcp-from-openapi

- **Type**: Helper library (independent, publishable)
- **Purpose**: Generate MCP (Model Context Protocol) servers from OpenAPI specifications
- **Use Case**: Automatically create MCP-compatible servers from REST API definitions
- **Usage**: Bridges OpenAPI ecosystem with MCP protocol

### Demo Applications

#### demo (`apps/demo`)

- **Type**: Demo application
- **Purpose**: Development and testing playground for FrontMCP packages
- **Usage**: Testing integrations, examples, and development workflows

## Anti-Patterns to Avoid

❌ **Don't**: Add backwards compatibility exports in new libraries
❌ **Don't**: Use prefixes like "PT-001" in test names
❌ **Don't**: Skip constructor validation tests
❌ **Don't**: Ignore error class `instanceof` checks in tests
❌ **Don't**: Use `any` type without strong justification
❌ **Don't**: Commit code with test failures or build warnings

✅ **Do**: Use clean, descriptive names for everything
✅ **Do**: Test all code paths including errors
✅ **Do**: Document known limitations clearly
✅ **Do**: Follow the preset pattern for hierarchical configurations
✅ **Do**: Achieve 95%+ test coverage
✅ **Do**: Use strict TypeScript settings
✅ **Do**: Write comprehensive security documentation

## Quick Reference

### Create New Library

```bash
# Generate new library (if using Nx generators)
nx g @nx/js:library my-library --directory=libs/my-library

# Or create manually:
mkdir -p libs/my-library/src
# Add package.json, tsconfig.json, jest.config.js
```

### Add New Test

```typescript
// 1. Create test file: src/__tests__/feature.spec.ts
import { MyClass } from '../my-class';

describe('MyClass', () => {
  describe('myMethod', () => {
    it('should handle valid input', () => {
      const instance = new MyClass();
      const result = instance.myMethod('valid');
      expect(result).toBe(expected);
    });

    it('should throw error for invalid input', () => {
      const instance = new MyClass();
      expect(() => instance.myMethod('invalid')).toThrow('Expected error');
    });
  });
});
```

### Check Coverage

```bash
nx test sdk --coverage
# Look for: Statements, Branches, Functions, Lines all > 95%
```

### Build and Test Before Commit

```bash
nx run-many -t test --coverage
nx run-many -t build
git add .
git commit -m "feat: descriptive message"
```
