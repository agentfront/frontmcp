/** A flagged-off UI tool is not suggested by `ui://widget/{toolName}` completion (#596). */
import 'reflect-metadata';

import { App, connect, LogLevel, Tool, ToolContext, type DirectClient } from '@frontmcp/sdk';

import FeatureFlagPlugin from '../feature-flag.plugin';

const WIDGET = { template: '<div id="widget"></div>' };

@Tool({ name: 'enabled_widget', inputSchema: {}, ui: WIDGET, featureFlag: 'flag-on' })
class EnabledWidgetTool extends ToolContext {
  async execute() {
    return { ran: 'enabled_widget' };
  }
}

@Tool({ name: 'disabled_widget', inputSchema: {}, ui: WIDGET, featureFlag: 'flag-off' })
class DisabledWidgetTool extends ToolContext {
  async execute() {
    return { ran: 'disabled_widget' };
  }
}

@Tool({ name: 'unflagged_widget', inputSchema: {}, ui: WIDGET })
class UnflaggedWidgetTool extends ToolContext {
  async execute() {
    return { ran: 'unflagged_widget' };
  }
}

@App({
  id: 'widgets',
  name: 'Widgets',
  plugins: [FeatureFlagPlugin.init({ adapter: 'static', flags: { 'flag-on': true, 'flag-off': false } })],
  tools: [EnabledWidgetTool, DisabledWidgetTool, UnflaggedWidgetTool],
})
class WidgetsApp {}

describe('FeatureFlagPlugin on ui://widget/{toolName} completion (#596)', () => {
  let client: DirectClient;

  async function completeToolName(value: string): Promise<string[]> {
    const { completion } = await client.complete({
      ref: { type: 'ref/resource', uri: 'ui://widget/{toolName}.html' },
      argument: { name: 'toolName', value },
    });
    return completion.values;
  }

  beforeAll(async () => {
    client = await connect({
      info: { name: 'feature-flag-widget-completion', version: '1.0.0' },
      apps: [WidgetsApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it('does not suggest a UI tool whose flag is off', async () => {
    expect(await completeToolName('')).not.toContain('disabled_widget');
    expect(await completeToolName('disabled')).toEqual([]);
  });

  it('suggests UI tools whose flag is on and UI tools without a flag', async () => {
    expect((await completeToolName('')).sort()).toEqual(['enabled_widget', 'unflagged_widget']);
  });
});
