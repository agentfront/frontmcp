import { Resource, ResourceContext } from '@frontmcp/sdk';
import { DataStoreService } from '../providers/data-store.provider';

@Resource({
  uri: 'debug://providers',
  name: 'Debug Providers',
  description: 'Debug resource that reports provider resolution details',
  mimeType: 'application/json',
})
export default class DebugProvidersResource extends ResourceContext {
  async execute() {
    const providersType = this.providers?.constructor?.name ?? 'unknown';
    let storeInstanceId = 'NOT_RESOLVED';
    let error = '';

    try {
      const store = this.get(DataStoreService);
      storeInstanceId = store.getInstanceId();
    } catch (e: unknown) {
      error = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
    }

    return {
      providersType,
      storeInstanceId,
      error: error || undefined,
    };
  }
}
