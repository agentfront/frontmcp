/**
 * @file decorated-package.ts
 * @description A real TypeScript ESM package fixture that uses actual decorators
 * from @frontmcp/sdk for all core components. This file is transpiled with esbuild
 * (all deps externalized) and served by the ESM package server as @test/esm-decorated@1.0.0.
 *
 * Uses named exports — the ESM loader scans all exports and detects decorated classes
 * by their decorator metadata, grouping them into the appropriate manifest arrays.
 *
 * Components:
 * - 2 Tools: echo, add
 * - 1 Resource: status
 * - 1 Prompt: greeting-prompt
 * - 1 Skill: review-code (inline instructions)
 * - 1 Job: process-data (input/output schemas)
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import {
  Job,
  JobContext,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  Skill,
  Tool,
  ToolContext,
} from '@frontmcp/sdk';

// ═══════════════════════════════════════════════════════════════════
// TOOLS
// ═══════════════════════════════════════════════════════════════════

@Tool({
  name: 'echo',
  description: 'Echoes the input message back',
  inputSchema: { message: z.string() },
})
export class EchoTool extends ToolContext {
  async execute({ message }: { message: string }) {
    return message;
  }
}

@Tool({
  name: 'add',
  description: 'Adds two numbers together',
  inputSchema: {
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
  },
})
export class AddTool extends ToolContext {
  async execute({ a, b }: { a: number; b: number }) {
    return a + b;
  }
}

// ═══════════════════════════════════════════════════════════════════
// RESOURCES
// ═══════════════════════════════════════════════════════════════════

@Resource({
  name: 'status',
  uri: 'esm://status',
  mimeType: 'application/json',
  description: 'Server status from decorated package',
})
export class StatusResource extends ResourceContext {
  async execute(uri: string) {
    return {
      contents: [
        {
          uri,
          text: JSON.stringify({ status: 'ok', source: 'decorated-package' }),
        },
      ],
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════

@Prompt({
  name: 'greeting-prompt',
  description: 'A greeting prompt template',
  arguments: [{ name: 'name', description: 'Name to greet', required: true }],
})
export class GreetingPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    return {
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Please greet ${args?.['name'] ?? 'someone'} warmly.`,
          },
        },
      ],
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// SKILLS
// ═══════════════════════════════════════════════════════════════════

@Skill({
  name: 'review-code',
  description: 'Reviews code for best practices and issues',
  instructions: 'Step 1: Read the code file.\nStep 2: Check for common issues.\nStep 3: Suggest improvements.',
  tools: ['file_read', 'code_search'],
  tags: ['code-review', 'quality'],
})
export class ReviewCodeSkill {}

// ═══════════════════════════════════════════════════════════════════
// JOBS
// ═══════════════════════════════════════════════════════════════════

@Job({
  name: 'process-data',
  description: 'Processes an array of items and returns a count',
  inputSchema: {
    items: z.array(z.string()).describe('Items to process'),
  },
  outputSchema: {
    processed: z.number().describe('Number of items processed'),
  },
})
export class ProcessDataJob extends JobContext {
  async execute({ items }: { items: string[] }) {
    return { processed: items.length };
  }
}
