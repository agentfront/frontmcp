# Resource Module

This module implements MCP (Model Context Protocol) Resources for the FrontMCP SDK.

## What are MCP Resources?

Resources in MCP provide **readable data** that can be loaded into a model's context. They expose content like documents, configuration, API responses, or any data the model might need to reference.

### MCP Specification

- [MCP Resources Specification](https://modelcontextprotocol.io/docs/concepts/resources)
- [MCP Protocol Reference](https://spec.modelcontextprotocol.io/)

### Resource vs Tool

| Aspect     | Resource             | Tool                     |
| ---------- | -------------------- | ------------------------ |
| Purpose    | Provide data to read | Execute actions          |
| Direction  | Model pulls data     | Model triggers execution |
| Idempotent | Yes (read-only)      | Not necessarily          |
| Use case   | Context loading      | Side effects, mutations  |

## How Resources Work in FrontMCP

### Static Resources

Static resources have a fixed URI and return consistent content:

```typescript
import { Resource } from '@frontmcp/sdk';

@Resource({
  name: 'app-config',
  uri: 'config://app',
  mimeType: 'application/json',
})
class AppConfig {
  execute(uri: string) {
    return { version: '1.0', env: process.env.NODE_ENV };
  }
}
```

### Resource Templates

Templates use RFC 6570 URI patterns for dynamic content:

```typescript
import { ResourceTemplate } from '@frontmcp/sdk';

@ResourceTemplate({
  name: 'user-profile',
  uriTemplate: 'users://{userId}/profile',
  mimeType: 'application/json',
})
class UserProfile {
  execute(uri: string, params: Record<string, string>) {
    return this.fetchUser(params.userId);
  }
}
```

### Function Style

```typescript
import { resource } from '@frontmcp/sdk';

const Config = resource({
  name: 'config',
  uri: 'app://config',
})(() => ({ version: '1.0' }));
```

## Module Structure

```
resource/
├── index.ts              # Barrel exports
├── resource.registry.ts  # Central registry managing all resources
├── resource.instance.ts  # Individual resource instance wrapper
├── resource.utils.ts     # Normalization, metadata collection
├── resource.types.ts     # TypeScript types and interfaces
├── resource.events.ts    # Change event emitter
├── flows/                # MCP protocol handlers
│   ├── resources-list.flow.ts
│   ├── resource-templates-list.flow.ts
│   └── read-resource.flow.ts
└── __tests__/            # Unit tests
```

## Key Components

### ResourceRegistry

Manages all registered resources with:

- O(1) lookup by URI or name
- URI template matching with parameter extraction
- Parent-child adoption for hierarchical apps
- Name conflict resolution for exports

### ResourceInstance

Wraps individual resources providing:

- URI matching (exact or template)
- Context creation for execution
- Output parsing to MCP format

### Flows

Implement MCP protocol handlers:

- `resources:list-resources` - List static resources
- `resources:list-resource-templates` - List template resources
- `resources:read-resource` - Read resource content

## URI Template Support

Resources support RFC 6570 Level 1 URI templates:

```typescript
// Single parameter
'users://{userId}'; // matches users://123

// Multiple parameters
'repos://{owner}/{repo}'; // matches repos://org/project

// With path segments
'files://{path}/content'; // matches files://docs/content
```

Parameters are automatically extracted and passed to `execute()`.

## Return Values

Resources can return various formats:

```typescript
// Object (auto-serialized to JSON)
return { key: 'value' };

// String (text content)
return 'Plain text';

// Buffer (binary blob)
return Buffer.from(data);

// Full MCP format
return {
  contents: [{ uri, mimeType: 'text/plain', text: 'content' }],
};
```

## Testing

Unit tests are in `__tests__/`. Run with:

```bash
nx test sdk --testPathPatterns="resource"
```

See test files for usage examples and edge cases.

## Contributing

When adding features:

1. Follow existing patterns in `tool/` module
2. Maintain 95%+ test coverage
3. Update types in `resource.types.ts`
4. Add tests in `__tests__/`
5. Update this README if adding new concepts

## Related Modules

- `common/decorators/resource.decorator.ts` - @Resource, @ResourceTemplate
- `common/metadata/resource.metadata.ts` - Metadata schemas
- `common/tokens/resource.tokens.ts` - Reflection tokens
- `utils/uri-template.utils.ts` - RFC 6570 utilities
- `utils/content.utils.ts` - Content serialization
