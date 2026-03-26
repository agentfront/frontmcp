---
name: configure-http
description: Configure HTTP server options including port, CORS, unix sockets, and entry path. Use when customizing the HTTP listener, enabling CORS, or binding to a unix socket.
tags: [http, cors, port, socket, server, configuration]
parameters:
  - name: port
    description: HTTP server port
    type: number
    default: 3001
examples:
  - scenario: Configure CORS for a specific frontend origin
    expected-outcome: Server accepts requests only from the allowed origin
  - scenario: Bind to a unix socket for local-only access
    expected-outcome: Server listens on unix socket instead of TCP port
priority: 7
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/deployment/local-dev-server
---

# Configuring HTTP Options

Configure the HTTP server — port, CORS policy, unix sockets, and entry path prefix.

## When to Use

Configure HTTP options when:

- Changing the default port (3001)
- Enabling CORS for a frontend application
- Mounting the MCP server under a URL prefix
- Binding to a unix socket for local daemon mode

## HttpOptionsInput

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  http: {
    port: 3001, // default: 3001
    entryPath: '', // default: '' (root)
    socketPath: undefined, // unix socket path (overrides port)
    cors: {
      // default: permissive (all origins)
      origin: ['https://myapp.com'],
      credentials: true,
      maxAge: 86400,
    },
  },
})
class Server {}
```

## Port Configuration

```typescript
// Default: port 3001
http: {
  port: 3001;
}

// Use environment variable
http: {
  port: Number(process.env.PORT) || 3001;
}

// Random port (useful for testing)
http: {
  port: 0;
}
```

## CORS Configuration

### Permissive (Default)

When `cors` is not specified, the server allows all origins without credentials:

```typescript
// All origins allowed (default behavior)
http: {
}
```

### Restrict to Specific Origins

```typescript
http: {
  cors: {
    origin: ['https://myapp.com', 'https://staging.myapp.com'],
    credentials: true,
    maxAge: 86400,  // Cache preflight for 24 hours
  },
}
```

### Disable CORS Entirely

```typescript
http: {
  cors: false,  // No CORS headers at all
}
```

### Dynamic Origin

```typescript
http: {
  cors: {
    origin: (origin: string) => {
      // Allow any *.myapp.com subdomain
      return origin.endsWith('.myapp.com');
    },
    credentials: true,
  },
}
```

### CORS Fields

| Field         | Type                                        | Default      | Description                        |
| ------------- | ------------------------------------------- | ------------ | ---------------------------------- |
| `origin`      | `boolean \| string \| string[] \| function` | `true` (all) | Allowed origins                    |
| `credentials` | `boolean`                                   | `false`      | Allow cookies/auth headers         |
| `maxAge`      | `number`                                    | —            | Preflight cache duration (seconds) |

## Entry Path Prefix

Mount the MCP server under a URL prefix:

```typescript
http: {
  entryPath: '/api/mcp',
}
// Server endpoints become: /api/mcp/sse, /api/mcp/, etc.
```

Useful when running behind a reverse proxy or alongside other services.

## Unix Socket Mode

Bind to a unix socket instead of a TCP port for local-only access:

```typescript
http: {
  socketPath: '/tmp/my-mcp-server.sock',
}
```

- Mutually exclusive with `port` — if `socketPath` is set, `port` is ignored
- Use for local daemons, CLI tools, and process manager integrations
- Combine with `sqlite` for fully local deployments

## Verification

```bash
# Start with custom port
PORT=8080 frontmcp dev

# Test CORS
curl -v -H "Origin: https://myapp.com" http://localhost:8080/

# Test unix socket
curl --unix-socket /tmp/my-mcp-server.sock http://localhost/
```
