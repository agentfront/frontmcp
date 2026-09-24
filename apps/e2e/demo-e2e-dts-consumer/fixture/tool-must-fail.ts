import 'reflect-metadata';

import { Agent, Tool, ToolContext, z } from '@frontmcp/sdk';

type IsAny<T> = 0 extends 1 & T ? true : false;

// @ts-expect-error typeof Tool must not be any
export const toolDecoratorIsAny: IsAny<typeof Tool> = true;

// @ts-expect-error typeof Agent must not be any
export const agentDecoratorIsAny: IsAny<typeof Agent> = true;

// @ts-expect-error execute() parameter contradicts inputSchema
@Tool({ name: 'add', inputSchema: { a: z.number(), b: z.number() } })
export class Add extends ToolContext {
  async execute(input: { a: string }) {
    return input.a;
  }
}

// @ts-expect-error the decorated class does not extend ToolContext
@Tool({ name: 'plain', inputSchema: {} })
export class NotATool {
  async execute() {
    return 1;
  }
}

// @ts-expect-error execute() return value contradicts outputSchema
@Tool({ name: 'total', inputSchema: {}, outputSchema: { total: z.number() } })
export class Total extends ToolContext {
  async execute() {
    return { total: '12.50 EUR' };
  }
}
