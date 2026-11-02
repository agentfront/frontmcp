import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { randomUUID, rm, writeFile } from '@frontmcp/utils';

import { App, LogLevel, Skill, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { buildManifest } from '../build-manifest';

@Tool({ name: 'list_orders', description: 'List orders', inputSchema: {}, authorities: 'admin' })
class ListOrdersTool extends ToolContext {
  async execute() {
    return 'orders';
  }
}

@Tool({
  name: 'chart',
  description: 'Draw a chart',
  inputSchema: {},
  ui: { template: '<div>chart</div>' },
  execution: { taskSupport: 'optional' },
  examples: [{ description: 'An empty chart', input: {} }],
})
class ChartTool extends ToolContext {
  async execute() {
    return 'chart';
  }
}

@Skill({ name: 'lost-runbook', description: 'Its file is gone', instructions: { file: './no-such-runbook.md' } })
class LostRunbookSkill {}

@App({ id: 'orders', name: 'Orders', tools: [ListOrdersTool], skills: [LostRunbookSkill] })
class OrdersApp {}

@App({ id: 'ops', name: 'Ops', tools: [ChartTool] })
class OpsApp {}

const splitConfig: FrontMcpConfigInput = {
  info: { name: 'split-manifest', version: '1.0.0' },
  apps: [OrdersApp, OpsApp],
  splitByApp: true,
  authorities: { profiles: { admin: { roles: { any: ['admin'] } } } },
  logging: { level: LogLevel.Off },
};

describe('buildManifest() across scopes', () => {
  it('lists the entries of every app scope of a splitByApp server once, each with its app', async () => {
    const manifest = await buildManifest(splitConfig);

    expect(manifest.apps.map((app) => app.id)).toEqual(['ops', 'orders']);
    const userTools = manifest.tools.filter((tool) => tool.app !== undefined);
    expect(userTools.map((tool) => [tool.name, tool.app])).toEqual([
      ['chart', 'ops'],
      ['list_orders', 'orders'],
    ]);
  });

  it('flags authorities and widgets, and keeps execution hints and examples', async () => {
    const manifest = await buildManifest(splitConfig);
    const byName = new Map(manifest.tools.map((tool) => [tool.name, tool]));

    expect(byName.get('list_orders')).toEqual(expect.objectContaining({ authorities: true }));
    expect(byName.get('chart')).toEqual(
      expect.objectContaining({
        ui: true,
        execution: { taskSupport: 'optional' },
        examples: [{ description: 'An empty chart', input: {} }],
      }),
    );
  });

  it('leaves out the hash of a skill whose instructions cannot be loaded', async () => {
    const manifest = await buildManifest(splitConfig);
    const lost = manifest.skills.find((skill) => skill.name === 'lost-runbook');

    expect(lost).toEqual(expect.objectContaining({ app: 'orders', description: 'Its file is gone' }));
    expect(lost).not.toHaveProperty('hash');
  });

  it('gives a skill the same hash whether its file has LF or CRLF line endings', async () => {
    const runbookFile = path.join(os.tmpdir(), `frontmcp-runbook-${randomUUID()}.md`);

    @Skill({ name: 'runbook', description: 'Restart the service', instructions: { file: runbookFile } })
    class RunbookSkill {}

    @App({ id: 'runbooks', name: 'Runbooks', skills: [RunbookSkill] })
    class RunbooksApp {}

    const hashOf = async (lineEnding: string) => {
      await writeFile(runbookFile, ['# Restart', '', 'Drain, then restart.', ''].join(lineEnding));
      const manifest = await buildManifest({
        info: { name: 'runbook-manifest', version: '1.0.0' },
        apps: [RunbooksApp],
        logging: { level: LogLevel.Off },
      });
      return manifest.skills[0].hash;
    };
    try {
      const lf = await hashOf('\n');
      expect(lf).toMatch(/^[0-9a-f]{64}$/);
      expect(await hashOf('\r\n')).toBe(lf);
    } finally {
      await rm(runbookFile, { force: true });
    }
  });

  it('sends no instructions field when the server has none to send', async () => {
    const manifest = await buildManifest({
      info: { name: 'quiet-manifest', version: '1.0.0' },
      apps: [OpsApp],
      logging: { level: LogLevel.Off },
    });

    expect(manifest.server).toEqual({ name: 'quiet-manifest', version: '1.0.0' });
  });
});
