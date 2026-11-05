// The e2e config with a skills:filter hook that hides the reports skill from a caller on the free plan (e2e/skill-filter.e2e.spec.ts).
import { DynamicPlugin, FlowHooksOf, FrontMcp, FrontMcpContextStorage, Plugin, type FlowCtxOf } from '@frontmcp/sdk';

import { serverConfig } from './config';

const port = parseInt(process.env['PORT'] ?? '3107', 10);

// `FrontMcpMetadata` is not exported from the SDK barrel; the decorator's parameter type stands in for it.
type FrontMcpInput = Parameters<typeof FrontMcp>[0];

const FilterSkillsHook = FlowHooksOf('skills:filter');

/** Hides the reports skill from a caller whose token puts it on the free plan, as a plan or feature-flag check does. */
@Plugin({ name: 'plan-gate' })
class PlanGatePlugin extends DynamicPlugin<Record<string, never>> {
  @FilterSkillsHook.Did('filterSkills')
  hideReportsFromFreePlan(flowCtx: FlowCtxOf<'skills:filter'>) {
    const user = this.get(FrontMcpContextStorage).getStore()?.authInfo?.user as { plan?: string } | undefined;
    if (user?.plan !== 'free') return;
    const skills = flowCtx.state.required.skills;
    flowCtx.state.set(
      'skills',
      skills.filter((skill) => (skill.metadata.id ?? skill.name) !== 'reports'),
    );
  }
}

@FrontMcp({
  ...serverConfig,
  plugins: [...serverConfig.plugins, PlanGatePlugin],
  http: { port },
} as unknown as FrontMcpInput)
export default class SkillFilterServer {}
