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

✅ **Production Ready** - Comprehensive error handling and validation

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
  spec: spec,
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

### Auth Resolution Priority

The adapter resolves authentication in this order:

1. **Custom `securityResolver`** (highest priority) - Full control per tool
2. **`authProviderMapper`** - Map security schemes to auth providers
3. **`staticAuth`** - Static credentials
4. **Default** - Uses `ctx.authInfo.token` (lowest priority)

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

Security is resolved automatically using the `SecurityResolver`:

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

See [SECURITY.md](../../../../mcp-from-openapi/SECURITY.md) for detailed authentication examples.

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

| Score         | Configuration                              | Description                                   |
| ------------- | ------------------------------------------ | --------------------------------------------- |
| **LOW** ✅    | `authProviderMapper` or `securityResolver` | Auth from context - Production ready          |
| **MEDIUM** ⚠️ | `staticAuth` or default                    | Static credentials - Secure but less flexible |
| **HIGH** ❌   | `includeSecurityInInput: true`             | User provides auth - High security risk       |

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

### Type errors

- Ensure `dereference: true` to resolve `$ref` objects
- Check that JSON schemas are valid

## Links

- [mcp-from-openapi](https://github.com/frontmcp/mcp-from-openapi) - Core OpenAPI to MCP converter
- [Security Guide](../../../../mcp-from-openapi/SECURITY.md) - Comprehensive authentication guide
- [FrontMCP SDK](../../../../sdk) - FrontMCP core SDK

## License

MIT
