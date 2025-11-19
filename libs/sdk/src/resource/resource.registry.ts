import ProviderRegistry from '../provider/provider.registry';
import {
  ResourceEntry, ResourceRecord,
  ResourceRegistryInterface,
  ResourceType,
  Token,
  ToolType,
} from '../common';
import { RegistryAbstract } from '../regsitry';


export default class ResourceRegistry extends RegistryAbstract<ResourceEntry, ResourceRecord, ResourceType[]>
  implements ResourceRegistryInterface {

  constructor(providers: ProviderRegistry, list: ToolType[]) {
    super('ResourceRegistry', providers, list);
  }


  protected buildMap(list: ResourceType[]) {
    const tokens = new Set<Token>();
    const defs = new Map<Token, ResourceRecord>();
    const graph = new Map<Token, Set<Token>>();

    return {
      tokens,
      defs,
      graph,
    };
  }

  buildGraph() {
    // TODO: implement graph building
  }

  protected initialize() {
    return Promise.resolve();
  }


  getResources() {
    return [];
  }

  getInlineResources(): ResourceEntry<any, any>[] {
    throw new Error('Method not implemented.');
  }
}
