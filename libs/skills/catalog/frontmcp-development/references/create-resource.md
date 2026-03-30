---
name: create-resource
description: Expose data to AI clients via URI-based static resources and parameterized templates
---

# Creating MCP Resources

Resources expose data to AI clients through URI-based access following the MCP protocol. FrontMCP supports two kinds: **static resources** with fixed URIs (`@Resource`) and **resource templates** with parameterized URI patterns (`@ResourceTemplate`).

## When to Use This Skill

### Must Use

- Exposing data to AI clients through URI-based access following the MCP protocol
- Serving dynamic or static content that clients read on demand (config, status, files)
- Creating parameterized URI patterns for families of related data (user profiles, repo files)

### Recommended

- Providing binary assets (images, PDFs) to AI clients via base64 blob encoding
- Centralizing read-only data sources that multiple tools or prompts reference
- Replacing ad-hoc tool responses with structured, cacheable resource URIs

### Skip When

- The client needs to perform an action, not read data (see `create-tool`)
- You are building a reusable conversation template (see `create-prompt`)
- The data requires autonomous multi-step reasoning to produce (see `create-agent`)

> **Decision:** Use this skill when you need to expose readable data at a URI -- choose `@Resource` for a fixed URI or `@ResourceTemplate` for parameterized URI patterns.

## Static Resources with @Resource

### Decorator Options

The `@Resource` decorator accepts:

- `name` (required) -- unique resource name
- `title` (optional) -- human-readable display title for UIs (if omitted, `name` is used)
- `uri` (required) -- static URI with a valid scheme per RFC 3986
- `description` (optional) -- human-readable description
- `mimeType` (optional) -- MIME type of the resource content
- `icons` (optional) -- array of Icon objects for UI representation (per MCP spec)

### Class-Based Pattern

Create a class extending `ResourceContext` and implement `execute(uri, params)`. It must return a `ReadResourceResult`.

```typescript
import { Resource, ResourceContext } from '@frontmcp/sdk';
import { ReadResourceResult } from '@frontmcp/protocol';

@Resource({
  name: 'app-config',
  uri: 'config://app/settings',
  description: 'Current application configuration',
  mimeType: 'application/json',
})
class AppConfigResource extends ResourceContext {
  async execute(uri: string, params: Record<string, string>): Promise<ReadResourceResult> {
    const config = {
      version: '2.1.0',
      environment: 'production',
      features: { darkMode: true, notifications: true },
    };

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(config, null, 2),
        },
      ],
    };
  }
}
```

### ReadResourceResult Structure

The `ReadResourceResult` returned by `execute()` has this shape:

```typescript
interface ReadResourceResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string; // string content
    blob?: string; // base64-encoded binary content
  }>;
}
```

Each content item has a `uri`, optional `mimeType`, and either `text` (string data) or `blob` (base64 binary data).

### Available Context Methods and Properties

`ResourceContext` extends `ExecutionContextBase`, providing:

**Methods:**

- `execute(uri, params)` -- the main method you implement
- `this.get(token)` -- resolve a dependency from DI (throws if not found)
- `this.tryGet(token)` -- resolve a dependency from DI (returns `undefined` if not found)
- `this.fail(err)` -- abort execution, triggers error flow (never returns)
- `this.mark(stage)` -- set active execution stage for debugging/tracking
- `this.fetch(input, init?)` -- HTTP fetch with context propagation

**Properties:**

- `this.metadata` -- resource metadata from the decorator
- `this.scope` -- the current scope instance
- `this.context` -- the execution context

### Simplified Return Values

FrontMCP automatically normalizes common return shapes into valid `ReadResourceResult` format:

```typescript
@Resource({
  name: 'server-status',
  uri: 'status://server',
  mimeType: 'application/json',
})
class ServerStatusResource extends ResourceContext {
  async execute(uri: string, params: Record<string, string>) {
    // Return a plain object -- FrontMCP wraps it in { contents: [{ uri, text: JSON.stringify(...) }] }
    return { status: 'healthy', uptime: process.uptime() };
  }
}
```

Supported return shapes:

- **Full `ReadResourceResult`**: `{ contents: [...] }` -- passed through as-is
- **Array of content items**: each item with `text` or `blob` is treated as a content entry
- **Plain string**: wrapped into a single text content block
- **Plain object**: serialized with `JSON.stringify` into a single text content block

## Resource Templates with @ResourceTemplate

### Decorator Options

The `@ResourceTemplate` decorator accepts:

- `name` (required) -- unique resource template name
- `title` (optional) -- human-readable display title for UIs (if omitted, `name` is used)
- `uriTemplate` (required) -- URI pattern with `{paramName}` placeholders (RFC 6570 style)
- `description` (optional) -- human-readable description
- `mimeType` (optional) -- MIME type of the resource content
- `icons` (optional) -- array of Icon objects for UI representation (per MCP spec)

### Class-Based Pattern

Use `@ResourceTemplate` with `uriTemplate` instead of `uri`. Type the `ResourceContext` generic parameter to get typed `params`.

```typescript
import { ResourceTemplate, ResourceContext } from '@frontmcp/sdk';
import { ReadResourceResult } from '@frontmcp/protocol';

@ResourceTemplate({
  name: 'user-profile',
  uriTemplate: 'users://{userId}/profile',
  description: 'User profile by ID',
  mimeType: 'application/json',
})
class UserProfileResource extends ResourceContext<{ userId: string }> {
  async execute(uri: string, params: { userId: string }): Promise<ReadResourceResult> {
    const user = await this.fetchUser(params.userId);

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(user),
        },
      ],
    };
  }

  private async fetchUser(userId: string) {
    return { id: userId, name: 'Alice', email: 'alice@example.com' };
  }
}
```

When a client reads `users://u-123/profile`, the framework matches the template and passes `{ userId: 'u-123' }` as `params`.

### Templates with Multiple Parameters

```typescript
@ResourceTemplate({
  name: 'repo-file',
  uriTemplate: 'repo://{owner}/{repo}/files/{path}',
  description: 'File content from a repository',
  mimeType: 'text/plain',
})
class RepoFileResource extends ResourceContext<{ owner: string; repo: string; path: string }> {
  async execute(uri: string, params: { owner: string; repo: string; path: string }): Promise<ReadResourceResult> {
    const content = await this.fetchFileContent(params.owner, params.repo, params.path);

    return {
      contents: [
        {
          uri,
          mimeType: this.metadata.mimeType ?? 'text/plain',
          text: content,
        },
      ],
    };
  }

  private async fetchFileContent(owner: string, repo: string, path: string): Promise<string> {
    const response = await this.fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`);
    const data = await response.json();
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }
}
```

## Function-Style Builders

For simple cases, use `resource()` and `resourceTemplate()` function builders.

**Static resource:**

```typescript
import { resource } from '@frontmcp/sdk';

const SystemInfo = resource({
  name: 'system-info',
  uri: 'system://info',
  mimeType: 'application/json',
})((uri) => ({
  contents: [
    {
      uri,
      text: JSON.stringify({
        platform: process.platform,
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
      }),
    },
  ],
}));
```

**Resource template:**

```typescript
import { resourceTemplate } from '@frontmcp/sdk';

const LogFile = resourceTemplate({
  name: 'log-file',
  uriTemplate: 'logs://{date}/{level}',
  mimeType: 'text/plain',
})((uri, params) => ({
  contents: [
    {
      uri,
      text: `Logs for ${params.date} at level ${params.level}`,
    },
  ],
}));
```

Register them the same way as class resources: `resources: [SystemInfo, LogFile]`.

## Remote and ESM Loading

Load resources from external modules or remote URLs.

**ESM loading:**

```typescript
const ExternalResource = Resource.esm('@my-org/resources@^1.0.0', 'ExternalResource', {
  description: 'A resource loaded from an ES module',
});
```

**Remote loading:**

```typescript
const CloudResource = Resource.remote('https://example.com/resources/data', 'CloudResource', {
  description: 'A resource loaded from a remote server',
});
```

Both return values that can be registered in `resources: [ExternalResource, CloudResource]`.

## Binary Content with Blob

Return binary data as base64-encoded blobs:

```typescript
@Resource({
  name: 'app-logo',
  uri: 'assets://logo.png',
  description: 'Application logo image',
  mimeType: 'image/png',
})
class AppLogoResource extends ResourceContext {
  async execute(uri: string, params: Record<string, string>): Promise<ReadResourceResult> {
    const { readFileBuffer } = await import('@frontmcp/utils');
    const buffer = await readFileBuffer('/assets/logo.png');

    return {
      contents: [
        {
          uri,
          mimeType: 'image/png',
          blob: buffer.toString('base64'),
        },
      ],
    };
  }
}
```

## Multiple Content Items

A single resource can return multiple content entries:

```typescript
@Resource({
  name: 'dashboard-data',
  uri: 'dashboard://overview',
  description: 'Dashboard overview with metrics and chart data',
  mimeType: 'application/json',
})
class DashboardResource extends ResourceContext {
  async execute(uri: string, params: Record<string, string>): Promise<ReadResourceResult> {
    const metrics = await this.loadMetrics();
    const chartData = await this.loadChartData();

    return {
      contents: [
        {
          uri: `${uri}#metrics`,
          mimeType: 'application/json',
          text: JSON.stringify(metrics),
        },
        {
          uri: `${uri}#charts`,
          mimeType: 'application/json',
          text: JSON.stringify(chartData),
        },
      ],
    };
  }

  private async loadMetrics() {
    return { users: 1500, revenue: 42000 };
  }
  private async loadChartData() {
    return { labels: ['Jan', 'Feb'], values: [100, 200] };
  }
}
```

## Dependency Injection

Resources have access to the same DI utilities as tools:

```typescript
import type { Token } from '@frontmcp/di';

interface CacheService {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}
const CACHE: Token<CacheService> = Symbol('cache');

@ResourceTemplate({
  name: 'cached-data',
  uriTemplate: 'cache://{key}',
  description: 'Cached data by key',
  mimeType: 'application/json',
})
class CachedDataResource extends ResourceContext<{ key: string }> {
  async execute(uri: string, params: { key: string }): Promise<ReadResourceResult> {
    const cache = this.get(CACHE);
    const value = await cache.get(params.key);

    if (!value) {
      this.fail(new Error(`Cache key not found: ${params.key}`));
    }

    return {
      contents: [{ uri, mimeType: 'application/json', text: value }],
    };
  }
}
```

## Registration

Add resource classes (or function-style resources) to the `resources` array in `@FrontMcp` or `@App`.

```typescript
import { FrontMcp, App } from '@frontmcp/sdk';

@App({
  name: 'my-app',
  resources: [AppConfigResource, UserProfileResource, SystemInfo, LogFile],
})
class MyApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  resources: [DashboardResource], // can also register resources directly on the server
})
class MyServer {}
```

## URI Validation Rules

All resource URIs are validated per RFC 3986 at metadata level:

- Must have a valid scheme (e.g., `file://`, `https://`, `config://`, `custom://`).
- Scheme-less URIs like `my-resource` will be rejected at registration time.
- Template URIs must also have a valid scheme: `users://{id}` is valid, `{id}/profile` is not.
- URI validation happens at decorator parse time, so errors surface immediately during server startup.

## Nx Generator

Scaffold a new resource using the Nx generator:

```bash
nx generate @frontmcp/nx:resource
```

This creates the resource file, spec file, and updates barrel exports.

## Resource Argument Autocompletion

Resource templates with parameterized URIs can provide autocompletion for their arguments. This is useful when template parameters represent dynamic values that can be searched or enumerated, such as user IDs, product names, or project slugs.

### When to Use

- Template parameters reference entities that exist in a database or external service (user IDs, product names, etc.)
- Clients benefit from discovering valid parameter values without prior knowledge
- The parameter space is searchable or enumerable given a partial input string

### Types

The autocompletion API uses two types from `@frontmcp/sdk`:

```typescript
interface ResourceCompletionResult {
  values: string[];
  total?: number;
  hasMore?: boolean;
}

type ResourceArgumentCompleter = (partial: string) => Promise<ResourceCompletionResult> | ResourceCompletionResult;
```

- `values` -- the list of matching completions for the partial input
- `total` -- optional total number of matches (useful when `values` is a truncated subset)
- `hasMore` -- optional flag indicating additional matches exist beyond what was returned

### How to Implement

There are two approaches, both with full DI access via `this.get()`:

#### Convention-Based (Preferred)

Define a method named `${argName}Completer` on your `ResourceContext` subclass. The framework discovers it automatically -- no override needed.

```typescript
@ResourceTemplate({
  name: 'user-profile',
  description: 'User profile by ID',
  uriTemplate: 'users://{userId}/profile',
  mimeType: 'application/json',
})
class UserProfileResource extends ResourceContext<{ userId: string }> {
  async execute(uri: string, params: { userId: string }) {
    const user = await this.get(UserService).findById(params.userId);
    return { id: user.id, name: user.name, email: user.email };
  }

  async userIdCompleter(partial: string): Promise<ResourceCompletionResult> {
    const users = await this.get(UserService).search(partial);
    return { values: users.map((u) => u.id), total: users.length };
  }
}
```

The naming convention is `${argName}Completer` -- for a URI parameter `{accountName}`, define `accountNameCompleter(partial)`.

#### Override-Based

Override the `getArgumentCompleter(argName)` method for dynamic dispatch across multiple parameters. Return a completer function for argument names you support, or `null` for unknown arguments.

```typescript
getArgumentCompleter(argName: string): ResourceArgumentCompleter | null {
  if (argName === 'userId') {
    return async (partial) => {
      const users = await this.get(UserService).search(partial);
      return { values: users.map((u) => u.id), total: users.length };
    };
  }
  return null;
}
```

Convention-based completers take priority when both are present on the same class.

### Complete Example

A user profile template resource that autocompletes user IDs using the convention-based approach:

```typescript
@ResourceTemplate({
  name: 'user-profile',
  description: 'User profile by ID',
  uriTemplate: 'users://{userId}/profile',
  mimeType: 'application/json',
})
class UserProfileResource extends ResourceContext<{ userId: string }> {
  async execute(uri: string, params: { userId: string }) {
    const user = await this.get(UserService).findById(params.userId);
    return { id: user.id, name: user.name, email: user.email };
  }

  async userIdCompleter(partial: string): Promise<ResourceCompletionResult> {
    const users = await this.get(UserService).search(partial);
    return { values: users.map((u) => u.id), total: users.length };
  }
}
```

When a client requests completions for the `userId` parameter with a partial string like `"al"`, the completer queries the user service and returns matching IDs.

## Common Patterns

| Pattern                | Correct                                                                  | Incorrect                                                               | Why                                                                              |
| ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| URI scheme             | `uri: 'config://app/settings'` (valid scheme)                            | `uri: 'app-settings'` (no scheme)                                       | URIs are validated per RFC 3986; scheme-less URIs are rejected at registration   |
| Resource vs template   | `@Resource` for fixed URIs, `@ResourceTemplate` for `{param}` URIs       | Using `@Resource` with `{param}` placeholders                           | Framework selects matching strategy based on decorator type                      |
| Return shape           | Return full `ReadResourceResult` or let FrontMCP normalize plain objects | Manually wrapping every return in `{ contents: [...] }` when not needed | FrontMCP auto-wraps strings, objects, and arrays into valid `ReadResourceResult` |
| Template params typing | `ResourceContext<{ userId: string }>` with typed `params`                | `ResourceContext` with untyped `params: Record<string, string>`         | Generic parameter enables compile-time checking of URI parameters                |
| Binary content         | Use `blob` field with base64 encoding for binary data                    | Returning raw `Buffer` in `text` field                                  | MCP protocol expects base64 in `blob`; `text` is for string content only         |

## Verification Checklist

### Configuration

- [ ] Resource class extends `ResourceContext` and implements `execute(uri, params)`
- [ ] `@Resource` has `name` and `uri` with a valid scheme, or `@ResourceTemplate` has `name` and `uriTemplate`
- [ ] Resource is registered in `resources` array of `@App` or `@FrontMcp`
- [ ] `mimeType` is set when the content type is not plain text

### Runtime

- [ ] Resource appears in `resources/list` MCP response
- [ ] Reading the resource URI returns the expected `ReadResourceResult`
- [ ] Template parameters are extracted correctly from the URI
- [ ] Binary resources return valid base64 in the `blob` field
- [ ] DI dependencies resolve correctly via `this.get()`

### Autocompletion

- [ ] Template resources with dynamic params define `${argName}Completer` methods or override `getArgumentCompleter()`
- [ ] Completer returns `{ values, total?, hasMore? }` matching the partial input
- [ ] Completers use `this.get()` for DI (both convention and override patterns support full DI)

## Troubleshooting

| Problem                                          | Cause                                            | Solution                                                                           |
| ------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Resource not appearing in `resources/list`       | Not registered in `resources` array              | Add resource class to `@App` or `@FrontMcp` `resources` array                      |
| URI validation error at startup                  | Missing or invalid URI scheme                    | Ensure URI has a scheme like `config://`, `https://`, or `custom://`               |
| Template parameters are empty                    | Using `@Resource` instead of `@ResourceTemplate` | Switch to `@ResourceTemplate` with `uriTemplate` containing `{param}` placeholders |
| Binary content is garbled                        | Returning raw buffer in `text` field             | Use `blob: buffer.toString('base64')` instead of `text` for binary data            |
| `this.get(TOKEN)` throws DependencyNotFoundError | Provider not registered in scope                 | Register provider in `providers` array of `@App` or `@FrontMcp`                    |

## Reference

- [Resources Documentation](https://docs.agentfront.dev/frontmcp/servers/resources)
- Related skills: `create-tool`, `create-prompt`, `create-provider`, `create-agent`
