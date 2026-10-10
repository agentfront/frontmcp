import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext, ToolHook, UnauthorizedError, type FlowCtxOf } from '@frontmcp/sdk';

const inputSchema = {
  message: z.string().describe('Message to echo'),
  user: z.string().describe('Who is calling'),
};

const outputSchema = z.object({ echoed: z.string() });

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

/**
 * A tool whose own class hooks the stages before its instance exists, as `static` methods (#701).
 * They run for this tool only: `plain-echo` takes the same input and is left alone.
 */
@Tool({
  name: 'static-guarded-echo',
  description: 'Echoes a message; its static hooks upper-case the message and refuse the "blocked" user',
  inputSchema,
  outputSchema,
})
export class StaticGuardedEchoTool extends ToolContext {
  /** Rewrites the arguments before the tool is looked up. */
  @ToolHook.Did('parseInput')
  static shout(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const input = flowCtx.state.required.input;
    const args = input.arguments ?? {};
    flowCtx.state.set('input', { ...input, arguments: { ...args, message: String(args['message']).toUpperCase() } });
  }

  /** Refuses one caller before the tool's instance is built. */
  @ToolHook.Will('checkToolAuthorization')
  static refuseBlocked(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    if (flowCtx.state.input?.arguments?.['user'] === 'blocked') {
      throw new UnauthorizedError('static-guarded-echo refuses the "blocked" user');
    }
  }

  async execute(input: Input): Promise<Output> {
    return { echoed: input.message };
  }
}

/** The same input with no hooks of its own. */
@Tool({
  name: 'plain-echo',
  description: 'Echoes a message as given',
  inputSchema,
  outputSchema,
})
export class PlainEchoTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { echoed: input.message };
  }
}
