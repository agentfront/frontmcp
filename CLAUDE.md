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
