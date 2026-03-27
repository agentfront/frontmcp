# Configuring HTTP Options

Configure the HTTP server — port, CORS policy, unix sockets, and entry path prefix.

## When to Use This Skill

### Must Use

- Changing the default HTTP port or binding to a specific network interface
- Enabling or restricting CORS for a frontend application that calls the MCP server
- Binding to a unix socket for local daemon or process-manager integrations

### Recommended

- Mounting the MCP server under a URL prefix behind a reverse proxy
- Setting a dynamic port from an environment variable for container deployments
- Fine-tuning CORS preflight caching for performance-sensitive frontends

### Skip When

- Using stdio transport only with no HTTP listener -- no HTTP options apply
- Only need rate limiting or IP filtering without changing HTTP binding -- use `configure-throttle`
- Need to configure TLS/HTTPS termination -- handle at the reverse proxy or load balancer level, not in FrontMCP

> **Decision:** Use this skill when you need to customize how the HTTP listener binds (port, socket, prefix) or how it handles CORS; skip if the default port 3001 with permissive CORS is sufficient.

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

## Common Patterns

| Pattern               | Correct                                                      | Incorrect                                    | Why                                                                                                               |
| --------------------- | ------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Port from environment | `port: Number(process.env.PORT) \|\| 3001`                   | `port: process.env.PORT`                     | The `port` field expects a number; passing a string causes a silent bind failure                                  |
| CORS with credentials | `cors: { origin: ['https://myapp.com'], credentials: true }` | `cors: { origin: true, credentials: true }`  | Browsers reject `Access-Control-Allow-Origin: *` when credentials are enabled; you must list explicit origins     |
| Unix socket mode      | `socketPath: '/tmp/my-mcp.sock'` with no `port` field        | Setting both `socketPath` and `port`         | When `socketPath` is set, `port` is silently ignored which can cause confusion during debugging                   |
| Entry path prefix     | `entryPath: '/api/mcp'` (no trailing slash)                  | `entryPath: '/api/mcp/'` with trailing slash | Trailing slashes cause double-slash issues in route matching (e.g., `/api/mcp//sse`)                              |
| Disabling CORS        | `cors: false`                                                | Omitting the `cors` field entirely           | Omitting `cors` applies permissive defaults (all origins allowed); set `false` explicitly to send no CORS headers |

## Verification Checklist

### Configuration

- [ ] `http` block is present in the `@FrontMcp` decorator metadata
- [ ] Port value is a number (not a string) and falls within a valid range (0-65535)
- [ ] If `socketPath` is set, `port` is removed or commented out to avoid confusion
- [ ] `entryPath` does not have a trailing slash

### CORS

- [ ] If `credentials: true`, `origin` lists explicit allowed origins (not `true` or `*`)
- [ ] `maxAge` is set to a reasonable value for production (e.g., `86400` for 24 hours)
- [ ] Dynamic origin function handles `undefined` origin (non-browser requests)

### Runtime

- [ ] Server starts and binds to the expected port or socket path
- [ ] `curl -v -H "Origin: <your-origin>" <url>` returns correct `Access-Control-Allow-Origin`
- [ ] Preflight `OPTIONS` requests return `204` with expected CORS headers

## Troubleshooting

| Problem                                          | Cause                                                                                      | Solution                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `EADDRINUSE` on startup                          | Another process is already using the configured port                                       | Change the port, stop the other process, or use `port: 0` for a random available port                   |
| CORS errors in the browser console               | Origin not included in the `cors.origin` list or `credentials: true` with wildcard origin  | Add the frontend origin to the `origin` array and ensure credentials and origin settings are compatible |
| Unix socket file not created                     | Missing write permissions on the target directory or stale socket file from a previous run | Check directory permissions and remove the stale `.sock` file before restarting                         |
| Routes return 404 after setting `entryPath`      | Client is still requesting the root path without the prefix                                | Update client base URL to include the entry path (e.g., `http://localhost:3001/api/mcp`)                |
| Server binds but external clients cannot connect | Server bound to `localhost` or `127.0.0.1` inside a container                              | Set `host: '0.0.0.0'` or use Docker port mapping to expose the container port                           |

## Reference

- [HTTP Server Docs](https://docs.agentfront.dev/frontmcp/deployment/local-dev-server)
- Related skills: `configure-throttle`, `configure-transport`, `setup-redis`, `setup-project`
