import AgentRegistry from '../../agent/agent.registry';
import { normalizeAgent } from '../../agent/agent.utils';
import {
  normalizeToolRef,
  type AgentType,
  type AppFilterConfig,
  type EntryOwnerRef,
  type FrontMcpLogger,
  type LateEntryKind,
  type PrimitiveFilterKey,
  type ProviderType,
  type SkillRecord,
} from '../../common';
import { isPrimitiveIncluded } from '../../common/utils/primitive-filter';
import {
  esmManifestRecords,
  esmPromptRecord,
  esmResourceRecord,
  esmSkillRecord,
  esmToolRecord,
} from '../../esm-loader/esm-entries';
import { type FrontMcpPackageManifest } from '../../esm-loader/esm-manifest';
import { PromptInstance } from '../../prompt/prompt.instance';
import ProviderRegistry from '../../provider/provider.registry';
import { ResourceInstance } from '../../resource/resource.instance';
import SkillRegistry from '../../skill/skill.registry';
import { ToolInstance } from '../../tool/tool.instance';

/** The app a package version's entries are built for. */
export interface EsmPackageTarget {
  /** The app's own provider registry; each version's providers are registered below it. */
  providers: ProviderRegistry;
  owner: EntryOwnerRef;
  namespace?: string;
  filter?: AppFilterConfig;
  logger: FrontMcpLogger;
}

/**
 * The entries one loaded version of an ESM app's package serves. The package's providers are registered in a
 * provider registry of the version's own, below the app's, and every entry of the version is built on it. Its agents
 * and skills are held in registries of the version's own too, which the app's registries adopt while it is served.
 */
export class EsmPackageVersion {
  private constructor(
    readonly providers: ProviderRegistry,
    readonly tools: ToolInstance[],
    readonly resources: ResourceInstance[],
    readonly prompts: PromptInstance[],
    readonly agents: AgentRegistry | undefined,
    readonly skills: SkillRegistry | undefined,
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
      const agents = agentList.length > 0 ? new AgentRegistry(providers, agentList, target.owner) : undefined;
      const skills = skillRecords.length > 0 ? new SkillRegistry(providers, skillRecords, target.owner) : undefined;
      await Promise.all([agents?.ready, skills?.ready]);

      return new EsmPackageVersion(providers, tools, resources, prompts, agents, skills);
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
    if (this.agents) kinds.push('agents');
    if (this.skills) kinds.push('skills');
    return kinds;
  }

  /** How many entries of each kind the version serves, for the log. */
  describe(): string {
    const agentCount = this.agents?.listAllInstances().length ?? 0;
    const skillCount = this.skills?.getSkills(true).length ?? 0;
    return (
      `${this.tools.length} tools, ${this.resources.length} resources, ${this.prompts.length} prompts, ` +
      `${agentCount} agents, ${skillCount} skills`
    );
  }
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
