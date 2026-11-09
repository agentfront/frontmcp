import AgentRegistry from '../../agent/agent.registry';
import { normalizeAgent } from '../../agent/agent.utils';
import {
  normalizeToolRef,
  type AgentType,
  type AppFilterConfig,
  type EntryOwnerRef,
  type FrontMcpLogger,
  type JobType,
  type LateEntryKind,
  type PrimitiveFilterKey,
  type ProviderType,
  type SkillRecord,
  type WorkflowType,
} from '../../common';
import { isPrimitiveIncluded } from '../../common/utils/primitive-filter';
import { InvalidEntityError } from '../../errors';
import {
  esmManifestRecords,
  esmPromptRecord,
  esmResourceRecord,
  esmSkillRecord,
  esmToolRecord,
} from '../../esm-loader/esm-entries';
import { type FrontMcpPackageManifest } from '../../esm-loader/esm-manifest';
import { normalizeJob } from '../../job/job.utils';
import { PromptInstance } from '../../prompt/prompt.instance';
import ProviderRegistry from '../../provider/provider.registry';
import { ResourceInstance } from '../../resource/resource.instance';
import SkillRegistry from '../../skill/skill.registry';
import { ToolInstance } from '../../tool/tool.instance';
import { normalizeWorkflow } from '../../workflow/workflow.utils';

/** The app a package version's entries are built for. */
export interface EsmPackageTarget {
  /** The app's own provider registry; each version's providers are registered below it. */
  providers: ProviderRegistry;
  owner: EntryOwnerRef;
  namespace?: string;
  filter?: AppFilterConfig;
  logger: FrontMcpLogger;
}

/** The entries one loaded version of an ESM app's package serves. */
export interface EsmVersionEntries {
  tools: ToolInstance[];
  resources: ResourceInstance[];
  prompts: PromptInstance[];
  /** The version's agents, in a registry of its own that the app's adopts while the version is served. */
  agents?: AgentRegistry;
  /** The version's skills, in a registry of its own that the app's adopts while the version is served. */
  skills?: SkillRegistry;
  /** The version's jobs, which the scope's job system builds on the version's providers. */
  jobs: JobType[];
  workflows: WorkflowType[];
}

/**
 * One loaded version of an ESM app's package. The package's providers are registered in a provider registry of the
 * version's own, below the app's, and every entry of the version is built on it.
 */
export class EsmPackageVersion {
  private constructor(
    readonly providers: ProviderRegistry,
    readonly entries: EsmVersionEntries,
  ) {}

  /** Build every entry of `manifest`; when one fails, the providers built for it are shut down and the error thrown. */
  static async build(manifest: FrontMcpPackageManifest, target: EsmPackageTarget): Promise<EsmPackageVersion> {
    const providers = new ProviderRegistry((manifest.providers ?? []) as ProviderType[], target.providers);
    try {
      await providers.ready;
      const prefixLength = target.namespace ? target.namespace.length + 1 : 0;
      const included =
        (kind: PrimitiveFilterKey) =>
        (record: { metadata: { name: string } }): boolean =>
          isPrimitiveIncluded(record.metadata.name.slice(prefixLength), kind, target.filter);
      const recordsOf = <R extends { metadata: { name: string } }>(
        kind: 'tools' | 'resources' | 'prompts',
        recordOf: (raw: unknown, namespace?: string) => R | undefined,
      ): R[] => esmManifestRecords(manifest[kind], (raw) => recordOf(raw, target.namespace)).filter(included(kind));

      const toolRecords = recordsOf('tools', esmToolRecord);
      const [tools, resources, prompts] = await Promise.all([
        readyAll(toolRecords.map((record) => new ToolInstance(record, providers, target.owner))),
        readyAll(
          recordsOf('resources', esmResourceRecord).map(
            (record) => new ResourceInstance(record, providers, target.owner),
          ),
        ),
        readyAll(
          recordsOf('prompts', esmPromptRecord).map((record) => new PromptInstance(record, providers, target.owner)),
        ),
      ]);

      const toolNames = new Map(
        toolRecords.map((record) => [record.metadata.name.slice(prefixLength), record.metadata.name]),
      );
      const skillRecords = (manifest.skills ?? [])
        .map((raw) => withPackageToolNames(esmSkillRecord(raw), toolNames))
        .filter((record) => isPrimitiveIncluded(record.metadata.name, 'skills', target.filter));
      const agentList = (manifest.agents ?? []).filter((raw) =>
        isPrimitiveIncluded(normalizeAgent(raw as AgentType).metadata.name, 'agents', target.filter),
      ) as AgentType[];
      const jobs = (manifest.jobs ?? []).filter((raw) =>
        isPrimitiveIncluded(namedEntryOf('job', normalizeJob(raw)), 'jobs', target.filter),
      ) as JobType[];
      const workflows = (manifest.workflows ?? []).filter((raw) =>
        isPrimitiveIncluded(namedEntryOf('workflow', normalizeWorkflow(raw)), 'workflows', target.filter),
      ) as WorkflowType[];

      const agents = agentList.length > 0 ? new AgentRegistry(providers, agentList, target.owner) : undefined;
      const skills = skillRecords.length > 0 ? new SkillRegistry(providers, skillRecords, target.owner) : undefined;
      await Promise.all([agents?.ready, skills?.ready]);

      return new EsmPackageVersion(providers, { tools, resources, prompts, agents, skills, jobs, workflows });
    } catch (error) {
      await discardProviders(providers, target.logger);
      throw error;
    }
  }

  /** Shut down the providers of a version that will not be served. */
  discard(logger: FrontMcpLogger): Promise<void> {
    return discardProviders(this.providers, logger);
  }

  /** The kinds of entry the version has that a scope serves only once it has one. */
  lateEntryKinds(): LateEntryKind[] {
    const kinds: LateEntryKind[] = [];
    if (this.entries.agents) kinds.push('agents');
    if (this.entries.skills) kinds.push('skills');
    return kinds;
  }

  /** How many entries of each kind the version serves, for the log. */
  describe(): string {
    const { tools, resources, prompts, agents, skills, jobs, workflows } = this.entries;
    const agentCount = agents?.listAllInstances().length ?? 0;
    const skillCount = skills?.getSkills(true).length ?? 0;
    return (
      `${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts, ${agentCount} agents, ` +
      `${skillCount} skills, ${jobs.length} jobs, ${workflows.length} workflows`
    );
  }
}

/** The name of a job or workflow export; one without a name is not one, as an undecorated class isn't. */
function namedEntryOf(kind: 'job' | 'workflow', record: { metadata: { name?: string } }): string {
  const name = record.metadata.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new InvalidEntityError(kind, String(name), `a class decorated with @${kind === 'job' ? 'Job' : 'Workflow'}`);
  }
  return name;
}

/**
 * A skill names the package's tools by their names in the package; it gets the names the app serves them under, with
 * the namespace. A tool it names that the package does not export keeps its name.
 */
function withPackageToolNames(record: SkillRecord, servedNames: ReadonlyMap<string, string>): SkillRecord {
  const tools = record.metadata.tools;
  if (!tools?.length || servedNames.size === 0) return record;
  const renamed = tools.map((ref) => {
    const { name, purpose, required } = normalizeToolRef(ref);
    const servedName = servedNames.get(name);
    return servedName ? { name: servedName, purpose, required } : ref;
  });
  return { ...record, metadata: { ...record.metadata, tools: renamed } } as SkillRecord;
}

/** Shut down the providers of a version that will not be served, and drop their registry. */
async function discardProviders(providers: ProviderRegistry, logger: FrontMcpLogger): Promise<void> {
  await providers.runShutdownHooks(logger);
  providers.dispose();
}

async function readyAll<T extends { ready: Promise<void> }>(instances: T[]): Promise<T[]> {
  await Promise.all(instances.map((instance) => instance.ready));
  return instances;
}
