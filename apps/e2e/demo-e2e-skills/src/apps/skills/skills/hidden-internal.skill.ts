import { Skill } from '@frontmcp/sdk';

/**
 * Hidden Internal Skill - for testing hideFromDiscovery
 */
@Skill({
  name: 'hidden-internal',
  description: 'Internal skill for system operations',
  instructions: 'This skill is for internal use only and should not appear in search results.',
  hideFromDiscovery: true,
})
export class HiddenSkill {}
