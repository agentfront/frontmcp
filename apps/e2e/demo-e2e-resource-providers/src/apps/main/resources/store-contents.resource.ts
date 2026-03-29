import { Resource, ResourceContext } from '@frontmcp/sdk';
import { DataStoreService } from '../providers/data-store.provider';

/**
 * Static resource that reads from the GLOBAL DataStoreService via DI.
 *
 * BUG UNDER TEST: Resources should be able to use this.get() to resolve
 * app-level providers, the same way tools do. If DI doesn't work in resources,
 * this resource will throw ProviderNotRegisteredError.
 */
@Resource({
  uri: 'store://contents',
  name: 'Store Contents',
  description: 'Lists all entries in the data store using DI-resolved provider',
  mimeType: 'application/json',
})
export default class StoreContentsResource extends ResourceContext {
  async execute() {
    const store = this.get(DataStoreService);
    const entries = store.getAll();
    return {
      entries,
      storeInstanceId: store.getInstanceId(),
      count: entries.length,
    };
  }
}
