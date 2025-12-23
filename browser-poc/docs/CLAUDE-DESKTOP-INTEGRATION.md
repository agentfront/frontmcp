# Claude Desktop Integration

Guide for integrating FrontMCP Browser applications with Claude Desktop.

## Overview

Claude Desktop is Anthropic's desktop application that supports MCP servers. FrontMCP Browser apps can be registered with Claude Desktop to enable AI-powered interactions directly from the desktop.

## Prerequisites

- Claude Desktop installed (macOS/Windows)
- FrontMCP Browser app running in a supported browser
- Chrome or browser extension (for extension transport)

---

## Integration Methods

### Method 1: Browser Extension Bridge

The recommended approach uses a browser extension to bridge between Claude Desktop and your FrontMCP Browser app.

#### Architecture

```
┌────────────────────────────────────────────────────────┐
│                    Claude Desktop                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │              MCP Client                           │ │
│  └──────────────────────────────────────────────────┘ │
└─────────────────────────┬──────────────────────────────┘
                          │ stdio / pipe
┌─────────────────────────▼──────────────────────────────┐
│                 Extension Background                    │
│  ┌──────────────────────────────────────────────────┐ │
│  │         ExtensionServerTransport                  │ │
│  └──────────────────────────────────────────────────┘ │
└─────────────────────────┬──────────────────────────────┘
                          │ chrome.runtime.sendMessage
┌─────────────────────────▼──────────────────────────────┐
│                    Browser Tab                          │
│  ┌──────────────────────────────────────────────────┐ │
│  │          FrontMCP Browser Server                  │ │
│  │    - Tools, Resources, Store                      │ │
│  └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

#### Extension Setup

```typescript
// background.ts - Extension background script
import { ExtensionServerTransport } from '@frontmcp/browser/extension';

// Create transport that communicates with Claude Desktop
const transport = new ExtensionServerTransport({
  name: 'my-frontmcp-app',
  version: '1.0.0',
});

// Relay messages to active tab
transport.onMessage(async (message) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab?.id) {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'mcp',
      payload: message,
    });
    transport.send(response);
  }
});

// Listen for messages from tab
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'mcp') {
    transport.send(request.payload);
  }
});
```

```typescript
// content.ts - Content script in your app
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'mcp') {
    // Forward to FrontMCP server
    window.postMessage(
      {
        type: 'frontmcp:request',
        payload: request.payload,
      },
      '*',
    );
  }
});

// Listen for responses
window.addEventListener('message', (event) => {
  if (event.data.type === 'frontmcp:response') {
    chrome.runtime.sendMessage({
      type: 'mcp',
      payload: event.data.payload,
    });
  }
});
```

#### manifest.json

```json
{
  "manifest_version": 3,
  "name": "FrontMCP Bridge",
  "version": "1.0.0",
  "description": "Bridge FrontMCP Browser to Claude Desktop",
  "permissions": ["nativeMessaging", "activeTab", "tabs"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://your-app.example.com/*"],
      "js": ["content.js"]
    }
  ],
  "native_messaging_hosts": ["com.frontmcp.bridge"]
}
```

### Method 2: Native Messaging Host

For deeper integration, create a native messaging host that Claude Desktop communicates with directly.

#### Native Host Setup

```json
// com.frontmcp.bridge.json (macOS: ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/)
{
  "name": "com.frontmcp.bridge",
  "description": "FrontMCP Native Bridge",
  "path": "/path/to/frontmcp-bridge",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://your-extension-id/"]
}
```

```typescript
// frontmcp-bridge.ts - Native host executable
import { createInterface } from 'readline';

// Read messages from stdin (Claude Desktop)
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function sendMessage(message: unknown) {
  const json = JSON.stringify(message);
  const length = Buffer.byteLength(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(length, 0);
  process.stdout.write(header);
  process.stdout.write(json);
}

// Read native message format
process.stdin.on('readable', () => {
  let chunk;
  while ((chunk = process.stdin.read(4)) !== null) {
    const length = chunk.readUInt32LE(0);
    const data = process.stdin.read(length);
    if (data) {
      const message = JSON.parse(data.toString());
      handleMessage(message);
    }
  }
});

async function handleMessage(message: unknown) {
  // Forward to browser via WebSocket or similar
  // ...
}
```

---

## Claude Desktop Configuration

### Server Registration

Register your FrontMCP app in Claude Desktop's configuration:

```json
// macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
// Windows: %APPDATA%\Claude\claude_desktop_config.json
{
  "mcpServers": {
    "my-frontmcp-app": {
      "command": "node",
      "args": ["/path/to/frontmcp-bridge/index.js"],
      "env": {
        "FRONTMCP_APP_URL": "https://your-app.example.com"
      }
    }
  }
}
```

### With Extension

```json
{
  "mcpServers": {
    "my-frontmcp-app": {
      "command": "chrome-extension://your-extension-id/background.js",
      "transport": "extension"
    }
  }
}
```

---

## FrontMCP App Configuration

### Enable Claude Desktop Support

```typescript
// In your FrontMCP app
const server = await createBrowserMcpServer({
  info: {
    name: 'MyApp',
    version: '1.0.0',
    description: 'AI-powered application',
  },
  transport: new PostMessageTransport(window, {
    origin: '*', // For extension communication
    messageType: 'frontmcp',
  }),
  capabilities: {
    // Enable capabilities Claude Desktop expects
    tools: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    prompts: { listChanged: true },
  },
});

// Listen for extension messages
window.addEventListener('message', (event) => {
  if (event.data.type === 'frontmcp:request') {
    // Handle MCP request from Claude Desktop
    server.handleRequest(event.data.payload).then((response) => {
      window.postMessage(
        {
          type: 'frontmcp:response',
          payload: response,
        },
        '*',
      );
    });
  }
});
```

### Tool Discovery

Ensure your tools are discoverable by Claude Desktop:

```typescript
server.registerTool('search', {
  description: 'Search for items in the application',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().optional().describe('Max results'),
  }),
  execute: async (args) => {
    // Implementation
  },
});

// Tools are automatically listed via tools/list
```

---

## Testing Integration

### Local Testing

1. Start your FrontMCP app locally
2. Load the extension in Chrome (chrome://extensions)
3. Open Claude Desktop
4. Verify server appears in Claude's MCP list
5. Test tool execution

### Debug Mode

```typescript
// Enable debug logging
const server = await createBrowserMcpServer({
  info: { name: 'MyApp', version: '1.0.0' },
  debug: true,
  logger: {
    info: (msg) => console.log('[MCP]', msg),
    error: (msg) => console.error('[MCP]', msg),
    debug: (msg) => console.debug('[MCP]', msg),
  },
});

// In extension background
chrome.runtime.onMessage.addListener((request) => {
  console.log('[Extension]', 'Message:', request);
});
```

### Verify Connection

```typescript
// In your app, expose connection status
server.registerResource('status://connection', {
  name: 'Connection Status',
  mimeType: 'application/json',
  read: async () => ({
    contents: [
      {
        uri: 'status://connection',
        mimeType: 'application/json',
        text: JSON.stringify({
          connected: true,
          transport: 'extension',
          lastPing: Date.now(),
        }),
      },
    ],
  }),
});
```

---

## Common Issues

### "Server not found" in Claude Desktop

**Causes:**

1. Config file syntax error
2. Extension not installed/enabled
3. Native host path incorrect

**Solutions:**

1. Validate JSON syntax in config file
2. Check extension is loaded and enabled
3. Verify native host path exists and is executable

### Messages not reaching app

**Causes:**

1. Content script not injected
2. Origin mismatch
3. postMessage not received

**Solutions:**

1. Check manifest `matches` pattern
2. Verify origins match in transport config
3. Add message logging to trace flow

### Tool execution fails

**Causes:**

1. Schema validation error
2. Tool throws exception
3. Response timeout

**Solutions:**

1. Check tool inputSchema matches sent arguments
2. Add try/catch in tool execute function
3. Increase timeout in Claude Desktop config

---

## Security Considerations

### Extension Permissions

Request minimal permissions:

```json
{
  "permissions": [
    "nativeMessaging" // Required for Claude Desktop
  ],
  "host_permissions": [
    "https://your-app.example.com/*" // Only your app
  ]
}
```

### Message Validation

Always validate messages from Claude Desktop:

```typescript
function validateMcpMessage(message: unknown): message is JSONRPCMessage {
  if (typeof message !== 'object' || message === null) return false;
  if (!('jsonrpc' in message) || message.jsonrpc !== '2.0') return false;
  if (!('method' in message) || typeof message.method !== 'string') return false;
  return true;
}

transport.onMessage((message) => {
  if (!validateMcpMessage(message)) {
    console.error('Invalid MCP message:', message);
    return;
  }
  // Process valid message
});
```

### User Consent

Show user what Claude Desktop can access:

```tsx
function ClaudeDesktopConsent({ onAccept, onDeny }) {
  return (
    <Dialog>
      <DialogTitle>Claude Desktop Integration</DialogTitle>
      <DialogContent>
        <p>Claude Desktop wants to access:</p>
        <ul>
          <li>Search your data</li>
          <li>Create and modify items</li>
          <li>Read your settings</li>
        </ul>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDeny}>Deny</Button>
        <Button onClick={onAccept} variant="primary">
          Allow
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

---

## Best Practices

1. **Provide clear tool descriptions** - Claude uses these to understand capabilities
2. **Use Zod `.describe()` for parameters** - Helps Claude understand each field
3. **Return structured data** - Makes responses easier for Claude to process
4. **Implement HiTL for sensitive actions** - User confirmation for destructive ops
5. **Handle connection lifecycle** - Gracefully handle connect/disconnect
6. **Log interactions** - Audit trail for debugging and compliance

---

## See Also

- [TRANSPORT.md](./TRANSPORT.md) - ExtensionServerTransport details
- [APP-BRIDGE.md](./APP-BRIDGE.md) - Embedding patterns
- [SECURITY.md](./SECURITY.md) - Security best practices
