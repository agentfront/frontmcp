---
name: basic-prompt
reference: create-prompt
level: basic
description: 'A simple prompt that generates a structured code review message from user-provided arguments.'
tags: [development, prompt, create-prompt]
features:
  - 'Extending `PromptContext` and implementing `execute(args)` returning `GetPromptResult`'
  - 'Declaring prompt `arguments` with `required: true` for mandatory parameters'
  - 'Framework validates required arguments before `execute()` runs'
  - 'Registering the prompt in the `prompts` array of `@App`'
---

# Basic Prompt with Arguments

A simple prompt that generates a structured code review message from user-provided arguments.

## Code

```typescript
// src/apps/main/prompts/code-review.prompt.ts
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

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

@App({
  name: 'main',
  prompts: [CodeReviewPrompt],
})
class MainApp {}
```

## What This Demonstrates

- Extending `PromptContext` and implementing `execute(args)` returning `GetPromptResult`
- Declaring prompt `arguments` with `required: true` for mandatory parameters
- Framework validates required arguments before `execute()` runs
- Registering the prompt in the `prompts` array of `@App`

## Related

- See `create-prompt` for multi-turn conversations, resource embedding, and function-style builders
