/**
 * @file tools-only-package.ts
 * @description ESM fixture with only @Tool decorated classes as named exports.
 * The ESM loader detects decorated classes automatically — no manifest needed.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'multiply',
  description: 'Multiplies two numbers',
  inputSchema: {
    x: z.number().describe('First number'),
    y: z.number().describe('Second number'),
  },
})
export class MultiplyTool extends ToolContext {
  async execute({ x, y }: { x: number; y: number }) {
    return x * y;
  }
}

@Tool({
  name: 'uppercase',
  description: 'Converts text to uppercase',
  inputSchema: { text: z.string() },
})
export class UppercaseTool extends ToolContext {
  async execute({ text }: { text: string }) {
    return text.toUpperCase();
  }
}
