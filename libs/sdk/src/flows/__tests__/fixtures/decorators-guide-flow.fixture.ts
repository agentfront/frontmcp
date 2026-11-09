import { Flow, FlowBase, FlowHooksOf, z, type FlowPlan, type FlowRunOptions } from '../../../index';

const name = 'approval-flow' as const;
const inputSchema = z.object({ action: z.string(), target: z.string() });
const outputSchema = z.object({ approved: z.boolean() });
const stateSchema = z.object({ approved: z.boolean() });
const plan = { pre: ['validate'], execute: ['approve'], finalize: ['finalize'] } as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    [name]: FlowRunOptions<ApprovalFlow, typeof plan, typeof inputSchema, typeof outputSchema, typeof stateSchema>;
  }
}

const { Stage } = FlowHooksOf<typeof name>(name);

@Flow({ name, plan, inputSchema, outputSchema, access: 'authorized' })
export default class ApprovalFlow extends FlowBase<typeof name> {
  @Stage('validate')
  async validate() {
    if (!this.rawInput.target) throw new Error('target is required');
  }

  @Stage('approve')
  async approve() {
    this.state.set('approved', this.rawInput.action !== 'delete');
  }

  @Stage('finalize')
  async finalize() {
    if (this.state.approved === undefined) return;
    this.respond({ approved: this.state.approved });
  }
}
