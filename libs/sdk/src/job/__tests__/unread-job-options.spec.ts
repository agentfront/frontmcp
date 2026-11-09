/**
 * Job and workflow options the schemas accept and nothing reads, which startup warns about: a workflow's
 * `trigger: 'webhook'` (or `'event'`) and `webhook`.
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
import { describeIgnoredTrigger } from '../unread-job-options';

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

  it('warns about the webhook trigger, and not about a manual workflow', () => {
    const unread = warnings.filter((message) => message.includes('export'));

    expect(unread).toEqual([expect.stringContaining('Workflow "nightly-export": `trigger: \'webhook\'`')]);
  });
});
