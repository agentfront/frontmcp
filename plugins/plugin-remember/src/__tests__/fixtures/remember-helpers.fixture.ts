import 'reflect-metadata';

import { Tool, ToolContext } from '@frontmcp/sdk';

import { getRemember, tryGetRemember } from '../../remember.context-extension';

@Tool({ name: 'remember-helpers', inputSchema: {} })
export class HelpersInToolContext extends ToolContext {
  async execute() {
    return { found: [getRemember(this), tryGetRemember(this)].every((accessor) => accessor !== undefined) };
  }
}
