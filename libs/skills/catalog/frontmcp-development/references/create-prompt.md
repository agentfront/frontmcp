---
name: create-prompt
description: Define reusable AI interaction patterns that produce structured message sequences
---

# Creating MCP Prompts

Prompts define reusable AI interaction patterns in the MCP protocol. They produce structured message sequences that clients use to guide LLM conversations. In FrontMCP, prompts are classes extending `PromptContext`, decorated with `@Prompt`, that return `GetPromptResult` objects.

## When to Use This Skill

### Must Use

- Building a reusable conversation template that AI clients invoke with arguments
- Defining structured multi-turn message sequences (user/assistant patterns)
- Creating domain-specific prompt patterns (code review, debugging, RAG queries)

### Recommended

- Standardizing message formats across multiple tools or agents
- Embedding MCP resource content into prompt messages for context
- Generating dynamic prompts that perform async lookups (knowledge base, APIs)

### Skip When

- You need an executable action that performs work and returns results (see `create-tool`)
- You need to expose read-only data at a URI (see `create-resource`)
- The task requires autonomous multi-step reasoning with inner tools (see `create-agent`)

> **Decision:** Use this skill when you need a reusable, parameterized conversation template that produces structured `GetPromptResult` messages.

## Class-Based Pattern

Create a class extending `PromptContext` and implement `execute(args)`. The `@Prompt` decorator accepts `name`, optional `description`, and `arguments` (the prompt's input parameters).

```typescript
import { Prompt, PromptContext } from '@frontmcp/sdk';
import { GetPromptResult } from '@frontmcp/protocol';

@Prompt({
  name: 'code-review',
  description: 'Generate a structured code review for the given code',
  arguments: [
    { name: 'code', description: 'The code to review', required: true },
    { name: 'language', description: 'Programming language', required: false },
  ],
})
class CodeReviewPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const language = args.language ?? 'unknown language';

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please review the following ${language} code. Focus on correctness, performance, and maintainability.\n\n\`\`\`${language}\n${args.code}\n\`\`\``,
          },
        },
      ],
    };
  }
}
```

### Decorator Options

The `@Prompt` decorator accepts:

- `name` (required) -- unique prompt name
- `title` (optional) -- human-readable display title for UIs (if omitted, `name` is used)
- `description` (optional) -- human-readable description
- `arguments` (optional) -- array of `PromptArgument` objects
- `icons` (optional) -- array of Icon objects for UI representation (per MCP spec)

### PromptArgument Structure

Each entry in the `arguments` array has this shape:

```typescript
interface PromptArgument {
  name: string; // argument name
  description?: string; // human-readable description
  required?: boolean; // whether the argument must be provided (default: false)
}
```

Required arguments are validated before `execute()` runs. Missing required arguments throw `MissingPromptArgumentError`.

### GetPromptResult Structure

The `execute()` method must return a `GetPromptResult`:

```typescript
interface GetPromptResult {
  messages: Array<{
    role: 'user' | 'assistant';
    content: {
      type: 'text';
      text: string;
    };
  }>;
}
```

Messages use two roles:

- `user` -- represents the human side of the conversation
- `assistant` -- primes the conversation with expected response patterns

### Available Context Methods and Properties

`PromptContext` extends `ExecutionContextBase`, providing:

**Methods:**

- `execute(args)` -- the main method you implement, receives `Record<string, string>`
- `this.get(token)` -- resolve a dependency from DI (throws if not found)
- `this.tryGet(token)` -- resolve a dependency from DI (returns `undefined` if not found)
- `this.fail(err)` -- abort execution, triggers error flow (never returns)
- `this.mark(stage)` -- set active execution stage for debugging/tracking
- `this.fetch(input, init?)` -- HTTP fetch with context propagation

**Properties:**

- `this.metadata` -- prompt metadata from the decorator
- `this.scope` -- the current scope instance
- `this.context` -- the execution context

## Multi-Turn Conversations

Use `assistant` role messages to prime the conversation with expected response patterns:

```typescript
@Prompt({
  name: 'debug-session',
  description: 'Start a structured debugging session',
  arguments: [
    { name: 'error', description: 'The error message or stack trace', required: true },
    { name: 'context', description: 'Additional context about what was happening', required: false },
  ],
})
class DebugSessionPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const contextNote = args.context ? `\n\nAdditional context: ${args.context}` : '';

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `I encountered an error and need help debugging it.\n\nError:\n\`\`\`\n${args.error}\n\`\`\`${contextNote}`,
          },
        },
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: "I'll help you debug this. Let me analyze the error systematically.\n\n**Step 1: Error Classification**\nLet me first identify what type of error this is and its likely root cause.\n\n",
          },
        },
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Please continue with your analysis and suggest specific fixes.',
          },
        },
      ],
    };
  }
}
```

## Dynamic Prompt Generation

Prompts can perform async operations to generate context-aware messages. Use `this.get()` for dependency injection and `this.fetch()` for HTTP requests.

```typescript
import type { Token } from '@frontmcp/di';

interface KnowledgeBase {
  search(query: string, limit: number): Promise<Array<{ title: string; content: string }>>;
}
const KNOWLEDGE_BASE: Token<KnowledgeBase> = Symbol('knowledge-base');

@Prompt({
  name: 'rag-query',
  description: 'Answer a question using knowledge base context',
  arguments: [
    { name: 'question', description: 'The question to answer', required: true },
    { name: 'maxSources', description: 'Maximum number of sources to include', required: false },
  ],
})
class RagQueryPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const kb = this.get(KNOWLEDGE_BASE);
    const maxSources = parseInt(args.maxSources ?? '3', 10);
    const sources = await kb.search(args.question, maxSources);

    const contextBlock = sources.map((s, i) => `### Source ${i + 1}: ${s.title}\n${s.content}`).join('\n\n');

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Answer the following question using only the provided sources. If the sources do not contain enough information, say so clearly.\n\n**Question:** ${args.question}\n\n---\n\n${contextBlock}`,
          },
        },
      ],
    };
  }
}
```

## Embedding Resources in Prompts

Include MCP resource content directly in prompt messages using the `resource` content type:

```typescript
@Prompt({
  name: 'analyze-config',
  description: 'Analyze application configuration and suggest improvements',
  arguments: [{ name: 'configUri', description: 'URI of the config resource to analyze', required: true }],
})
class AnalyzeConfigPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'resource',
            resource: {
              uri: args.configUri,
              mimeType: 'application/json',
              text: '(resource content will be resolved by the client)',
            },
          },
        },
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Analyze the configuration above. Identify potential issues, security concerns, and suggest improvements.',
          },
        },
      ],
    };
  }
}
```

## Function-Style Builder

For simple prompts that do not need a class, use the `prompt()` function builder:

```typescript
import { prompt } from '@frontmcp/sdk';
import { GetPromptResult } from '@frontmcp/protocol';

const TranslatePrompt = prompt({
  name: 'translate',
  description: 'Translate text between languages',
  arguments: [
    { name: 'text', description: 'Text to translate', required: true },
    { name: 'from', description: 'Source language', required: true },
    { name: 'to', description: 'Target language', required: true },
  ],
})(
  (args): GetPromptResult => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Translate the following text from ${args?.from} to ${args?.to}. Provide only the translation, no explanations.\n\nText: ${args?.text}`,
        },
      },
    ],
  }),
);
```

Register it the same way as a class prompt: `prompts: [TranslatePrompt]`.

## Error Handling

Use `this.fail()` to abort prompt execution. Missing required arguments are caught automatically before `execute()` runs.

```typescript
@Prompt({
  name: 'generate-tests',
  description: 'Generate test cases for a function',
  arguments: [
    { name: 'functionCode', description: 'The function to test', required: true },
    { name: 'framework', description: 'Test framework (jest, mocha, vitest)', required: true },
  ],
})
class GenerateTestsPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const validFrameworks = ['jest', 'mocha', 'vitest'];
    if (!validFrameworks.includes(args.framework)) {
      this.fail(new Error(`Unsupported test framework: "${args.framework}". Supported: ${validFrameworks.join(', ')}`));
    }

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Write comprehensive ${args.framework} test cases for the following function. Include edge cases, error handling, and boundary conditions.\n\n\`\`\`\n${args.functionCode}\n\`\`\``,
          },
        },
      ],
    };
  }
}
```

## Stage Tracking

Use `this.mark()` for debugging and observability in complex prompts:

```typescript
@Prompt({
  name: 'research-report',
  description: 'Generate a structured research report prompt',
  arguments: [
    { name: 'topic', description: 'Research topic', required: true },
    { name: 'depth', description: 'Report depth: brief, standard, or comprehensive', required: false },
  ],
})
class ResearchReportPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    this.mark('build-outline');
    const depth = args.depth ?? 'standard';
    const outline = this.buildOutline(depth);

    this.mark('compose-messages');
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Write a ${depth} research report on "${args.topic}".\n\nFollow this structure:\n${outline}\n\nInclude citations where possible and maintain an objective, academic tone.`,
          },
        },
      ],
    };
  }

  private buildOutline(depth: string): string {
    const sections = ['Introduction', 'Background', 'Key Findings'];
    if (depth === 'standard' || depth === 'comprehensive') {
      sections.push('Analysis', 'Discussion');
    }
    if (depth === 'comprehensive') {
      sections.push('Methodology', 'Limitations', 'Future Research');
    }
    sections.push('Conclusion');
    return sections.map((s, i) => `${i + 1}. ${s}`).join('\n');
  }
}
```

## Registration

Add prompt classes (or function-style prompts) to the `prompts` array in `@App`.

```typescript
import { FrontMcp, App } from '@frontmcp/sdk';

@App({
  name: 'my-app',
  prompts: [CodeReviewPrompt, DebugSessionPrompt, TranslatePrompt],
})
class MyApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
})
class MyServer {}
```

## Nx Generator

Scaffold a new prompt using the Nx generator:

```bash
nx generate @frontmcp/nx:prompt
```

This creates the prompt file, spec file, and updates barrel exports.

## Common Patterns

| Pattern             | Correct                                                           | Incorrect                                           | Why                                                                   |
| ------------------- | ----------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| Return type         | `execute()` returns `Promise<GetPromptResult>`                    | Returning a plain string or array of strings        | MCP protocol requires `{ messages: [...] }` structure                 |
| Argument validation | Mark arguments as `required: true` in `arguments` array           | Manually checking `args.field` inside `execute()`   | Framework validates required arguments before `execute()` runs        |
| Multi-turn priming  | Use `assistant` role messages to prime expected response patterns | Putting all instructions in a single `user` message | Alternating roles guides the LLM toward structured output             |
| Resource embedding  | Use `type: 'resource'` content with a resource URI                | Inlining resource data as raw text in the prompt    | Resource references let clients resolve content dynamically           |
| Error handling      | Use `this.fail(err)` for validation failures in execute           | `throw new Error(...)` directly                     | `this.fail` triggers the error flow with proper MCP error propagation |

## Verification Checklist

### Configuration

- [ ] Prompt class extends `PromptContext` and implements `execute(args)`
- [ ] `@Prompt` decorator has `name` and `arguments` array with correct `required` flags
- [ ] Prompt is registered in `prompts` array of `@App` or `@FrontMcp`
- [ ] All required arguments have `required: true`

### Runtime

- [ ] Prompt appears in `prompts/list` MCP response
- [ ] Calling prompt with valid arguments returns well-formed `GetPromptResult`
- [ ] Missing required arguments trigger `MissingPromptArgumentError`
- [ ] Multi-turn messages have correct `user`/`assistant` role alternation
- [ ] DI dependencies resolve correctly via `this.get()`

## Troubleshooting

| Problem                                           | Cause                                               | Solution                                                                                  |
| ------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Prompt not appearing in `prompts/list`            | Not registered in `prompts` array                   | Add prompt class to `@App` or `@FrontMcp` `prompts` array                                 |
| `MissingPromptArgumentError` on optional argument | Argument marked `required: true` incorrectly        | Set `required: false` for optional arguments in the `arguments` array                     |
| LLM ignores priming messages                      | Only using `user` role messages                     | Add `assistant` role messages to prime the conversation pattern                           |
| Type error on `execute()` return                  | Returning plain string instead of `GetPromptResult` | Wrap return in `{ messages: [{ role: 'user', content: { type: 'text', text: '...' } }] }` |
| `this.get(TOKEN)` throws DependencyNotFoundError  | Provider not registered in scope                    | Register provider in `providers` array of `@App` or `@FrontMcp`                           |

## Examples

| Example                                                                             | Level        | Description                                                                                          |
| ----------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| [`basic-prompt`](../examples/create-prompt/basic-prompt.md)                         | Basic        | A simple prompt that generates a structured code review message from user-provided arguments.        |
| [`dynamic-rag-prompt`](../examples/create-prompt/dynamic-rag-prompt.md)             | Advanced     | A prompt that queries a knowledge base via DI to build context-aware messages at runtime.            |
| [`multi-turn-debug-session`](../examples/create-prompt/multi-turn-debug-session.md) | Intermediate | A prompt that uses alternating user/assistant messages to guide a structured debugging conversation. |

> See all examples in [`examples/create-prompt/`](../examples/create-prompt/)

## Reference

- [Prompts Documentation](https://docs.agentfront.dev/frontmcp/servers/prompts)
- Related skills: `create-tool`, `create-resource`, `create-agent`, `create-provider`
