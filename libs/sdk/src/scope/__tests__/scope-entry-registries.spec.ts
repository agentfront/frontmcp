import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import {
  App,
  Job,
  JobContext,
  LogLevel,
  Plugin,
  Workflow,
  type FrontMcpConfigInput,
  type JobRegistry,
  type PluginRegistryInterface,
  type ScopeEntry,
  type WorkflowRegistry,
} from '../../index';
import { type Scope } from '../scope.instance';

@Job({ name: 'nightly_sync', inputSchema: {}, outputSchema: { synced: z.boolean() } })
class NightlySyncJob extends JobContext {
  async execute() {
    return { synced: true };
  }
}

@Workflow({ name: 'nightly', steps: [{ id: 'sync', jobName: 'nightly_sync' }] })
class NightlyWorkflow {}

@Plugin({ name: 'server-audit' })
class ServerAuditPlugin {}

@App({ name: 'Ops', jobs: [NightlySyncJob], workflows: [NightlyWorkflow] })
class OpsApp {}

@App({ name: 'Notes' })
class NotesApp {}

interface ScopeRegistries {
  plugins: PluginRegistryInterface | undefined;
  jobs: JobRegistry | undefined;
  workflows: WorkflowRegistry | undefined;
}

const openScopes: ScopeEntry[] = [];

async function registriesOf(config: FrontMcpConfigInput): Promise<ScopeRegistries> {
  const [scope] = (await FrontMcpInstance.createForGraph(config)).getScopes();
  openScopes.push(scope);
  return { plugins: scope.plugins, jobs: scope.jobs, workflows: scope.workflows };
}

afterAll(async () => {
  await Promise.all(openScopes.map((scope) => (scope as Scope).shutdown()));
});

describe('ScopeEntry plugins, jobs and workflows', () => {
  it('reach the server-level plugins and the job and workflow registries when they are configured', async () => {
    const { plugins, jobs, workflows } = await registriesOf({
      info: { name: 'scope-registries', version: '1.0.0' },
      apps: [OpsApp],
      plugins: [ServerAuditPlugin],
      logging: { level: LogLevel.Off },
    });

    expect(plugins?.getPluginNames()).toEqual(['server-audit']);
    expect(jobs?.findByName('nightly_sync')?.name).toBe('nightly_sync');
    expect(workflows?.findByName('nightly')?.name).toBe('nightly');
  });

  it('are undefined without server-level plugins, jobs or workflows', async () => {
    const registries = await registriesOf({
      info: { name: 'scope-without-registries', version: '1.0.0' },
      apps: [NotesApp],
      logging: { level: LogLevel.Off },
    });

    expect(registries).toEqual({ plugins: undefined, jobs: undefined, workflows: undefined });
  });

  it('are typed as possibly undefined', () => {
    const readJobs = (scope: ScopeEntry) =>
      // @ts-expect-error -- `jobs` is undefined unless jobs are enabled
      scope.jobs.getJobs();

    expect(typeof readJobs).toBe('function');
  });
});
