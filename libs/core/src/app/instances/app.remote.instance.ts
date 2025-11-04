import {
  AdapterRegistryInterface,
  AppEntry,
  AppRecord,
  PluginRegistryInterface,
  PromptRegistryInterface,
  ProviderRegistryInterface,
  RemoteAppMetadata,
  ResourceRegistryInterface,
  ToolRegistryInterface,
} from '@frontmcp/sdk';
import { idFromString } from '../../utils/string.utils';
import ProviderRegistry from '../../provider/provider.registry';

export class AppRemoteInstance extends AppEntry {
  override readonly metadata: RemoteAppMetadata;
  override readonly id: string;

  constructor(record: AppRecord, scopeProviders: ProviderRegistry) {
    super(record);
    this.id = this.metadata.id ?? idFromString(this.metadata.name);

    this.ready = this.initialize();
  }


  protected async initialize() {

    console.log('FrontMcpAppRemoteInstance.ready', this.id);
  }

  override get providers(): ProviderRegistryInterface {
    throw new Error('Method not implemented.');
  }

  override get adapters(): AdapterRegistryInterface {
    throw new Error('Method not implemented.');
  }

  override get plugins(): PluginRegistryInterface {
    throw new Error('Method not implemented.');
  }

  override get tools(): ToolRegistryInterface {
    throw new Error('Method not implemented.');
  }

  override get resources(): ResourceRegistryInterface {
    throw new Error('Method not implemented.');
  }

  override get prompts(): PromptRegistryInterface {
    throw new Error('Method not implemented.');
  }

}