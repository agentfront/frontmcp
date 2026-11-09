/**
 * Job and workflow options the schemas accept and nothing reads: a workflow's `trigger: 'webhook'` (or `'event'`)
 * and `webhook`, and permission rules for `create` and `update`. Startup warns about each.
 */
import 'reflect-metadata';

import {
  App,
  Job,
  JobContext,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Workflow,
  type LogRecord,
} from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { describeIgnoredTrigger, describeUncheckedPermissions } from '../unread-job-options';

describe('describeUncheckedPermissions', () => {
  it('says nothing about rules every operation checks', () => {
    expect(
      describeUncheckedPermissions('Job', 'export', [
        { action: 'execute', roles: ['admin'] },
        { action: 'read' },
        { action: 'delete' },
        { action: 'list' },
      ]),
    ).toEqual([]);
    expect(describeUncheckedPermissions('Job', 'export', undefined)).toEqual([]);
  });

  it('names the create and update rules of a job, in one message', () => {
    const messages = describeUncheckedPermissions('Job', 'export', [
      { action: 'update', roles: ['admin'] },
      { action: 'execute', roles: ['admin'] },
      { action: 'create', roles: ['admin'] },
    ]);

    expect(messages).toEqual([
      expect.stringMatching(/^Job "export": its permission rules for "create" and "update" are never checked/),
    ]);
  });

  it('names the workflow a create rule belongs to', () => {
    expect(describeUncheckedPermissions('Workflow', 'deploy', [{ action: 'create', roles: ['ci'] }])).toEqual([
      expect.stringMatching(/^Workflow "deploy": its permission rules for "create" are never checked/),
    ]);
  });
});

describe('describeIgnoredTrigger', () => {
  it('says nothing about a manual workflow', () => {
    expect(describeIgnoredTrigger({ name: 'deploy' })).toEqual([]);
    expect(describeIgnoredTrigger({ name: 'deploy', trigger: 'manual' })).toEqual([]);
  });

  it('says a webhook trigger registers no route', () => {
    expect(describeIgnoredTrigger({ name: 'deploy', trigger: 'webhook', webhook: { path: '/hooks/deploy' } })).toEqual([
      expect.stringContaining('Workflow "deploy": `trigger: \'webhook\'` and `webhook` register no HTTP route'),
    ]);
  });

  it('says a webhook config registers no route without the trigger too', () => {
    expect(describeIgnoredTrigger({ name: 'deploy', webhook: { path: '/hooks/deploy' } })).toHaveLength(1);
  });

  it('says an event trigger listens to no event', () => {
    expect(describeIgnoredTrigger({ name: 'deploy', trigger: 'event' })).toEqual([
      expect.stringContaining('Workflow "deploy": `trigger: \'event\'` listens to no event'),
    ]);
  });
});

const warnings: string[] = [];

@LogTransport({ name: 'UnreadOptionsCapture', description: 'Keeps the warnings for assertions' })
class WarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) warnings.push(record.message);
  }
}

@Job({
  name: 'export',
  inputSchema: {},
  outputSchema: {},
  permissions: [
    { action: 'execute', roles: ['admin'] },
    { action: 'create', roles: ['admin'] },
  ],
})
class ExportJob extends JobContext {
  async execute() {
    return {};
  }
}

@Workflow({
  name: 'nightly-export',
  trigger: 'webhook',
  webhook: { path: '/hooks/nightly-export' },
  steps: [{ id: 'export', jobName: 'export' }],
})
class NightlyExportWorkflow {}

@Workflow({ name: 'manual-export', steps: [{ id: 'export', jobName: 'export' }] })
class ManualExportWorkflow {}

@App({ id: 'exports', name: 'Exports', jobs: [ExportJob], workflows: [NightlyExportWorkflow, ManualExportWorkflow] })
class ExportsApp {}

describe('startup', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'unread-job-options', version: '1.0.0' },
      apps: [ExportsApp],
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('warns about the webhook trigger and the create rule, and nothing else', () => {
    const unread = warnings.filter((message) => message.includes('export'));

    expect(unread).toEqual([
      expect.stringContaining('Job "export": its permission rules for "create" are never checked'),
      expect.stringContaining('Workflow "nightly-export": `trigger: \'webhook\'`'),
    ]);
  });
});
