import 'reflect-metadata';

import { Tool, ToolContext } from '@frontmcp/sdk';

import { getFeatureFlags, tryGetFeatureFlags } from '../../feature-flag.context-extension';

@Tool({ name: 'feature-flags-helpers', inputSchema: {} })
export class HelpersInToolContext extends ToolContext {
  async execute() {
    return { found: [getFeatureFlags(this), tryGetFeatureFlags(this)].every((accessor) => accessor !== undefined) };
  }
}
