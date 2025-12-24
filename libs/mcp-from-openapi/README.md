# mcp-from-openapi

> Production-ready TypeScript library for converting OpenAPI specifications into MCP (Model Context Protocol) tool
> definitions

[![npm version](https://badge.fury.io/js/mcp-from-openapi.svg)](https://www.npmjs.com/package/mcp-from-openapi)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-yellow.svg)](https://opensource.org/license/apache-2-0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

## What This Solves

When converting OpenAPI specs to MCP tools, you encounter **parameter conflicts** - the same parameter name appears in
different locations (path, query, body). This library automatically resolves these conflicts and provides an **explicit
mapper** that tells you exactly how to construct HTTP requests.

**The Problem:**

```yaml
# OpenAPI spec
paths:
  /users/{id}:
    post:
      parameters:
        - name: id # id in PATH
          in: path
      requestBody:
        content:
          application/json:
            schema:
              properties:
                id: # id in BODY - CONFLICT!
                  type: string
```

**The Solution:**

```typescript
{
  inputSchema: {
    properties: {
      pathId: { type: "string" },    // Automatically renamed!
      bodyId: { type: "string" }     // Automatically renamed!
    }
  },
  mapper: [
    { inputKey: "pathId", type: "path", key: "id" },
    { inputKey: "bodyId", type: "body", key: "id" }
  ]
}
```

Now you know **exactly** how to build the HTTP request!

## Features

- 🎯 **Smart Parameter Handling** - Automatic conflict detection and resolution
- 📦 **Complete Schemas** - Input schema combines all parameters, output schema from responses
- 🔐 **Rich Metadata** - Authentication, servers, tags, deprecation status
- 🔧 **Multiple Input Sources** - Load from URL, file, YAML string, or JSON object
- ✅ **Production Ready** - Full TypeScript, validation, error handling, 80%+ test coverage
- 🧩 **Zod Compatible** - Schemas ready for json-schema-to-zod conversion
- 🚀 **MCP Native** - Designed specifically for Model Context Protocol integration

## Installation

```bash
npm install mcp-from-openapi
# or
yarn add mcp-from-openapi
# or
pnpm add mcp-from-openapi
```

## Quick Start

### Basic Usage

```typescript
import { OpenAPIToolGenerator } from 'mcp-from-openapi';

// 1. Load OpenAPI spec
const generator = await OpenAPIToolGenerator.fromURL('https://api.example.com/openapi.json');

// 2. Generate tools
const tools = await generator.generateTools();

// 3. Each tool has everything you need:
tools.forEach((tool) => {
  console.log(tool.name); // "createUser"
  console.log(tool.inputSchema); // Combined schema for all params
  console.log(tool.outputSchema); // Response schema
  console.log(tool.mapper); // How to build the HTTP request
  console.log(tool.metadata); // Auth, servers, tags, etc.
});
```

### Loading from Different Sources

```typescript
// From URL
const generator = await OpenAPIToolGenerator.fromURL('https://api.example.com/openapi.json');

// From file
const generator = await OpenAPIToolGenerator.fromFile('./openapi.yaml');

// From YAML string
const yamlString = `
openapi: 3.0.0
info:
  title: My API
  version: 1.0.0
paths:
  /users:
    get:
      responses:
        '200':
          description: Success
`;
const generator = await OpenAPIToolGenerator.fromYAML(yamlString);

// From JSON object
const openApiSpec = { openapi: '3.0.0' /* ... */ };
const generator = await OpenAPIToolGenerator.fromJSON(openApiSpec);
```

### Understanding the Output

Each generated tool includes:

```typescript
interface McpOpenAPITool {
  name: string; // Operation ID or generated name
  description: string; // From operation summary/description
  inputSchema: JSONSchema7; // Combined input schema (all params)
  outputSchema?: JSONSchema7; // Response schema (can be union)
  mapper: ParameterMapper[]; // Input → Request mapping
  metadata: ToolMetadata; // Auth, servers, etc.
}
```

### Using the Mapper

The mapper tells you how to convert tool input into an HTTP request:

```typescript
function buildRequest(tool: McpOpenAPITool, input: any) {
  let path = tool.metadata.path;
  const query = new URLSearchParams();
  const headers: Record<string, string> = {};
  let body: any;

  tool.mapper.forEach((m) => {
    const value = input[m.inputKey];
    if (!value) return;

    switch (m.type) {
      case 'path':
        path = path.replace(`{${m.key}}`, encodeURIComponent(value));
        break;
      case 'query':
        query.set(m.key, value);
        break;
      case 'header':
        headers[m.key] = value;
        break;
      case 'body':
        if (!body) body = {};
        body[m.key] = value;
        break;
    }
  });

  return {
    url: `${tool.metadata.servers[0].url}${path}?${query}`,
    method: tool.metadata.method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  };
}

// Example usage
const request = buildRequest(tool, {
  pathId: 'user-123',
  bodyName: 'John Doe',
  bodyEmail: 'john@example.com',
});

const response = await fetch(request.url, {
  method: request.method,
  headers: request.headers,
  body: request.body,
});
```

### Handling Parameter Conflicts

When the same parameter name appears in different locations, the library automatically renames them:

```typescript
// OpenAPI with conflicts:
// - id in path
// - id in query
// - id in body

const tool = await generator.generateTool('/users/{id}', 'post');

// Generated input schema:
{
  properties: {
    pathId: { type: "string" },   // Renamed!
    queryId: { type: "string" },  // Renamed!
    bodyId: { type: "string" }    // Renamed!
  }
}

// Your input should use the renamed keys:
const input = {
  pathId: "user-123",      // Not "id"
  queryId: "track-456",
  bodyId: "internal-789"
};
```

## Common Use Cases

### 1. Build an MCP Server

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { OpenAPIToolGenerator } from 'mcp-from-openapi';

const server = new Server(/* ... */);

// Load tools from OpenAPI
const generator = await OpenAPIToolGenerator.fromURL('https://api.example.com/openapi.json');
const tools = await generator.generateTools();

// Register each tool
tools.forEach((tool) => {
  server.setRequestHandler(tool.name, async (request) => {
    const httpRequest = buildRequest(tool, request.params);
    const response = await fetch(httpRequest.url, httpRequest);
    return response.json();
  });
});
```

### 2. Filter Operations

```typescript
// Only GET operations
const tools = await generator.generateTools({
  filterFn: (op) => op.method === 'get', // op has path and method properties
});

// Specific operations by ID
const tools = await generator.generateTools({
  includeOperations: ['getUser', 'createUser'],
});

// Exclude deprecated
const tools = await generator.generateTools({
  includeDeprecated: false,
});
```

### 3. Handle Multiple Response Codes

```typescript
// Include all response status codes
const tools = await generator.generateTools({
  includeAllResponses: true, // Creates oneOf union
});

// Or prefer specific codes only
const tools = await generator.generateTools({
  preferredStatusCodes: [200, 201],
  includeAllResponses: false,
});
```

### 4. Custom Base URL

```typescript
const generator = await OpenAPIToolGenerator.fromURL(url, {
  baseUrl: 'https://staging.api.example.com',
});
```

### 5. Validate Before Generating

```typescript
const generator = await OpenAPIToolGenerator.fromFile('./openapi.yaml');

const validation = await generator.validate();
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
  throw new Error('Invalid OpenAPI spec');
}

const tools = await generator.generateTools();
```

### 6. Custom Naming Strategy

```typescript
const tool = await generator.generateTool('/users/{id}', 'post', {
  namingStrategy: {
    conflictResolver: (paramName, location, index) => {
      // Custom naming logic
      return `${location.toUpperCase()}_${paramName}`;
    },
  },
});
```

### 7. Integration with Zod

```typescript
import { zodSchema } from 'json-schema-to-zod';

const tools = await generator.generateTools();

const validatedTools = tools.map((tool) => ({
  ...tool,
  validateInput: zodSchema(tool.inputSchema),
  validateOutput: tool.outputSchema ? zodSchema(tool.outputSchema) : null,
}));

// Use validators
const validatedInput = validatedTools[0].validateInput.parse(userInput);
```

## API Reference

### OpenAPIToolGenerator

#### Static Factory Methods

```typescript
// Load from URL
static async fromURL(url: string, options?: LoadOptions): Promise<OpenAPIToolGenerator>

// Load from file path
static async fromFile(filePath: string, options?: LoadOptions): Promise<OpenAPIToolGenerator>

// Load from YAML string
static async fromYAML(yaml: string, options?: LoadOptions): Promise<OpenAPIToolGenerator>

// Load from JSON object
static async fromJSON(json: object, options?: LoadOptions): Promise<OpenAPIToolGenerator>
```

#### Instance Methods

```typescript
// Generate all tools
async generateTools(options?: GenerateOptions): Promise<McpOpenAPITool[]>

// Generate a specific tool
async generateTool(path: string, method: string, options?: GenerateOptions): Promise<McpOpenAPITool>

// Get OpenAPI document
getDocument(): OpenAPIDocument

// Validate OpenAPI document
async validate(): Promise<ValidationResult>
```

### Configuration Options

#### LoadOptions

```typescript
interface LoadOptions {
  dereference?: boolean; // Resolve $refs (default: true)
  baseUrl?: string; // Override base URL
  headers?: Record<string, string>; // Custom headers for URL loading
  timeout?: number; // Request timeout (default: 30000ms)
  validate?: boolean; // Validate document (default: true)
  followRedirects?: boolean; // Follow redirects (default: true)
}
```

#### GenerateOptions

```typescript
interface GenerateOptions {
  includeOperations?: string[];     // Include only these operation IDs
  excludeOperations?: string[];     // Exclude these operation IDs
  filterFn?: (op: OperationWithContext) => boolean; // Custom filter (op has path and method)
  namingStrategy?: NamingStrategy;  // Custom naming for conflicts
  preferredStatusCodes?: number[];  // Preferred response codes
  includeDeprecated?: boolean;      // Include deprecated ops (default: false)
  includeAllResponses?: boolean;    // Include all status codes (default: true)
  maxSchemaDepth?: number;          // Max depth for schemas (default: 10)
}

// OperationWithContext extends OperationObject with:
interface OperationWithContext extends OperationObject {
  path: string;   // The API path
  method: string; // The HTTP method (get, post, etc.)
}
}
```

#### NamingStrategy

```typescript
interface NamingStrategy {
  conflictResolver: (paramName: string, location: ParameterLocation, index: number) => string;

  toolNameGenerator?: (path: string, method: HTTPMethod, operationId?: string) => string;
}
```

### Types

#### McpOpenAPITool

```typescript
interface McpOpenAPITool {
  name: string;
  description: string;
  inputSchema: JSONSchema7;
  outputSchema?: JSONSchema7;
  mapper: ParameterMapper[];
  metadata: ToolMetadata;
}
```

#### ParameterMapper

```typescript
interface ParameterMapper {
  inputKey: string; // Property name in input schema
  type: ParameterLocation; // 'path' | 'query' | 'header' | 'cookie' | 'body'
  key: string; // Original parameter name
  required?: boolean;
  style?: string;
  explode?: boolean;
  serialization?: SerializationInfo;
}
```

#### ToolMetadata

```typescript
interface ToolMetadata {
  path: string;
  method: HTTPMethod;
  operationId?: string;
  tags?: string[];
  deprecated?: boolean;
  security?: SecurityRequirement[];
  servers?: ServerInfo[];
  responseStatusCodes?: number[];
  externalDocs?: ExternalDocumentation;
}
```

## Error Handling

```typescript
import { LoadError, ParseError, ValidationError, GenerationError } from 'mcp-from-openapi';

try {
  const generator = await OpenAPIToolGenerator.fromURL(url);
  const tools = await generator.generateTools();
} catch (error) {
  if (error instanceof LoadError) {
    console.error('Failed to load:', error.message);
  } else if (error instanceof ParseError) {
    console.error('Failed to parse:', error.message);
  } else if (error instanceof ValidationError) {
    console.error('Invalid spec:', error.errors);
  } else if (error instanceof GenerationError) {
    console.error('Generation failed:', error.message);
  }
}
```

## Architecture

### System Overview

The library follows a modular architecture with clear separation of concerns:

```
OpenAPIToolGenerator (Main Entry Point)
├── Validator          → OpenAPI document validation
├── ParameterResolver  → Parameter conflict resolution & mapping
├── ResponseBuilder    → Output schema generation
└── SchemaBuilder      → Schema manipulation utilities
```

### Data Flow

```
User Input (URL/File/String/Object)
        ↓
    Load & Parse
        ↓
  OpenAPI Document
        ↓
    Validate (optional)
        ↓
  Dereference $refs (optional)
        ↓
    For Each Operation:
        ├── ParameterResolver → inputSchema + mapper
        ├── ResponseBuilder   → outputSchema
        └── Metadata Extractor → metadata
        ↓
    McpOpenAPITool[]
```

### Core Components

#### 1. OpenAPIToolGenerator

- **Responsibility**: Entry point, orchestration, document management
- **Key Methods**: Factory methods, generateTools(), validate()

#### 2. ParameterResolver

- **Responsibility**: Collect parameters, detect conflicts, generate mapper
- **Algorithm**:
  1. Collect all parameters by name from all sources
  2. Detect naming conflicts
  3. Apply naming strategy to resolve conflicts
  4. Build combined input schema
  5. Create mapper entries

#### 3. ResponseBuilder

- **Responsibility**: Extract response schemas, handle multiple status codes
- **Features**:
  - Prefer specific status codes
  - Generate union types (oneOf) for multiple responses
  - Add metadata (status code, content type)

#### 4. Validator

- **Responsibility**: Validate OpenAPI document structure
- **Checks**:
  - OpenAPI version (3.0.x or 3.1.x)
  - Required fields (info, paths, etc.)
  - Path parameters defined
  - Operation structure

### Design Patterns

1. **Factory Pattern** - For creating generator instances
2. **Strategy Pattern** - For parameter naming customization
3. **Builder Pattern** - For schema construction
4. **Template Method** - For tool generation workflow

### Extension Points

1. **Custom Naming Strategies** - Implement `NamingStrategy` interface
2. **Custom Filters** - Use `filterFn` in `GenerateOptions`
3. **Custom Validators** - Extend `Validator` class
4. **Schema Transformations** - Use `SchemaBuilder` utilities

## Best Practices

### 1. Always Dereference in Production

```typescript
const generator = await OpenAPIToolGenerator.fromURL(url, {
  dereference: true, // Resolve all $refs for easier consumption
});
```

### 2. Validate Before Generating

```typescript
const validation = await generator.validate();
if (!validation.valid) {
  throw new Error('Invalid OpenAPI spec');
}
```

### 3. Cache Generated Tools

```typescript
class ToolCache {
  private cache = new Map<string, McpOpenAPITool[]>();

  async getTools(apiUrl: string): Promise<McpOpenAPITool[]> {
    if (this.cache has(apiUrl)) {
      return this.cache.get(apiUrl)!;
    }

    const generator = await OpenAPIToolGenerator.fromURL(apiUrl);
    const tools = await generator.generateTools();
    this.cache.set(apiUrl, tools);

    return tools;
  }
}
```

### 4. Use TypeScript

```typescript
import type { McpOpenAPITool, LoadOptions } from 'mcp-from-openapi';

const options: LoadOptions = {
  dereference: true,
  validate: true,
};
```

### 5. Handle Errors Properly

```typescript
try {
  const tools = await generator.generateTools();
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Validation errors:', error.errors);
  }
  // Handle appropriately
}
```

## Examples

Check the `examples/` directory for comprehensive examples including:

1. Basic usage
2. Parameter conflict resolution
3. Custom naming strategies
4. Multiple response handling
5. Authentication handling
6. Operation filtering
7. Zod integration
8. Request mapping

## Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.0 (for TypeScript users)

## Dependencies

- `@apidevtools/json-schema-ref-parser` - $ref dereferencing
- `yaml` - YAML parsing
- `undici` - Modern HTTP client
- `json-schema` - Type definitions

## Contributing

Contributions are welcome! Please see our contributing guidelines.

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [OpenAPI Specification](https://www.openapis.org/)
- [JSON Schema](https://json-schema.org/)

---

**Made with ❤️ for the MCP community**
