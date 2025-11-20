# Security Handling Guide

This guide explains how to handle authentication when building tools from OpenAPI specifications.

## The Challenge

Different OpenAPI specs use different custom names for their security schemes:

```yaml
# API 1 might call it "BearerAuth"
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

# API 2 might call it "JWT"
components:
  securitySchemes:
    JWT:
      type: http
      scheme: bearer

# API 3 might call it "Authorization"
components:
  securitySchemes:
    Authorization:
      type: http
      scheme: bearer
```

**All three specs mean the same thing**: add a Bearer token to the `Authorization` header. But they use different custom names.

## The Solution: Use the Mapper, Not the Name

The `ParameterMapper` contains all the information needed to apply authentication correctly, regardless of custom naming:

```typescript
{
  inputKey: "BearerAuth",  // ← Custom name (varies by API)
  type: "header",           // ← Where to put it
  key: "Authorization",     // ← Actual HTTP header name
  required: true,
  security: {               // ← This tells you everything!
    scheme: "BearerAuth",
    type: "http",
    httpScheme: "bearer",
    bearerFormat: "JWT"
  }
}
```

**Key insight**: Use `mapper.security` metadata to determine the auth type, then use `mapper.key` to place it in the correct header/query/cookie.

## Using the SecurityResolver

The `SecurityResolver` class handles all security resolution for you:

### Basic Usage

```typescript
import { SecurityResolver } from 'mcp-from-openapi';

// Create resolver
const resolver = new SecurityResolver();

// Resolve security from your context
const resolved = resolver.resolve(tool.mapper, {
  jwt: context.authInfo.jwt,
  apiKey: process.env.API_KEY,
});

// Use in HTTP request
const response = await fetch(url, {
  headers: {
    ...resolved.headers,
    'Content-Type': 'application/json',
  },
});
```

### Example: FrontMCP Integration

```typescript
import { SecurityResolver, createSecurityContext } from 'mcp-from-openapi';

// In your tool executor
async function executeTool(tool, input, context) {
  const resolver = new SecurityResolver();

  // Map FrontMCP context to security context
  const securityContext = createSecurityContext({
    jwt: context.authInfo.jwt,
    apiKey: context.authInfo.apiKey,
  });

  // Resolve all security parameters
  const security = resolver.resolve(tool.mapper, securityContext);

  // Check if any required auth is missing
  const missing = resolver.checkMissingSecurity(tool.mapper, securityContext);
  if (missing.length > 0) {
    throw new Error(`Missing authentication: ${missing.join(', ')}`);
  }

  // Build request with resolved security
  const response = await fetch(buildUrl(tool, input), {
    method: tool.metadata.method,
    headers: {
      ...security.headers,
      'Content-Type': 'application/json',
    },
    body: buildBody(tool, input),
  });

  return response.json();
}
```

### Custom Resolver for Framework-Specific Auth

If your framework has custom auth logic, use a custom resolver:

```typescript
const resolved = resolver.resolve(tool.mapper, {
  customResolver: (security) => {
    // Custom logic based on security type
    if (security.type === 'http' && security.httpScheme === 'bearer') {
      return myFramework.getAuthToken(security.scheme);
    }

    if (security.type === 'apiKey') {
      return myFramework.getApiKey(security.apiKeyName);
    }

    return undefined; // Fall back to standard resolution
  }
});
```

## Supported Authentication Types

### 1. Bearer Tokens (JWT)

**OpenAPI Spec:**
```yaml
securitySchemes:
  BearerAuth:
    type: http
    scheme: bearer
    bearerFormat: JWT
```

**Usage:**
```typescript
resolver.resolve(tool.mapper, {
  jwt: 'eyJhbGciOiJIUzI1NiIs...'
});
// → Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### 2. Basic Authentication

**OpenAPI Spec:**
```yaml
securitySchemes:
  BasicAuth:
    type: http
    scheme: basic
```

**Usage:**
```typescript
resolver.resolve(tool.mapper, {
  basic: btoa('username:password')  // base64 encoded
});
// → Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQ=
```

### 3. API Key in Header

**OpenAPI Spec:**
```yaml
securitySchemes:
  ApiKeyAuth:
    type: apiKey
    in: header
    name: X-API-Key
```

**Usage:**
```typescript
resolver.resolve(tool.mapper, {
  apiKey: 'sk-1234567890'
});
// → X-API-Key: sk-1234567890
```

### 4. API Key in Query

**OpenAPI Spec:**
```yaml
securitySchemes:
  ApiKeyAuth:
    type: apiKey
    in: query
    name: api_key
```

**Usage:**
```typescript
const resolved = resolver.resolve(tool.mapper, {
  apiKey: 'sk-1234567890'
});
// Add to URL: ?api_key=sk-1234567890
const url = `${baseUrl}?${new URLSearchParams(resolved.query)}`;
```

### 5. OAuth2 / OpenID Connect

**OpenAPI Spec:**
```yaml
securitySchemes:
  OAuth2:
    type: oauth2
    flows:
      authorizationCode:
        authorizationUrl: https://example.com/oauth/authorize
        tokenUrl: https://example.com/oauth/token
        scopes:
          read: Read access
          write: Write access
```

**Usage:**
```typescript
resolver.resolve(tool.mapper, {
  oauth2Token: 'ya29.a0AfH6SMBx...'
});
// → Authorization: Bearer ya29.a0AfH6SMBx...
```

## Working with Multiple Security Schemes

Some APIs allow multiple authentication methods. The resolver handles all of them:

```typescript
// API might accept both API key and Bearer token
const resolved = resolver.resolve(tool.mapper, {
  jwt: context.authInfo.jwt,
  apiKey: context.authInfo.apiKey,
});

// Only the required schemes for this operation will be used
```

## Input Schema Options

By default, security parameters are **only in the mapper** (not in inputSchema). This allows frameworks to resolve auth from context automatically.

### Option 1: Security from Context (Default)

```typescript
// Generate tools without security in input
const tools = await generator.generateTools({
  includeSecurityInInput: false, // default
});

// Security is in mapper, not inputSchema
// Framework resolves from context
const resolved = resolver.resolve(tool.mapper, context);
```

### Option 2: Security as Explicit Parameters

```typescript
// Generate tools with security in input
const tools = await generator.generateTools({
  includeSecurityInInput: true,
});

// Security is in BOTH mapper AND inputSchema
// Caller must provide auth explicitly
await executeTool({
  BearerAuth: 'my-token',  // ← Explicit parameter
  userId: 123
});
```

## Best Practices

### 1. Always Use the SecurityResolver

Don't try to manually parse security from mappers. The resolver handles all edge cases:

```typescript
// ✅ Good
const resolved = resolver.resolve(tool.mapper, context);

// ❌ Bad - manual parsing is error-prone
for (const mapper of tool.mapper) {
  if (mapper.security?.type === 'http') {
    headers['Authorization'] = `Bearer ${token}`;
  }
}
```

### 2. Check for Missing Auth

Validate that all required auth is available:

```typescript
const missing = resolver.checkMissingSecurity(tool.mapper, context);
if (missing.length > 0) {
  throw new Error(`Missing auth: ${missing.join(', ')}`);
}
```

### 3. Separate Auth from Regular Parameters

Security parameters are separate from regular input parameters:

```typescript
// Resolve security from context
const security = resolver.resolve(tool.mapper, context);

// Process regular parameters from input
const params = processParameters(tool.mapper, input);

// Combine for final request
fetch(url, {
  headers: { ...security.headers, ...params.headers }
});
```

### 4. Support Environment Variables

Allow auth to come from environment variables:

```typescript
const context = createSecurityContext({
  jwt: process.env.JWT_TOKEN || userProvidedToken,
  apiKey: process.env.API_KEY || userProvidedKey,
});
```

## Complete Example

Here's a complete example of building an HTTP request with authentication:

```typescript
import { SecurityResolver, createSecurityContext } from 'mcp-from-openapi';

async function executeOpenAPITool(tool, input, context) {
  const resolver = new SecurityResolver();

  // 1. Resolve security
  const securityContext = createSecurityContext({
    jwt: context.authInfo.jwt || process.env.JWT_TOKEN,
    apiKey: context.authInfo.apiKey || process.env.API_KEY,
    oauth2Token: context.authInfo.oauth2Token,
  });

  const security = resolver.resolve(tool.mapper, securityContext);

  // 2. Validate auth is available
  const missing = resolver.checkMissingSecurity(tool.mapper, securityContext);
  if (missing.length > 0) {
    throw new Error(
      `Missing authentication for ${tool.name}: ${missing.join(', ')}\n` +
      `Please provide credentials via context or environment variables.`
    );
  }

  // 3. Build request
  const baseUrl = tool.metadata.servers?.[0]?.url || 'https://api.example.com';
  const path = buildPath(tool.metadata.path, input);
  const queryParams = { ...security.query, ...buildQuery(tool.mapper, input) };
  const url = `${baseUrl}${path}?${new URLSearchParams(queryParams)}`;

  // 4. Execute request
  const response = await fetch(url, {
    method: tool.metadata.method.toUpperCase(),
    headers: {
      ...security.headers,
      'Content-Type': 'application/json',
      ...buildHeaders(tool.mapper, input),
    },
    body: buildBody(tool.mapper, input),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Authentication failed for ${tool.name}`);
    }
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
```

## API Reference

### SecurityResolver

#### `resolve(mappers, context): ResolvedSecurity`

Resolves security parameters from mappers using the provided context.

**Parameters:**
- `mappers: ParameterMapper[]` - Parameter mappers from tool definition
- `context: SecurityContext` - Security context with auth values

**Returns:** `ResolvedSecurity` with headers, query params, and cookies

#### `checkMissingSecurity(mappers, context): string[]`

Checks which security requirements are missing from the context.

**Returns:** Array of missing security scheme names

### Types

#### `SecurityContext`

```typescript
interface SecurityContext {
  jwt?: string;
  basic?: string;
  apiKey?: string;
  oauth2Token?: string;
  customResolver?: (security: SecurityParameterInfo) => string | undefined;
}
```

#### `ResolvedSecurity`

```typescript
interface ResolvedSecurity {
  headers: Record<string, string>;
  query: Record<string, string>;
  cookies: Record<string, string>;
}
```

#### `SecurityParameterInfo`

```typescript
interface SecurityParameterInfo {
  scheme: string;
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
  httpScheme?: string;
  bearerFormat?: string;
  scopes?: string[];
  apiKeyName?: string;
  apiKeyIn?: 'query' | 'header' | 'cookie';
  description?: string;
}
```

## Troubleshooting

### "Missing authentication" error

**Problem:** SecurityResolver reports missing auth.

**Solution:** Check that you're providing the correct auth type:
```typescript
// Check what auth is required
tool.mapper.forEach(m => {
  if (m.security) {
    console.log('Required:', m.security.type, m.security.httpScheme || m.security.scheme);
  }
});
```

### Auth not being applied

**Problem:** Requests don't include authentication headers.

**Solution:** Make sure you're using the resolved security:
```typescript
const security = resolver.resolve(tool.mapper, context);
// Must use security.headers in the request!
fetch(url, { headers: security.headers });
```

### Custom security scheme not working

**Problem:** Your API uses a non-standard auth method.

**Solution:** Use a custom resolver:
```typescript
const security = resolver.resolve(tool.mapper, {
  customResolver: (sec) => {
    return myCustomAuthLogic(sec);
  }
});
```

## Advanced Security Types

### 6. Digest Authentication

**OpenAPI Spec:**
```yaml
securitySchemes:
  DigestAuth:
    type: http
    scheme: digest
```

**Usage:**
```typescript
const resolved = await resolver.resolve(tool.mapper, {
  digest: {
    username: 'user',
    password: 'pass',
    realm: 'api@example.com',
    nonce: '...',
    uri: '/api/resource',
    response: '...' // computed digest response
  }
});
// → Authorization: Digest username="user", realm="api@example.com", nonce="...", ...
```

### 7. Client Certificate Authentication (mTLS)

**OpenAPI Spec:**
```yaml
securitySchemes:
  MutualTLS:
    type: mutualTLS
    description: Mutual TLS authentication
```

**Usage:**
```typescript
const resolved = await resolver.resolve(tool.mapper, {
  clientCertificate: {
    cert: fs.readFileSync('client-cert.pem', 'utf8'),
    key: fs.readFileSync('client-key.pem', 'utf8'),
    passphrase: 'optional-passphrase',
    ca: fs.readFileSync('ca-cert.pem', 'utf8')
  }
});

// Use in fetch with certificate
fetch(url, {
  headers: resolved.headers,
  // In Node.js with https module:
  cert: resolved.clientCertificate.cert,
  key: resolved.clientCertificate.key,
  ca: resolved.clientCertificate.ca
});
```

### 8. Multiple API Keys

Some APIs require multiple keys for different purposes:

**OpenAPI Spec:**
```yaml
securitySchemes:
  APIKey:
    type: apiKey
    in: header
    name: X-API-Key
  ClientID:
    type: apiKey
    in: header
    name: X-Client-ID
```

**Usage:**
```typescript
const resolved = await resolver.resolve(tool.mapper, {
  apiKeys: {
    'X-API-Key': 'sk-1234567890',
    'X-Client-ID': 'client-abc123'
  }
});
// → X-API-Key: sk-1234567890
// → X-Client-ID: client-abc123
```

### 9. Custom Headers (Proprietary Auth)

**OpenAPI Spec:**
```yaml
securitySchemes:
  CustomAuth:
    type: apiKey
    in: header
    name: X-Custom-Auth
```

**Usage:**
```typescript
const resolved = await resolver.resolve(tool.mapper, {
  customHeaders: {
    'X-Custom-Auth': 'custom-token-format',
    'X-Request-ID': 'uuid-123'
  }
});
```

### 10. Signature-Based Authentication (HMAC, AWS Signature V4)

**OpenAPI Spec:**
```yaml
securitySchemes:
  AWS4-HMAC-SHA256:
    type: apiKey
    in: header
    name: Authorization
    description: AWS Signature Version 4
```

**Usage:**
```typescript
const resolver = new SecurityResolver();

// 1. Resolve security (will indicate signature is required)
const resolved = await resolver.resolve(tool.mapper, {
  awsCredentials: {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    service: 's3'
  },
  signatureGenerator: async (data, security) => {
    // Implement AWS Signature V4 or HMAC signing
    const signature = awsSign(data, awsCredentials);
    return `AWS4-HMAC-SHA256 Credential=..., SignedHeaders=..., Signature=${signature}`;
  }
});

// 2. Check if signing is required
if (resolved.requiresSignature) {
  // 3. Sign the request
  const signedHeaders = await resolver.signRequest(
    tool.mapper,
    {
      method: 'GET',
      url: 'https://s3.amazonaws.com/bucket/key',
      headers: resolved.headers,
      body: requestBody,
      timestamp: Date.now()
    },
    securityContext
  );
  
  // 4. Use signed headers
  fetch(url, { headers: signedHeaders });
}
```

### 11. HMAC Signature Example

```typescript
import crypto from 'crypto';

const resolved = await resolver.resolve(tool.mapper, {
  hmacSecret: 'your-secret-key',
  signatureGenerator: async (data, security) => {
    // Create HMAC signature
    const stringToSign = `${data.method}\n${data.url}\n${data.timestamp}`;
    const signature = crypto
      .createHmac('sha256', hmacSecret)
      .update(stringToSign)
      .digest('base64');
    
    return `HMAC-SHA256 ${signature}`;
  }
});
```

### 12. Session Cookies

**Usage:**
```typescript
const resolved = await resolver.resolve(tool.mapper, {
  cookies: {
    'session_id': 'sess_abc123',
    'csrf_token': 'csrf_xyz789'
  }
});

// Cookies are automatically included in resolved.cookies
fetch(url, {
  headers: {
    ...resolved.headers,
    'Cookie': Object.entries(resolved.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }
});
```

## Advanced Patterns

### Custom Resolver for Complex Auth

```typescript
const resolved = await resolver.resolve(tool.mapper, {
  customResolver: async (security) => {
    // Route to different auth methods based on scheme
    if (security.scheme === 'AWS4-HMAC-SHA256') {
      return await generateAWSSignature();
    }
    
    if (security.scheme === 'Custom-HMAC') {
      return await generateHMACSignature(security);
    }
    
    if (security.scheme.startsWith('OAuth2-')) {
      const token = await refreshOAuth2Token(security.scopes);
      return `Bearer ${token}`;
    }
    
    // Fall back to standard resolution
    return undefined;
  }
});
```

### Framework-Specific Integration

```typescript
// FrontMCP with multiple auth types
class FrontMCPSecurityContext {
  constructor(private context: FrontMcpContext) {}
  
  async resolve(tool: McpOpenAPITool): Promise<ResolvedSecurity> {
    const resolver = new SecurityResolver();
    
    return resolver.resolve(tool.mapper, {
      // Standard auth
      jwt: this.context.authInfo.jwt,
      apiKey: this.context.authInfo.apiKey,
      
      // Multiple keys
      apiKeys: this.context.authInfo.apiKeys || {},
      
      // Cookies
      cookies: this.context.authInfo.cookies || {},
      
      // mTLS
      clientCertificate: this.context.authInfo.clientCertificate,
      
      // Custom resolver for framework-specific logic
      customResolver: async (security) => {
        // Check framework-specific auth providers
        const provider = this.context.authProviders.get(security.scheme);
        if (provider) {
          return await provider.getToken(security);
        }
        return undefined;
      },
      
      // Signature generator
      signatureGenerator: async (data, security) => {
        const signer = this.context.signatureProviders.get(security.scheme);
        if (signer) {
          return await signer.sign(data, security);
        }
        throw new Error(`No signature provider for ${security.scheme}`);
      }
    });
  }
}
```

## Security Type Summary

| Type | OpenAPI | Usage | Example |
|------|---------|-------|---------|
| Bearer Token | `http: bearer` | JWT, access tokens | `Authorization: Bearer eyJ...` |
| Basic Auth | `http: basic` | Username:password | `Authorization: Basic dXNlcjpwYXNz` |
| Digest Auth | `http: digest` | Challenge-response | `Authorization: Digest username="..."` |
| API Key (Header) | `apiKey: header` | Simple keys | `X-API-Key: sk-123` |
| API Key (Query) | `apiKey: query` | URL parameters | `?api_key=sk-123` |
| OAuth2 | `oauth2` | OAuth 2.0 flows | `Authorization: Bearer ya29...` |
| OpenID Connect | `openIdConnect` | OIDC tokens | `Authorization: Bearer eyJ...` |
| mTLS | `mutualTLS` | Client certificates | TLS handshake |
| HMAC | Custom `apiKey` | Signed requests | `Authorization: HMAC-SHA256 ...` |
| AWS Signature V4 | Custom `apiKey` | AWS API requests | `Authorization: AWS4-HMAC-SHA256 ...` |
| Custom Headers | `apiKey` | Proprietary | `X-Custom-Auth: value` |
| Cookies | Context | Session management | `Cookie: session_id=...` |

All security types are handled automatically by the SecurityResolver based on the OpenAPI specification metadata!
