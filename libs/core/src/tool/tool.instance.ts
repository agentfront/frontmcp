import {ToolEntry, ToolRecord, EntryOwnerRef} from '@frontmcp/sdk';
import ProviderRegistry from '../provider/provider.registry';


export class ToolInstance extends ToolEntry<any, any> {
  private readonly providers: ProviderRegistry;

  /**
   * Tool name used for execution.
   */
  readonly name: string;

  constructor(record: ToolRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this.providers = providers;
    this.name = record.metadata.id || record.metadata.name;
    this.ready = this.initialize();
  }

  protected initialize() {
    // TODO:
    //   - create json representation of tool based on metadata
    //   - read global tool hooks from provider registry that registered via @Hook('tool','stage')
    //   - read inline tool hooks from cls metadata that registered via @Stage('stage')
    //   - create tool invoke flow based on scope and providers and set of hooks per stage

    return Promise.resolve();
  }

  getMetadata() {
    return this.record.metadata;
  }

  execute(session: string) {
    // TODO:
    //   - create session scoped providers
    //   - create request scoped providers
    //   - create tool invoker run from previously created flow
    //   - run tool invoker
    //   - return result
  }

}