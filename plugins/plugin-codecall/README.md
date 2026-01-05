# @frontmcp/plugin-codecall

CodeCall plugin for FrontMCP - provides AgentScript-based meta-tools for orchestrating MCP tools.

## Installation

```bash
npm install @frontmcp/plugin-codecall @frontmcp/plugin-cache
```

> Note: `@frontmcp/plugin-cache` is a peer dependency and must be installed.

## Usage

```typescript
import { CodeCallPlugin } from '@frontmcp/plugin-codecall';
import { CachePlugin } from '@frontmcp/plugin-cache';
import { FrontMcp } from '@frontmcp/sdk';

const app = new FrontMcp({
  plugins: [CachePlugin, CodeCallPlugin],
});
```

## Features

- **Meta-Tools**: Search, describe, execute, and invoke tools programmatically
- **AgentScript Execution**: Run JavaScript code in a sandboxed VM
- **Tool Discovery**: Semantic search across available tools
- **Configurable Modes**: Control tool visibility and execution patterns

## Meta-Tools

- `codecall:search` - Search for tools by name or description
- `codecall:describe` - Get detailed tool descriptions
- `codecall:execute` - Execute AgentScript code
- `codecall:invoke` - Invoke a specific tool directly

## Configuration

```typescript
import { CodeCallPlugin } from '@frontmcp/plugin-codecall';

const app = new FrontMcp({
  plugins: [
    CodeCallPlugin.configure({
      mode: 'codecall_only', // 'codecall_only' | 'codecall_opt_in' | 'metadata_driven'
      embedding: {
        enabled: true,
        model: 'default',
      },
    }),
  ],
});
```

## Modes

- **codecall_only**: Hide all tools except CodeCall meta-tools
- **codecall_opt_in**: Show all tools, opt-in to CodeCall execution
- **metadata_driven**: Use per-tool metadata for visibility

## License

Apache-2.0
