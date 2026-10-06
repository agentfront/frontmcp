/**
 * A tool's `icons` and `_meta` reach `tools/list` (#722), and a tool's `ui` configuration adds its
 * own `ui` keys to the `_meta` it declares instead of replacing it.
 */
import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../../common';

interface ListedTool {
  name: string;
  icons?: unknown[];
  _meta?: Record<string, unknown>;
}

const ICON = { src: 'https://example.com/report.png', mimeType: 'image/png' };

@Tool({ name: 'report', inputSchema: {}, icons: [ICON], _meta: { 'com.example/owner': 'billing' } })
class ReportTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

@Tool({
  name: 'chart',
  inputSchema: {},
  _meta: { 'com.example/owner': 'analytics' },
  ui: { template: () => '<div>chart</div>' },
})
class ChartTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

@Tool({ name: 'plain', inputSchema: {} })
class PlainTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

@App({ id: 'desk', name: 'Desk', tools: [ReportTool, ChartTool, PlainTool] })
class DeskApp {}

describe('tools/list icons and _meta (#722)', () => {
  let listedTools: Map<string, ListedTool>;

  beforeAll(async () => {
    const server: TestFetchServer = await createTestFetchServer({
      info: { name: 'tools-list-icons-meta', version: '1.0.0' },
      apps: [DeskApp],
    });
    const { message } = await rpc20260728(server.handler, 'tools/list');
    const tools = (message as { result: { tools: ListedTool[] } }).result.tools;
    listedTools = new Map(tools.map((listed) => [listed.name, listed]));
  });

  it('lists the icons and _meta a tool declares', () => {
    expect(listedTools.get('report')).toMatchObject({ icons: [ICON], _meta: { 'com.example/owner': 'billing' } });
  });

  it('keeps the declared _meta next to the ui keys a ui tool adds', () => {
    const meta = listedTools.get('chart')?._meta;

    expect(meta).toMatchObject({ 'com.example/owner': 'analytics' });
    expect(meta).toHaveProperty('ui');
  });

  it('lists neither for a tool that declares none', () => {
    expect(listedTools.get('plain')).not.toHaveProperty('icons');
    expect(listedTools.get('plain')).not.toHaveProperty('_meta');
  });
});
