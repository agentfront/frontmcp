# @frontmcp/plugin-codecall

CodeCall plugin for FrontMCP - provides AgentScript-based meta-tools for orchestrating MCP tools.

## Installation

```bash
npm install @frontmcp/plugin-codecall @frontmcp/plugin-cache
```

> Note: `@frontmcp/plugin-cache` is a peer dependency and must be installed.

## Usage

```typescript
import { CachePlugin } from '@frontmcp/plugin-cache';
import { CodeCallPlugin } from '@frontmcp/plugin-codecall';
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

## Limits

- **Calls to one tool**: more than `vm.rapidEnumerationThreshold` calls (default 30) to one tool within about 2 seconds stop the script with `[RAPID_ENUMERATION]`; calls made through `parallel()` count. Set per-tool values with `vm.rapidEnumerationOverrides` (`{ 'users:get': 100 }`). The sandbox's message says "in 5s", but it keeps only the last 2 seconds of calls.
- **Embedding model**: `embedding.strategy: 'ml'` downloads its model on first use. When the model can't be loaded (offline with nothing cached, or `@huggingface/transformers` missing), CodeCall logs one warning and searches with TF-IDF.

## Modes

- **codecall_only**: Hide all tools except CodeCall meta-tools
- **codecall_opt_in**: Show all tools, opt-in to CodeCall execution
- **metadata_driven**: Use per-tool metadata for visibility

## License

Apache-2.0
