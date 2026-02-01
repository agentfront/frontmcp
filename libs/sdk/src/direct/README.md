# DirectClient - Programmatic MCP Access

The DirectClient provides programmatic access to FrontMCP servers without HTTP/stdio transports. Connect directly from your TypeScript/JavaScript code with LLM-aware response formatting.

## DirectClient vs Stdio vs HTTP Transport

FrontMCP supports multiple ways to connect to MCP servers. Choose based on your use case:

| Aspect            | DirectClient                                               | Stdio                                                 | HTTP (Streamable)                             |
| ----------------- | ---------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------- |
| **Use Case**      | Programmatic SDK access, testing, same-process integration | CLI tools, local MCP clients (Claude Desktop, Cursor) | Remote servers, web apps, distributed systems |
| **Connection**    | In-process (no network/IPC)                                | Stdin/stdout pipes                                    | HTTP/HTTPS requests                           |
| **Process Model** | Same process                                               | Separate process spawned by client                    | Separate server process                       |
| **Latency**       | Lowest (direct function calls)                             | Low (IPC overhead)                                    | Higher (network overhead)                     |
| **Session State** | In-memory                                                  | Per-process                                           | Persistent (Redis optional)                   |
| **Auth**          | Optional (direct token injection)                          | Environment-based                                     | Bearer tokens, OAuth                          |
| **Best For**      | SDK integrations, unit tests, AI agent frameworks          | Desktop apps, CLI tools                               | Production APIs, multi-tenant                 |

### When to Use DirectClient

- **Building AI agents**: Integrate MCP tools directly into your LangChain, Vercel AI, or custom agent code
- **Testing**: Write unit/integration tests without spinning up servers
- **Same-process integrations**: Embed MCP capabilities in your application
- **Performance-critical**: Avoid network/IPC overhead for high-throughput scenarios

```typescript
// DirectClient: Same process, direct calls
import { connectOpenAI } from '@frontmcp/sdk/direct';

const client = await connectOpenAI(scope);
const tools = await client.listTools(); // Direct function call
```

### When to Use Stdio

- **Desktop MCP clients**: Claude Desktop, Cursor, VS Code extensions
- **CLI tools**: Command-line interfaces that spawn MCP servers
- **Local development**: Quick testing with standard MCP clients

```bash
# Stdio: Separate process, stdin/stdout communication
npx frontmcp dev --stdio
# Client spawns server and communicates via pipes
```

### When to Use HTTP Transport

- **Production deployments**: Remote servers, load balancing, scaling
- **Web applications**: Browser-based clients, REST-like access
- **Multi-tenant systems**: Shared servers with authentication
- **Distributed architectures**: Microservices, serverless

```typescript
// HTTP: Network requests to remote server
@FrontMcp({
  http: { port: 3000 },
  // ...
})
class MyServer {}
// Client connects via HTTP POST to /mcp endpoint
```

## Features

- **Direct In-Process Connection** - No HTTP overhead, connect directly to scope
- **LLM Platform Detection** - Automatic tool/result formatting for OpenAI, Claude, LangChain, Vercel AI
- **Full MCP Protocol Support** - Tools, resources, prompts, completions, subscriptions
- **Skills Operations** - Search, load, and list skills
- **Elicitation Handling** - Handle interactive user prompts
- **Session Management** - Custom session IDs, auth tokens, user context

## Installation

DirectClient is included in `@frontmcp/sdk`:

```bash
npm install @frontmcp/sdk
```

## Quick Start

### Basic Connection

```typescript
import { connect } from '@frontmcp/sdk/direct';
import { MyServer } from './server';

// Get your FrontMCP scope
const scope = await MyServer.createScope();

// Connect directly
const client = await connect(scope);

// Use the client
const tools = await client.listTools();
const result = await client.callTool('my-tool', { arg: 'value' });

// Clean up
await client.close();
```

### LLM-Specific Connections

For automatic tool/result formatting based on LLM platform:

```typescript
import { connectOpenAI, connectClaude, connectLangChain, connectVercelAI } from '@frontmcp/sdk/direct';

// OpenAI format (function calling)
const openaiClient = await connectOpenAI(scope, {
  authToken: 'my-token',
  session: { user: { sub: 'user-123' } },
});

// Claude format (tool_use blocks)
const claudeClient = await connectClaude(scope);

// LangChain format
const langchainClient = await connectLangChain(scope);

// Vercel AI format
const vercelClient = await connectVercelAI(scope);
```

## API Reference

### Core Operations

#### Tool Operations

```typescript
// List all tools (formatted for detected platform)
const tools = await client.listTools();

// Call a tool
const result = await client.callTool('tool-name', {
  param1: 'value1',
  param2: 123,
});
```

#### Resource Operations

```typescript
// List resources
const resources = await client.listResources();

// Read a resource
const content = await client.readResource('file://path/to/resource.txt');

// List resource templates
const templates = await client.listResourceTemplates();
```

#### Prompt Operations

```typescript
// List prompts
const prompts = await client.listPrompts();

// Get a prompt with arguments
const prompt = await client.getPrompt('my-prompt', {
  topic: 'TypeScript',
});
```

### Skills Operations

Skills are modular knowledge packages that teach AI how to perform multi-step tasks.

#### Search Skills

```typescript
import type { SearchSkillsOptions, SearchSkillsResult } from '@frontmcp/sdk/direct';

const options: SearchSkillsOptions = {
  tags: ['code-review'], // Filter by tags
  tools: ['github_get_pr'], // Filter by required tools
  limit: 10, // Max results (1-50)
  requireAllTools: true, // Require all specified tools
};

const result: SearchSkillsResult = await client.searchSkills('code review', options);

// Result structure:
// {
//   skills: [{ id, name, description, score, tags, tools: [{ name, available }], source }],
//   total: number,
//   hasMore: boolean,
//   guidance: string  // "Found X matching skills. Use skills/load..."
// }
```

#### Load Skills

```typescript
import type { LoadSkillsOptions, LoadSkillsResult } from '@frontmcp/sdk/direct';

const options: LoadSkillsOptions = {
  format: 'full', // 'full' | 'instructions-only'
  activateSession: true, // Activate skill session
  policyMode: 'approval', // 'strict' | 'approval' | 'permissive'
};

const result: LoadSkillsResult = await client.loadSkills(['skill-1', 'skill-2'], options);

// Result structure:
// {
//   skills: [{
//     id, name, description, instructions,
//     tools: [{ name, purpose, available, inputSchema, outputSchema }],
//     parameters: [{ name, description, required, type }],
//     availableTools: string[],
//     missingTools: string[],
//     isComplete: boolean,
//     formattedContent: string,
//     session?: { activated, sessionId, policyMode, allowedTools }
//   }],
//   summary: { totalSkills, totalTools, allToolsAvailable, combinedWarnings },
//   nextSteps: string
// }
```

#### List Skills

```typescript
import type { ListSkillsOptions, ListSkillsResult } from '@frontmcp/sdk/direct';

const options: ListSkillsOptions = {
  offset: 0,
  limit: 20,
  tags: ['productivity'],
  sortBy: 'priority', // 'name' | 'priority' | 'createdAt'
  sortOrder: 'desc', // 'asc' | 'desc'
  includeHidden: false,
};

const result: ListSkillsResult = await client.listSkills(options);

// Result structure:
// {
//   skills: [{ id, name, description, tags, priority }],
//   total: number,
//   hasMore: boolean
// }
```

### Elicitation Operations

Elicitation allows tools to request user input during execution.

#### Register Elicitation Handler

```typescript
import type { ElicitationHandler, ElicitationRequest, ElicitationResponse } from '@frontmcp/sdk/direct';

const handler: ElicitationHandler = async (request: ElicitationRequest) => {
  // request structure:
  // {
  //   elicitId: string,       // Unique elicitation ID
  //   message: string,        // Message to display
  //   requestedSchema: {...}, // JSON Schema for expected response
  //   mode: 'form' | 'url',   // Elicitation mode
  //   expiresAt: number       // Expiration timestamp
  // }

  // Prompt user and return response
  const userInput = await promptUser(request.message, request.requestedSchema);

  return {
    action: 'accept', // 'accept' | 'cancel' | 'decline'
    content: userInput,
  };
};

// Register handler (returns unsubscribe function)
const unsubscribe = client.onElicitation(handler);

// Later: unsubscribe when done
unsubscribe();
```

#### Manual Elicitation Result Submission

```typescript
// For async/external elicitation handling
await client.submitElicitationResult('elicit-123', {
  action: 'accept',
  content: { approved: true, comment: 'Looks good!' },
});
```

### Completion Operations

Request argument completion for prompts or resources.

```typescript
import type { CompleteOptions, CompleteResult } from '@frontmcp/sdk/direct';

// Complete for a prompt argument
const promptResult: CompleteResult = await client.complete({
  ref: { type: 'ref/prompt', name: 'my-prompt' },
  argument: { name: 'topic', value: 'Type' },
});

// Complete for a resource argument
const resourceResult: CompleteResult = await client.complete({
  ref: { type: 'ref/resource', uri: 'file://{path}' },
  argument: { name: 'path', value: '/src/' },
});

// Result structure:
// {
//   completion: {
//     values: ['TypeScript', 'Types', 'Typography'],
//     total: 3,
//     hasMore: false
//   }
// }
```

### Resource Subscription Operations

Subscribe to resource updates for real-time notifications.

```typescript
// Subscribe to a resource
await client.subscribeResource('file://config.json');

// Register update handler
const unsubscribe = client.onResourceUpdated((uri: string) => {
  console.log(`Resource updated: ${uri}`);
  // Re-read the resource or update your cache
});

// Unsubscribe from a resource
await client.unsubscribeResource('file://config.json');

// Unregister update handler
unsubscribe();
```

### Logging Operations

Control server-side logging level.

```typescript
import type { McpLogLevel } from '@frontmcp/sdk/direct';

// Set logging level
// Levels: 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency'
await client.setLogLevel('debug');
```

### Info Methods

```typescript
// Get session ID
const sessionId = client.getSessionId();

// Get client info
const clientInfo = client.getClientInfo();
// { name: 'openai-agent', version: '1.0.0' }

// Get server info
const serverInfo = client.getServerInfo();
// { name: 'my-server', version: '1.0.0' }

// Get server capabilities
const capabilities = client.getCapabilities();
// { tools: { listChanged: true }, resources: {...}, ... }

// Get detected platform
const platform = client.getDetectedPlatform();
// 'openai' | 'claude' | 'langchain' | 'vercel-ai' | 'raw'
```

### Lifecycle

```typescript
// Close connection and cleanup
await client.close();
```

## Connection Options

```typescript
interface ConnectOptions {
  // Custom client info for platform detection
  clientInfo?: {
    name: string;
    version: string;
  };

  // Session configuration
  session?: {
    id?: string; // Custom session ID
    user?: {
      // User context
      sub?: string;
      email?: string;
      name?: string;
      [key: string]: unknown;
    };
  };

  // Auth token for protected servers
  authToken?: string;

  // Client capabilities
  capabilities?: {
    roots?: { listChanged?: boolean };
    sampling?: {};
    elicitation?: {};
  };
}
```

## Type Exports

All types are exported from `@frontmcp/sdk/direct`:

```typescript
import type {
  // Core
  DirectClient,
  ConnectOptions,
  LLMConnectOptions,
  SessionOptions,
  ClientInfo,
  LLMPlatform,

  // Skills
  SearchSkillsOptions,
  SearchSkillsResult,
  SkillSearchResultItem,
  LoadSkillsOptions,
  LoadSkillsResult,
  LoadedSkillItem,
  ListSkillsOptions,
  ListSkillsResult,

  // Elicitation
  ElicitationRequest,
  ElicitationResponse,
  ElicitationHandler,

  // Completion
  CompleteOptions,
  CompleteResult,

  // Logging
  McpLogLevel,
} from '@frontmcp/sdk/direct';
```

## Platform-Specific Formatting

DirectClient automatically formats tools and results based on the detected platform:

| Platform  | Tool Format                               | Result Format         |
| --------- | ----------------------------------------- | --------------------- |
| OpenAI    | `{ type: 'function', function: {...} }`   | Parsed JSON or string |
| Claude    | `{ name, description, input_schema }`     | Content array         |
| LangChain | `{ name, description, schema }`           | Parsed JSON           |
| Vercel AI | `{ [name]: { description, parameters } }` | Parsed JSON           |
| Raw       | MCP native format                         | MCP CallToolResult    |

## Error Handling

```typescript
try {
  const result = await client.callTool('my-tool', args);
} catch (error) {
  if (error.code === -32002) {
    // Resource not found
  } else if (error.code === -32602) {
    // Invalid params
  }
}
```

## Best Practices

1. **Always close the client** when done to clean up resources
2. **Use LLM-specific helpers** for automatic formatting
3. **Handle elicitation** if your tools use interactive prompts
4. **Subscribe to resources** you need to watch for changes
5. **Check capabilities** before using optional features

## Related Documentation

- [Tools](../tool/README.md) - Creating and using tools
- [Resources](../resource/README.md) - Working with resources
- [Skills](../skill/README.md) - Creating modular knowledge packages
- [Elicitation](../elicitation/README.md) - Interactive user prompts
