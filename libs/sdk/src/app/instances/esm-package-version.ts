import {
  type AppFilterConfig,
  type EntryOwnerRef,
  type FrontMcpLogger,
  type PrimitiveFilterKey,
  type ProviderType,
} from '../../common';
import { isPrimitiveIncluded } from '../../common/utils/primitive-filter';
import { esmManifestRecords, esmPromptRecord, esmResourceRecord, esmToolRecord } from '../../esm-loader/esm-entries';
import { type FrontMcpPackageManifest } from '../../esm-loader/esm-manifest';
import { PromptInstance } from '../../prompt/prompt.instance';
import ProviderRegistry from '../../provider/provider.registry';
import { ResourceInstance } from '../../resource/resource.instance';
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
 * provider registry of the version's own, below the app's, and every entry of the version is built on it.
 */
export class EsmPackageVersion {
  private constructor(
    readonly providers: ProviderRegistry,
    readonly tools: ToolInstance[],
    readonly resources: ResourceInstance[],
    readonly prompts: PromptInstance[],
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

      const [tools, resources, prompts] = await Promise.all([
        readyAll(recordsOf('tools', esmToolRecord).map((record) => new ToolInstance(record, providers, target.owner))),
        readyAll(
          recordsOf('resources', esmResourceRecord).map(
            (record) => new ResourceInstance(record, providers, target.owner),
          ),
        ),
        readyAll(
          recordsOf('prompts', esmPromptRecord).map((record) => new PromptInstance(record, providers, target.owner)),
        ),
      ]);
      return new EsmPackageVersion(providers, tools, resources, prompts);
    } catch (error) {
      await discardProviders(providers, target.logger);
      throw error;
    }
  }

  /** Shut down the providers of a version that will not be served. */
  discard(logger: FrontMcpLogger): Promise<void> {
    return discardProviders(this.providers, logger);
  }

  /** How many entries of each kind the version serves, for the log. */
  describe(): string {
    return `${this.tools.length} tools, ${this.resources.length} resources, ${this.prompts.length} prompts`;
  }
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
