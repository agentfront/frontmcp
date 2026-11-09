import { Flow, FlowBase, FlowHooksOf, z, type FlowPlan, type FlowRunOptions } from '../../../index';

const name = 'unscoped-flow' as const;
const inputSchema = z.object({});
const outputSchema = z.object({ done: z.boolean() });
const stateSchema = z.object({});
const plan = { execute: ['finish'] } as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    [name]: FlowRunOptions<UnscopedFlow, typeof plan, typeof inputSchema, typeof outputSchema, typeof stateSchema>;
  }
}

const { Stage } = FlowHooksOf<typeof name>(name);

// @ts-expect-error `access` is required: every flow says who it runs for
@Flow({ name, plan, inputSchema, outputSchema })
export default class UnscopedFlow extends FlowBase<typeof name> {
  @Stage('finish')
  async finish() {
    this.respond({ done: true });
  }
}
