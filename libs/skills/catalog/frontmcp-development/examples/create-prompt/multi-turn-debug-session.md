---
name: multi-turn-debug-session
reference: create-prompt
level: intermediate
description: 'A prompt that uses alternating user/assistant messages to guide a structured debugging conversation.'
tags: [development, session, prompt, multi, turn, debug]
features:
  - 'Using `assistant` role messages to prime expected response patterns and guide LLM behavior'
  - 'Alternating `user` and `assistant` roles to create a structured multi-turn conversation'
  - 'Optional arguments that conditionally add content to the prompt'
  - 'The assistant message establishes a systematic debugging approach the LLM will follow'
---

# Multi-Turn Debug Session Prompt

A prompt that uses alternating user/assistant messages to guide a structured debugging conversation.

## Code

```typescript
// src/apps/main/prompts/debug-session.prompt.ts
import { Prompt, PromptContext } from '@frontmcp/sdk';
import { GetPromptResult } from '@frontmcp/protocol';

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

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

@App({
  name: 'main',
  prompts: [DebugSessionPrompt],
})
class MainApp {}
```

## What This Demonstrates

- Using `assistant` role messages to prime expected response patterns and guide LLM behavior
- Alternating `user` and `assistant` roles to create a structured multi-turn conversation
- Optional arguments that conditionally add content to the prompt
- The assistant message establishes a systematic debugging approach the LLM will follow

## Related

- See `create-prompt` for dynamic prompt generation with DI, resource embedding, and error handling
