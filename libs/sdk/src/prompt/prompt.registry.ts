import ProviderRegistry from '../provider/provider.registry';
import { PromptEntry, PromptRecord, PromptRegistryInterface, PromptType, Token } from '../common';
import { RegistryAbstract } from '../regsitry';


export default class PromptRegistry extends RegistryAbstract<PromptEntry, PromptRecord, PromptType[]> implements PromptRegistryInterface {

  constructor(providers: ProviderRegistry, list: PromptType[]) {
    super('PromptRegistry', providers, list);
  }


  protected buildMap(list: PromptType[]) {
    const tokens = new Set<Token>();
    const defs = new Map<Token, PromptRecord>();
    const graph = new Map<Token, Set<Token>>();

    return {
      tokens,
      defs,
      graph,
    };
  }

  buildGraph() {

  }

  protected initialize() {
    return Promise.resolve();
  }

  hasAny() {
    return this.tokens.size > 0;
  }

  getPrompts() {
    return [];
  }

  getInlinePrompts(): PromptEntry[] {
    return [];
  }
}
