import { Skill } from '@frontmcp/sdk';

@Skill({
  name: 'enabled-workflow',
  description: 'Skill gated behind a feature flag (enabled)',
  instructions: 'Enabled workflow steps.',
  featureFlag: 'flag-for-skill',
})
export class EnabledWorkflowSkill {}

@Skill({
  name: 'hidden-workflow',
  description: 'Skill gated behind a feature flag (disabled)',
  instructions: 'Hidden workflow steps that should never reach a client.',
  featureFlag: 'flag-for-hidden-skill',
})
export class HiddenWorkflowSkill {}
