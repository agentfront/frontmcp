import {Tool, ToolContext, ToolInterface} from '@frontmcp/sdk';
import {SessionRedisProvider} from '../provders';
import z from 'zod';


const inputSchema = {
  id: z.string().describe('The expense\'s id'),
};
const outputSchema = {
  ok: z.string(),
};

type In = z.baseObjectInputType<typeof inputSchema> & { value?: string };
type Out = z.baseObjectOutputType<typeof outputSchema>;

@Tool({
  name: 'createExpense',
  description: 'Create an expense',
  inputSchema,
  outputSchema,
  cache: {
    ttl: 1000,
    slideWindow: true,
  },
})
export default class CreateExpenseTool implements ToolInterface<In, Out> {

  async execute(input: In, ctx: ToolContext<In, Out>): Promise<Out> {
    const red = ctx.get(SessionRedisProvider);
    await red.setValue('expense-id', input.id);

    return {
      ok: 'secret',
    };
  }

  // @WillParseInput()
  // async tracing1(ctx: ToolInvokeContext<In, Out>) {
  //   ctx.data.set('latencyMs', Date.now());
  //   console.log('parse', ctx.input);
  //   ctx.input = { ...ctx.input, value: 'david' };
  // }
  //
  // @WillParseInput()
  // async tracing2(ctx: ToolInvokeContext<In, Out>) {
  //   ctx.data.set('latencyMs', Date.now());
  //   console.log('parse', ctx.input);
  //   ctx.input = { ...ctx.input, value: 'david' };
  // }
  //
  // @WillValidateInput({ filter: 'onlyWhenExpenseFlagOn' })
  // validateInput(ctx: ToolInvokeContext<In, Out>) {
  //   console.log('validateInput', ctx.input);
  // }
  //
  // @OnMetrics()
  // async metrics(ctx: ToolInvokeContext<In, Out>) {
  //   const t0 = ctx.data.get('latencyMs') as number | undefined;
  //   if (t0) {
  //     const latencyMs = Date.now() - t0;
  //     console.log('metrics', latencyMs, 'ms');
  //   }
  // }

}
