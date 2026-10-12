import 'reflect-metadata';

import { getConfig, tryGetConfig } from '../..';
import { Tool, ToolContext } from '../../../../index';

@Tool({ name: 'config-helpers', inputSchema: {} })
export class HelpersInToolContext extends ToolContext {
  async execute() {
    return { found: [getConfig(this), tryGetConfig(this)].every((accessor) => accessor !== undefined) };
  }
}
