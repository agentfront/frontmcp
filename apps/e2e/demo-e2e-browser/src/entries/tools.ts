import { z } from 'zod';
import { Tool, ToolContext } from '@frontmcp/react';

// ─── Greet Tool ──────────────────────────────────────────────────────────────

const greetInput = z.object({
  name: z.string().describe('Name of the person to greet'),
});

@Tool({
  name: 'greet',
  description: 'Greet a person by name',
  inputSchema: greetInput,
})
export class GreetTool extends ToolContext<typeof greetInput> {
  async execute(input: z.infer<typeof greetInput>) {
    return `Hello, ${input.name}! Welcome to FrontMCP in the browser.`;
  }
}

// ─── Calculate Tool ──────────────────────────────────────────────────────────

const calculateInput = z.object({
  operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('Math operation'),
  a: z.number().describe('First number'),
  b: z.number().describe('Second number'),
});

@Tool({
  name: 'calculate',
  description: 'Perform a math operation on two numbers',
  inputSchema: calculateInput,
})
export class CalculateTool extends ToolContext<typeof calculateInput> {
  async execute(input: z.infer<typeof calculateInput>) {
    const { operation, a, b } = input;
    let result: number;
    switch (operation) {
      case 'add':
        result = a + b;
        break;
      case 'subtract':
        result = a - b;
        break;
      case 'multiply':
        result = a * b;
        break;
      case 'divide':
        if (b === 0) throw new Error('Division by zero');
        result = a / b;
        break;
    }
    return `${a} ${operation} ${b} = ${result}`;
  }
}

// ─── Random Number Tool ──────────────────────────────────────────────────────

const randomNumberInput = z.object({
  min: z.number().int().describe('Minimum value (inclusive)'),
  max: z.number().int().describe('Maximum value (inclusive)'),
});

@Tool({
  name: 'random_number',
  description: 'Generate a random integer within a range',
  inputSchema: randomNumberInput,
})
export class RandomNumberTool extends ToolContext<typeof randomNumberInput> {
  async execute(input: z.infer<typeof randomNumberInput>) {
    const { min, max } = input;
    if (min > max) throw new Error('min must be <= max');
    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    return `Random number between ${min} and ${max}: ${result}`;
  }
}
