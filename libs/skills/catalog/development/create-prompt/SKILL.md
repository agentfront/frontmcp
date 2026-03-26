---
name: create-prompt
description: Create MCP prompts for reusable AI interaction patterns. Use when building prompts, defining prompt arguments, or creating conversation templates.
tags: [prompts, mcp, templates, messages, decorator]
tools:
  - name: create_prompt
    purpose: Scaffold a new prompt class
parameters:
  - name: name
    description: Prompt name in kebab-case
    type: string
    required: true
examples:
  - scenario: Create a code review prompt with language argument
    expected-outcome: Prompt registered and callable via MCP
  - scenario: Create a multi-turn debugging prompt with assistant priming
    expected-outcome: Prompt producing structured message sequences
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/servers/prompts
---

# Creating MCP Prompts

Prompts define reusable AI interaction patterns in the MCP protocol. They produce structured message sequences that clients use to guide LLM conversations. In FrontMCP, prompts are classes extending `PromptContext`, decorated with `@Prompt`, that return `GetPromptResult` objects.

## When to Use @Prompt

Use `@Prompt` when you need to expose a reusable conversation template that an AI client can invoke with arguments. Prompts are ideal for code review patterns, debugging sessions, RAG queries, report generation, translation workflows, and any scenario where you want a standardized message structure.

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
- `description` (optional) -- human-readable description
- `arguments` (optional) -- array of `PromptArgument` objects

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
