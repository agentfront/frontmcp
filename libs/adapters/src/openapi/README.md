# OpenAPI Adapter for FrontMCP

Automatically generate MCP tools from any OpenAPI 3.0/3.1 specification. This adapter converts OpenAPI endpoints into
FrontMCP tools with full type safety, authentication support, and automatic request building.

## Features

✅ **Universal Compatibility** - Works with any OpenAPI spec found on the internet

✅ **12+ Authentication Types** - Bearer, Basic, Digest, API Keys, mTLS, HMAC, AWS Signature V4, OAuth2, and more

✅ **Full Type Safety** - Automatic Zod schema generation from JSON Schema

✅ **Smart Request Building** - Automatic parameter mapping (path, query, header, body)

✅ **Security Resolution** - Framework-agnostic authentication from context

✅ **Custom Mappers** - Transform headers and body based on session data

✅ **Output Transforms** - Modify output schemas, add schema to descriptions, transform response data

✅ **Production Ready** - Comprehensive error handling, validation, and security protections

## Quick Start

### From URL

```typescript
import { OpenapiAdapter } from '@frontmcp/adapters';

const adapter = new OpenapiAdapter({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',
});
```

### From Local Spec

```typescript
import { OpenapiAdapter } from '@frontmcp/adapters';
import spec from './openapi.json';

const adapter = new OpenapiAdapter({
  name: 'my-api',
  spec: spec, // Accepts object, OpenAPIV3.Document, or OpenAPIV3_1.Document
  baseUrl: 'https://api.example.com',
});
```

## Configuration

### Basic Options

```typescript
const adapter = new OpenapiAdapter({
  // Required
  name: 'my-api', // Adapter name (used for tool prefixing)
  baseUrl: 'https://api.example.com', // API base URL

  // One of:
  url: 'https://api.example.com/openapi.json', // OpenAPI spec URL
  // OR
  spec: openapiDocument, // OpenAPI spec object

  // Optional
  additionalHeaders: {
    // Static headers for all requests
    'User-Agent': 'FrontMCP/1.0',
  },
});
```

### Load Options

Control how the OpenAPI spec is loaded:

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',

  loadOptions: {
    validate: true, // Validate OpenAPI spec (default: true)
    dereference: true, // Resolve $refs for flat schemas (default: true)
    headers: {
      // Headers for fetching spec
      Authorization: 'Bearer token',
    },
    timeout: 30000, // Request timeout in ms (default: 30000)
    followRedirects: true, // Follow HTTP redirects (default: true)
  },
});
```

### Generate Options

Control which tools are generated:

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',

  generateOptions: {
    // Filter operations
    includeOperations: ['getUser', 'createUser'], // Only these operations
    excludeOperations: ['deleteUser'], // Exclude these operations
    includeDeprecated: false, // Include deprecated ops (default: false)

    // Custom filter
    filterFn: (operation) => {
      return operation.tags?.includes('public');
    },

    // Response handling
    preferredStatusCodes: [200, 201, 202, 204], // Preferred response codes
    includeAllResponses: true, // Include all response schemas (default: true)

    // Security (see Authentication section)
    includeSecurityInInput: false, // Add auth to input schema (default: false)

    // Naming strategy
    namingStrategy: {
      toolNameGenerator: (path, method, operationId) => {
        return operationId || `${method}_${path.replace(/\//g, '_')}`;
      },
    },
  },
});
```

## Authentication

### Automatic Bearer Token

If your OpenAPI spec uses Bearer authentication, the adapter automatically uses the JWT token from FrontMCP's auth
context:

```typescript
// OpenAPI spec with Bearer auth
{
  "components": {
    "securitySchemes": {
      "BearerAuth": {  // This name doesn't matter!
        "type": "http",
        "scheme": "bearer"
      }
    }
  },
  "security": [{ "BearerAuth": [] }]
}

// Adapter (no config needed - uses ctx.authInfo.token automatically!)
const adapter = new OpenapiAdapter({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',
});
```

**Works with ANY security scheme name** - Whether it's called "BearerAuth", "JWT", "Authorization", or anything else,
the adapter automatically detects Bearer tokens and uses `ctx.authInfo.token`!

### Custom Headers (API Keys)

Add static authentication headers:

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',

  additionalHeaders: {
    'X-API-Key': process.env.API_KEY,
    'X-Client-ID': 'my-client-id',
  },
});
```

### Dynamic Headers from Auth Context

Map user session data to headers:

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',

  headersMapper: (authInfo, headers) => {
    // Add tenant ID from session to header
    const tenantId = authInfo.user?.tenantId;
    if (tenantId) {
      headers.set('X-Tenant-ID', tenantId);
    }
    return headers;
  },
});
```

### Dynamic Body Mapping

Inject session data into request bodies:

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',

  bodyMapper: (authInfo, body) => {
    // Add user ID to all request bodies
    return {
      ...body,
      userId: authInfo.user?.id,
      createdBy: authInfo.user?.email,
    };
  },
});
```

### Multiple Auth Providers

When you have multiple OAuth providers or different tools need different authentication, use one of these approaches:

#### Approach 1: Auth Provider Mapper (Recommended)

Map OpenAPI security scheme names to auth provider extractors:

```typescript
const adapter = new OpenapiAdapter({
  name: 'multi-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',

  // Map security schemes to auth extractors
  authProviderMapper: {
    // GitHub OAuth security scheme
    GitHubAuth: (authInfo) => authInfo.user?.githubToken,

    // Google OAuth security scheme
    GoogleAuth: (authInfo) => authInfo.user?.googleToken,

    // API Key security scheme
    ApiKeyAuth: (authInfo) => authInfo.user?.apiKey,

    // Slack OAuth security scheme
    SlackAuth: (authInfo) => authInfo.user?.slackToken,
  },
});
```

**How it works:**

- Each tool uses security schemes defined in your OpenAPI spec
- The adapter looks up the scheme name in `authProviderMapper`
- It calls the corresponding extractor to get the token from `authInfo.user`
- Different tools automatically use different tokens based on their security requirements
- **Note:** Empty string tokens throw a descriptive error. Return `undefined` if no token is available.

#### Approach 2: Custom Security Resolver

For complex logic, provide a custom resolver per tool:

```typescript
const adapter = new OpenapiAdapter({
  name: 'multi-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',

  securityResolver: (tool, authInfo) => {
    // Route by tool name prefix
    if (tool.name.startsWith('github_')) {
      return {
        jwt: authInfo.user?.githubToken,
      };
    }

    if (tool.name.startsWith('google_')) {
      return {
        jwt: authInfo.user?.googleToken,
      };
    }

    if (tool.name.startsWith('stripe_')) {
      return {
        apiKey: authInfo.user?.stripeApiKey,
      };
    }

    // Default to main JWT
    return {
      jwt: authInfo.token,
    };
  },
});
```

#### Approach 3: Static Auth (Server-to-Server)

For server-to-server APIs with static credentials:

```typescript
const adapter = new OpenapiAdapter({
  name: 'internal-api',
  url: 'https://internal.example.com/openapi.json',
  baseUrl: 'https://internal.example.com',

  // Use static auth instead of dynamic context
  staticAuth: {
    jwt: process.env.INTERNAL_API_JWT,
    apiKey: process.env.INTERNAL_API_KEY,
  },
});
```

#### Approach 4: Hybrid Authentication (Per-Scheme Control)

When you need some security schemes to be provided by the user in tool inputs while others are resolved from context (session/headers), use `securitySchemesInInput`:

```typescript
// OpenAPI spec with multiple security schemes
{
  "components": {
    "securitySchemes": {
      "BearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "description": "User's OAuth token"
      },
      "ApiKeyAuth": {
        "type": "apiKey",
        "in": "header",
        "name": "X-API-Key",
        "description": "Server API key"
      }
    }
  },
  "paths": {
    "/data": {
      "get": {
        "security": [
          { "BearerAuth": [], "ApiKeyAuth": [] }
        ]
      }
    }
  }
}

// Adapter configuration
const adapter = new OpenapiAdapter({
  name: 'hybrid-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',

  // Only these schemes appear in tool input schema (user provides)
  securitySchemesInInput: ['BearerAuth'],

  // Other schemes (ApiKeyAuth) resolved from context
  authProviderMapper: {
    ApiKeyAuth: (authInfo) => authInfo.user?.apiKey,
  },
});
```

**How it works:**

- `securitySchemesInInput: ['BearerAuth']` - Only `BearerAuth` appears in the tool's input schema
- User provides the Bearer token when calling the tool
- `ApiKeyAuth` is automatically resolved from `authProviderMapper` (not visible to user)
- This is useful when:
  - Some credentials are user-specific (OAuth tokens) and must be provided per-call
  - Other credentials are server-side secrets (API keys) managed by your application

**Use cases:**

1. **Multi-tenant with user OAuth**: Server API key for tenant access + user OAuth token for identity
2. **Third-party integrations**: Your API key for rate limiting + user's token for their data
3. **Hybrid auth flows**: Some endpoints need user tokens, others use service accounts

### Auth Resolution Priority

The adapter resolves authentication in this order:

1. **Custom `securityResolver`** (highest priority) - Full control per tool
2. **`authProviderMapper`** with `securitySchemesInInput` - Hybrid: some from input, some from context
3. **`authProviderMapper`** - Map security schemes to auth providers
4. **`staticAuth`** - Static credentials
5. **Default** - Uses `ctx.authInfo.token` (lowest priority)

**Note:** When using `securitySchemesInInput`, only the specified schemes appear in the tool's input schema. All other schemes must have mappings in `authProviderMapper` or will use the default resolution.

## Real-World Examples

### Multi-Tenant SaaS API

```typescript
const adapter = new OpenapiAdapter({
  name: 'saas-api',
  url: 'https://api.saas.com/openapi.json',
  baseUrl: 'https://api.saas.com',

  // Inject tenant context
  headersMapper: (authInfo, headers) => {
    const tenantId = authInfo.user?.organizationId;
    if (tenantId) {
      headers.set('X-Organization-ID', tenantId);
    }
    return headers;
  },

  // Filter to only public endpoints
  generateOptions: {
    filterFn: (operation) => {
      return !operation.tags?.includes('internal');
    },
  },
});
```

### GitHub API

```typescript
const adapter = new OpenapiAdapter({
  name: 'github',
  url: 'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json',
  baseUrl: 'https://api.github.com',

  additionalHeaders: {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  },

  headersMapper: (authInfo, headers) => {
    const githubToken = authInfo.user?.githubToken;
    if (githubToken) {
      headers.set('Authorization', `Bearer ${githubToken}`);
    }
    return headers;
  },
});
```

### Multi-Provider Integration Platform

When building a platform that integrates multiple third-party APIs:

```typescript
// OpenAPI spec with multiple security schemes
{
  "components": {
    "securitySchemes": {
      "GitHubOAuth": {
        "type": "http",
        "scheme": "bearer",
        "description": "GitHub OAuth token"
      },
      "SlackOAuth": {
        "type": "http",
        "scheme": "bearer",
        "description": "Slack OAuth token"
      },
      "StripeAuth": {
        "type": "apiKey",
        "in": "header",
        "name": "Authorization",
        "description": "Stripe secret key"
      }
    }
  },
  "paths": {
    "/github/repos": {
      "get": {
        "security": [{ "GitHubOAuth": [] }]
      }
    },
    "/slack/messages": {
      "post": {
        "security": [{ "SlackOAuth": [] }]
      }
    },
    "/stripe/customers": {
      "get": {
        "security": [{ "StripeAuth": [] }]
      }
    }
  }
}

// Adapter configuration
const adapter = new OpenapiAdapter({
  name: 'integration-platform',
  url: 'https://platform.example.com/openapi.json',
  baseUrl: 'https://platform.example.com',

  // Map each security scheme to the right auth provider
  authProviderMapper: {
    // GitHub tools use GitHub OAuth token
    'GitHubOAuth': (authInfo) => authInfo.user?.integrations?.github?.token,

    // Slack tools use Slack OAuth token
    'SlackOAuth': (authInfo) => authInfo.user?.integrations?.slack?.token,

    // Stripe tools use Stripe API key
    'StripeAuth': (authInfo) => authInfo.user?.integrations?.stripe?.apiKey,
  },
});
```

**Result:**

- `github_getRepos` tool → Uses GitHub token from `authInfo.user.integrations.github.token`
- `slack_postMessage` tool → Uses Slack token from `authInfo.user.integrations.slack.token`
- `stripe_getCustomers` tool → Uses Stripe key from `authInfo.user.integrations.stripe.apiKey`
- Each tool automatically gets the correct authentication!

## Input Schema Transforms

Hide inputs from the AI/users and inject values at request time. This is useful for tenant headers, correlation IDs, and
other server-side data that shouldn't be exposed to MCP clients.

### Basic Usage

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  inputTransforms: {
    // Global transforms applied to ALL tools
    global: [
      { inputKey: 'X-Tenant-Id', inject: (ctx) => ctx.authInfo.user?.tenantId },
      { inputKey: 'X-Correlation-Id', inject: () => crypto.randomUUID() },
    ],
  },
});
```

### Per-Tool Transforms

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  inputTransforms: {
    perTool: {
      createUser: [{ inputKey: 'createdBy', inject: (ctx) => ctx.authInfo.user?.email }],
      updateUser: [{ inputKey: 'modifiedBy', inject: (ctx) => ctx.authInfo.user?.email }],
    },
  },
});
```

### Dynamic Transforms with Generator

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  inputTransforms: {
    generator: (tool) => {
      // Add correlation ID to all mutating operations
      if (['post', 'put', 'patch', 'delete'].includes(tool.metadata.method)) {
        return [{ inputKey: 'X-Request-Id', inject: () => crypto.randomUUID() }];
      }
      return [];
    },
  },
});
```

### Transform Context

The `inject` function receives a context object with:

- `authInfo` - Authentication info from the MCP session
- `env` - Environment variables (`process.env`)
- `tool` - The OpenAPI tool being executed (access metadata, name, etc.)

## Tool Transforms

Customize generated tools with annotations, tags, descriptions, and more. Tool transforms can be applied globally,
per-tool, or dynamically using a generator function.

### Basic Usage

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  toolTransforms: {
    // Global transforms applied to ALL tools
    global: {
      annotations: { openWorldHint: true },
    },
  },
});
```

### Per-Tool Transforms

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  toolTransforms: {
    perTool: {
      createUser: {
        annotations: { destructiveHint: false },
        tags: ['user-management'],
      },
      deleteUser: {
        annotations: { destructiveHint: true },
        tags: ['user-management', 'dangerous'],
      },
    },
  },
});
```

### Dynamic Transforms with Generator

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  toolTransforms: {
    generator: (tool) => {
      // Auto-annotate based on HTTP method
      if (tool.metadata.method === 'get') {
        return { annotations: { readOnlyHint: true, destructiveHint: false } };
      }
      if (tool.metadata.method === 'delete') {
        return { annotations: { destructiveHint: true } };
      }
      return undefined;
    },
  },
});
```

### Available Transform Properties

| Property            | Type                 | Description                                  |
| ------------------- | -------------------- | -------------------------------------------- |
| `name`              | `string \| function` | Override or transform the tool name          |
| `description`       | `string \| function` | Override or transform the tool description   |
| `annotations`       | `ToolAnnotations`    | MCP tool behavior hints                      |
| `tags`              | `string[]`           | Categorization tags                          |
| `examples`          | `ToolExample[]`      | Usage examples                               |
| `hideFromDiscovery` | `boolean`            | Hide tool from listing (can still be called) |
| `ui`                | `ToolUIConfig`       | UI configuration for tool forms              |

### Tool Annotations

```typescript
annotations: {
  title: 'Human-readable title',
  readOnlyHint: true,      // Tool doesn't modify state
  destructiveHint: false,  // Tool doesn't delete data
  idempotentHint: true,    // Repeated calls have same effect
  openWorldHint: true,     // Tool interacts with external systems
}
```

## Output Transforms

Transform output schemas and response data before they're returned to MCP clients. Output transforms provide a final
transformation layer that runs after all other transforms (description mode, tool transforms, input transforms).

### Output Schema Description Mode

Add the output schema to tool descriptions automatically, making it easier for AI models to understand what the tool
returns:

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  dataTransforms: {
    outputSchemaDescriptionMode: 'summary', // or 'jsonSchema', 'compact', 'none'
  },
});
```

| Mode           | Description                                         | Example Output                                   |
| -------------- | --------------------------------------------------- | ------------------------------------------------ |
| `'none'`       | Don't add output schema to description (default)    | Original description only                        |
| `'jsonSchema'` | Append full JSON Schema as a code block             | `## Output Schema\n\`\`\`json\n{...}\n\`\`\``    |
| `'summary'`    | Append human-readable summary with property details | `## Returns\n- **id**: string (required)\n- ...` |
| `'compact'`    | Append compact one-line summary                     | `Returns: object { id, name, email }`            |

#### Custom Schema Formatter

Provide your own formatter for `'summary'` or `'compact'` modes:

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  dataTransforms: {
    outputSchemaDescriptionMode: 'summary',
    formatOutputSchema: (schema, mode) => {
      if (mode === 'summary') {
        return `This endpoint returns a ${schema.type} with ${Object.keys(schema.properties || {}).length} properties.`;
      }
      return `${schema.type}`;
    },
  },
});
```

### Pre-Tool Transforms

Transform the `McpOpenAPITool` definition before it's converted to a FrontMCP tool. Use this to modify the output
schema, description, or remove the output schema entirely.

#### Remove Output Schema and Add to Description

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  dataTransforms: {
    preToolTransforms: {
      global: {
        // Remove schema from tool definition
        transformSchema: () => undefined,
        // Add schema info to description instead
        transformDescription: (desc, schema) =>
          schema ? `${desc}\n\nReturns: ${JSON.stringify(schema, null, 2)}` : desc,
      },
    },
  },
});
```

#### Filter Internal Properties from Schema

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  dataTransforms: {
    preToolTransforms: {
      global: {
        transformSchema: (schema) => {
          if (!schema || schema.type !== 'object') return schema;
          // Remove internal properties starting with underscore
          const filteredProps = Object.fromEntries(
            Object.entries(schema.properties || {}).filter(([key]) => !key.startsWith('_')),
          );
          return { ...schema, properties: filteredProps };
        },
      },
    },
  },
});
```

#### Per-Tool Transforms

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  dataTransforms: {
    preToolTransforms: {
      perTool: {
        listUsers: {
          transformDescription: (desc) => `${desc}\n\nNote: Results are paginated.`,
        },
        getUser: {
          transformSchema: (schema) => ({
            ...schema,
            description: 'Single user object',
          }),
        },
      },
    },
  },
});
```

#### Dynamic Transforms with Generator

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  dataTransforms: {
    preToolTransforms: {
      generator: (tool) => {
        // Add method info to all tool descriptions
        return {
          transformDescription: (desc) => `[${tool.metadata.method.toUpperCase()}] ${desc}`,
        };
      },
    },
  },
});
```

### Post-Tool Transforms

Transform API response data at runtime, after the HTTP request completes but before returning to the MCP client.

#### Extract Nested Data

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  dataTransforms: {
    postToolTransforms: {
      perTool: {
        // Extract users array from paginated response
        listUsers: {
          transform: (data) => (data as { users: unknown[] })?.users ?? data,
        },
        // Extract single item from wrapper
        getUser: {
          transform: (data) => (data as { data: unknown })?.data ?? data,
        },
      },
    },
  },
});
```

#### Add Metadata to Responses

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  dataTransforms: {
    postToolTransforms: {
      global: {
        transform: (data, ctx) => ({
          data,
          _meta: {
            toolName: ctx.tool.name,
            timestamp: new Date().toISOString(),
            status: ctx.status,
          },
        }),
      },
    },
  },
});
```

#### Conditional Transforms with Filter

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  dataTransforms: {
    postToolTransforms: {
      generator: (tool) => {
        // Only transform successful GET requests
        if (tool.metadata.method === 'get') {
          return {
            filter: (ctx) => ctx.ok && ctx.status === 200,
            transform: (data) => ({ cached: false, data }),
          };
        }
        return undefined;
      },
    },
  },
});
```

### Transform Context

#### Pre-Tool Transform Context

```typescript
interface PreToolTransformContext {
  tool: McpOpenAPITool; // The OpenAPI tool being transformed
  adapterOptions: OpenApiAdapterOptions; // Adapter configuration
}
```

#### Post-Tool Transform Context

```typescript
interface PostToolTransformContext {
  ctx: FrontMcpContext; // FrontMCP request context (authInfo, sessionId, etc.)
  tool: McpOpenAPITool; // The OpenAPI tool that was executed
  status: number; // HTTP status code
  ok: boolean; // Whether response was successful (2xx)
  adapterOptions: OpenApiAdapterOptions; // Adapter configuration
}
```

### Transform Priority

Transforms are applied in this order:

1. **descriptionMode** - Basic description generation from OpenAPI summary/description
2. **toolTransforms** - Tool metadata modifications (annotations, tags, etc.)
3. **inputTransforms** - Input schema modifications (hide/inject fields)
4. **dataTransforms** - Output schema and response modifications
   - `outputSchemaDescriptionMode` (built-in) runs first
   - `preToolTransforms` run second (can override built-in)
   - `postToolTransforms` are stored and run at execution time

### Error Handling

Post-tool transforms include graceful error handling. If a transform fails:

- A warning is logged with the error details
- The original (untransformed) data is returned
- The tool call does not fail

```typescript
// If transform throws, original data is returned
postToolTransforms: {
  global: {
    transform: (data) => {
      throw new Error('Transform failed');
      // Warning logged, original data returned
    },
  },
}
```

## Description Mode

Control how tool descriptions are generated from OpenAPI operations:

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  descriptionMode: 'combined', // Default: 'summaryOnly'
});
```

| Mode                | Description                                 |
| ------------------- | ------------------------------------------- |
| `'summaryOnly'`     | Use only the OpenAPI summary (default)      |
| `'descriptionOnly'` | Use only the OpenAPI description            |
| `'combined'`        | Summary followed by description             |
| `'full'`            | Summary, description, and operation details |

## x-frontmcp OpenAPI Extension

Configure tool behavior directly in your OpenAPI spec using the `x-frontmcp` extension. This allows API designers to
embed FrontMCP-specific configuration in the spec itself.

### Basic Example

```yaml
paths:
  /users:
    get:
      operationId: listUsers
      summary: List all users
      x-frontmcp:
        annotations:
          readOnlyHint: true
          idempotentHint: true
        cache:
          ttl: 300
        tags:
          - users
          - public-api
```

### Full Extension Schema

```yaml
x-frontmcp:
  # Tool annotations (AI behavior hints)
  annotations:
    title: 'Human-readable title'
    readOnlyHint: true
    destructiveHint: false
    idempotentHint: true
    openWorldHint: true

  # Cache configuration
  cache:
    ttl: 300 # Time-to-live in seconds
    slideWindow: true # Slide cache window on access

  # CodeCall plugin configuration
  codecall:
    enabledInCodeCall: true # Allow use via CodeCall
    visibleInListTools: true # Show in list_tools when CodeCall active

  # Categorization
  tags:
    - users
    - public-api

  # Hide from tool listing (can still be called directly)
  hideFromDiscovery: false

  # Usage examples
  examples:
    - description: Get all users
      input: {}
      output: { users: [], total: 0 }
```

### Extension Properties

| Property            | Type       | Description                                         |
| ------------------- | ---------- | --------------------------------------------------- |
| `annotations`       | `object`   | Tool behavior hints (readOnlyHint, etc.)            |
| `cache`             | `object`   | Cache config: `ttl` (seconds), `slideWindow`        |
| `codecall`          | `object`   | CodeCall: `enabledInCodeCall`, `visibleInListTools` |
| `tags`              | `string[]` | Categorization tags                                 |
| `hideFromDiscovery` | `boolean`  | Hide from tool listing                              |
| `examples`          | `array`    | Usage examples with input/output                    |

### Priority: Spec vs Adapter

When both `x-frontmcp` (in the OpenAPI spec) and `toolTransforms` (in adapter config) are used:

1. `x-frontmcp` in OpenAPI spec is applied first (base layer)
2. `toolTransforms` in adapter config overrides/extends spec values

This allows API designers to set defaults in the spec, while adapter consumers can override as needed.

### Complete Example

```yaml
openapi: '3.0.0'
info:
  title: User Management API
  version: '1.0.0'
paths:
  /users:
    get:
      operationId: listUsers
      summary: List all users
      description: Returns a paginated list of users with optional filtering
      x-frontmcp:
        annotations:
          title: List Users
          readOnlyHint: true
          idempotentHint: true
        cache:
          ttl: 60
        tags:
          - users
          - public-api
        examples:
          - description: List all users
            input: { limit: 10 }
            output: { users: [{ id: '1', name: 'John' }], total: 1 }
    post:
      operationId: createUser
      summary: Create a new user
      x-frontmcp:
        annotations:
          destructiveHint: false
          idempotentHint: false
        tags:
          - users
          - admin
    delete:
      operationId: deleteUser
      summary: Delete a user
      x-frontmcp:
        annotations:
          destructiveHint: true
        tags:
          - users
          - admin
          - dangerous
```

## Logger Integration

The adapter uses logging for diagnostics and security analysis. The logger is handled automatically:

### Within FrontMCP Apps (Recommended)

When using the adapter within a FrontMCP app, the SDK automatically injects the logger before `fetch()` is called:

```typescript
import { App } from '@frontmcp/sdk';
import { OpenapiAdapter } from '@frontmcp/adapters';

@App({
  id: 'my-api',
  adapters: [
    OpenapiAdapter.init({
      name: 'my-api',
      baseUrl: 'https://api.example.com',
      spec: mySpec,
      // logger is automatically injected by the SDK
    }),
  ],
})
export default class MyApiApp {}
```

### Standalone Usage

For standalone usage (outside FrontMCP apps), the adapter automatically creates a console-based logger:

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  // Console logger is created automatically: [openapi:my-api] INFO: ...
});
```

### Custom Logger

You can provide a custom logger that implements `FrontMcpLogger`:

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  baseUrl: 'https://api.example.com',
  spec: mySpec,
  logger: myCustomLogger, // Optional - uses console fallback if not provided
});
```

## How It Works

### 1. Spec Loading & Validation

```typescript
// Loads and validates OpenAPI spec
const generator = await OpenAPIToolGenerator.fromURL(url, {
  dereference: true, // Resolves all $refs for flat schemas
  validate: true, // Validates against OpenAPI spec
});
```

### 2. Tool Generation

Each OpenAPI operation becomes a FrontMCP tool with full type safety:

```yaml
# OpenAPI Operation
paths:
  /users/{id}:
    get:
      operationId: getUser
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
```

```typescript
// Becomes FrontMCP Tool
{
  name: 'getUser',
  description: 'Get user by ID',
  parameters: z.object({ id: z.string() }), // Auto-generated Zod schema
  execute: async (args, ctx) => {
    // Automatic request building with auth
  }
}
```

### 3. Request Building

The adapter automatically builds requests using the parameter mapper:

- **Path parameters** → URL path (`/users/{id}` → `/users/123`)
- **Query parameters** → Query string (`?page=1&limit=10`)
- **Header parameters** → HTTP headers
- **Body parameters** → Request body (JSON)
- **Security** → Authentication headers (resolved from context)

### 4. Authentication Resolution

Security is resolved automatically using the `SecurityResolver`. Tokens are routed to the correct context field based on the security scheme type:

| Scheme Type    | Context Field         |
| -------------- | --------------------- |
| `http: bearer` | `context.jwt`         |
| `apiKey`       | `context.apiKey`      |
| `http: basic`  | `context.basic`       |
| `oauth2`       | `context.oauth2Token` |

```typescript
// 1. Extract security from OpenAPI spec
const security = await securityResolver.resolve(tool.mapper, {
  jwt: ctx.authInfo.token, // From FrontMCP context
});

// 2. Apply to request
fetch(url, {
  headers: {
    ...security.headers, // Authorization: Bearer xxx
    ...customHeaders,
  },
});
```

## Security Protections

The adapter includes defense-in-depth security protections:

| Protection            | Description                                                                           |
| --------------------- | ------------------------------------------------------------------------------------- |
| SSRF Prevention       | Validates server URLs, blocks dangerous protocols (`file://`, `javascript:`, `data:`) |
| Header Injection      | Rejects control characters (`\r`, `\n`, `\x00`, `\f`, `\v`) in header values          |
| Prototype Pollution   | Blocks reserved JS keys (`__proto__`, `constructor`, `prototype`) in input transforms |
| Request Size Limits   | Content-Length validation with integer overflow protection (`isFinite()` check)       |
| Query Param Collision | Detects conflicts between security and user input parameters                          |

See [`openapi.executor.ts`](./openapi.executor.ts) for implementation details.

## Supported Authentication Types

| Type             | OpenAPI          | Auto-Resolved From   |
| ---------------- | ---------------- | -------------------- |
| Bearer Token     | `http: bearer`   | `ctx.authInfo.token` |
| Basic Auth       | `http: basic`    | Custom resolver      |
| Digest Auth      | `http: digest`   | Custom resolver      |
| API Key (Header) | `apiKey: header` | `additionalHeaders`  |
| API Key (Query)  | `apiKey: query`  | `additionalHeaders`  |
| OAuth2           | `oauth2`         | `ctx.authInfo.token` |
| OpenID Connect   | `openIdConnect`  | `ctx.authInfo.token` |
| mTLS             | `mutualTLS`      | Custom resolver      |
| HMAC Signature   | Custom           | Custom resolver      |
| AWS Signature V4 | Custom           | Custom resolver      |
| Custom Headers   | `apiKey`         | `additionalHeaders`  |
| Cookies          | Context          | Custom resolver      |

See the [mcp-from-openapi documentation](https://github.com/agentfront/mcp-from-openapi) for detailed authentication examples.

## Security Validation

The adapter automatically validates your security configuration on startup and provides helpful error messages if
authentication is not properly configured.

### Automatic Validation

When the adapter loads, it:

1. **Extracts all security schemes** from your OpenAPI spec
2. **Validates your auth configuration** matches the security requirements
3. **Calculates a security risk score** (low/medium/high)
4. **Fails early** with clear errors if auth mapping is missing

### Security Risk Scores

| Score         | Configuration                                      | Description                                   |
| ------------- | -------------------------------------------------- | --------------------------------------------- |
| **LOW** ✅    | `authProviderMapper` or `securityResolver`         | Auth from context - Production ready          |
| **MEDIUM** ⚠️ | `securitySchemesInInput` with `authProviderMapper` | Hybrid: some user-provided, some from context |
| **MEDIUM** ⚠️ | `staticAuth` or default                            | Static credentials - Secure but less flexible |
| **HIGH** ❌   | `includeSecurityInInput: true`                     | User provides auth - High security risk       |

### Example: Missing Auth Configuration

If you have an OpenAPI spec with security schemes but no auth configuration:

```typescript
// OpenAPI spec has security schemes
{
  "components": {
    "securitySchemes": {
      "GitHubAuth": { "type": "http", "scheme": "bearer" },
      "SlackAuth": { "type": "http", "scheme": "bearer" }
    }
  }
}

// ❌ This will FAIL on startup
const adapter = new OpenapiAdapter({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',
  // No auth configuration provided!
});
```

**Error message you'll see:**

```
[OpenAPI Adapter: my-api] Invalid security configuration.
Missing auth provider mappings for security schemes: GitHubAuth, SlackAuth

Your OpenAPI spec requires these security schemes, but no auth configuration was provided.

Add one of the following to your adapter configuration:

1. authProviderMapper (recommended):
   authProviderMapper: {
     'GitHubAuth': (authInfo) => authInfo.user?.githubauthToken,
     'SlackAuth': (authInfo) => authInfo.user?.slackauthToken,
   }

2. securityResolver:
   securityResolver: (tool, authInfo) => ({ jwt: authInfo.token })

3. staticAuth:
   staticAuth: { jwt: process.env.API_TOKEN }

4. Include security in input (NOT recommended for production):
   generateOptions: { includeSecurityInInput: true }
```

### Example: Valid Configuration

```typescript
// ✅ This will SUCCEED with security risk score: LOW
const adapter = new OpenapiAdapter({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',

  authProviderMapper: {
    GitHubAuth: (authInfo) => authInfo.user?.githubToken,
    SlackAuth: (authInfo) => authInfo.user?.slackToken,
  },
});
```

**Console output:**

```
[OpenAPI Adapter: my-api] Security Analysis:
  Security Risk Score: LOW
  Valid Configuration: YES

  Messages:
    - INFO: Using authProviderMapper for auth resolution.
```

### Runtime Validation

Each tool execution also validates authentication:

```typescript
// If a tool requires GitHubAuth but no token is available
await tool.execute(
  {
    /* ... */
  },
  ctx,
);

// Error:
// Authentication required for tool 'github_getRepos' but no auth configuration found.
// Required security schemes: GitHubAuth
```

### Bypassing Validation (Not Recommended)

For testing or internal tools only:

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',

  generateOptions: {
    // ⚠️ HIGH SECURITY RISK: Users provide auth directly
    includeSecurityInInput: true,
  },
});

// Console output:
// [OpenAPI Adapter: my-api] Security Analysis:
//   Security Risk Score: HIGH
//   Valid Configuration: YES
//
//   Messages:
//     - SECURITY WARNING: includeSecurityInInput is enabled. Users will provide
//       authentication directly in tool inputs. This increases security risk as
//       credentials may be logged or exposed.
```

## Best Practices

### 1. Use Environment Variables

```typescript
const adapter = new OpenapiAdapter({
  name: 'my-api',
  url: process.env.OPENAPI_URL,
  baseUrl: process.env.API_BASE_URL,
  additionalHeaders: {
    'X-API-Key': process.env.API_KEY,
  },
});
```

### 2. Filter Endpoints

```typescript
generateOptions: {
  filterFn: (operation) => {
    return (
      operation.tags?.includes('public') &&
      !operation.deprecated
    );
  },
}
```

### 3. Handle Multi-Tenant

```typescript
headersMapper: (authInfo, headers) => {
  const tenantId = authInfo.user?.organizationId;
  if (!tenantId) {
    throw new Error('Tenant ID required');
  }
  headers.set('X-Tenant-ID', tenantId);
  return headers;
},
```

## Troubleshooting

### Tools not generated

- Check that your OpenAPI spec is valid (`validate: true`)
- Verify `filterFn` isn't excluding all operations
- Check console for validation errors

### Authentication not working

- Ensure security is defined in OpenAPI spec
- Verify `ctx.authInfo.token` is available
- Add `additionalHeaders` if needed
- Check auth type routing matches your scheme (Bearer → `jwt`, API Key → `apiKey`)

### Type errors

- Ensure `dereference: true` to resolve `$ref` objects
- Check that JSON schemas are valid

### Empty string token error

- `authProviderMapper` returned empty string instead of `undefined`
- Return `undefined` or `null` when no token is available

### Header injection error

- Header values contain control characters (`\r`, `\n`, `\x00`)
- Sanitize dynamic header values before passing to the adapter

### Invalid base URL error

- Server URL from OpenAPI spec failed SSRF validation
- Only `http://` and `https://` protocols are allowed

## Links

- [mcp-from-openapi](https://github.com/agentfront/mcp-from-openapi) - Core OpenAPI to MCP converter (external package)
- [FrontMCP SDK](https://www.npmjs.com/package/@frontmcp/sdk) - FrontMCP core SDK

## License

MIT
