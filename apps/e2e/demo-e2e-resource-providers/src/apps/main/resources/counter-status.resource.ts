import { Resource, ResourceContext } from '@frontmcp/sdk';

/**
 * Resource that accesses the CounterPlugin via context extension (this.counter).
 *
 * BUG UNDER TEST: Plugin context extensions should work in resources the same
 * way they work in tools. If the plugin's exported provider is not in the
 * resource's provider hierarchy, this.counter will throw
 * ProviderNotRegisteredError.
 */
@Resource({
  uri: 'counter://status',
  name: 'Counter Status',
  description: 'Reads counter status via plugin context extension',
  mimeType: 'application/json',
})
export default class CounterStatusResource extends ResourceContext {
  async execute() {
    const count = this.counter.getCount();
    const instanceId = this.counter.getInstanceId();
    return { count, counterInstanceId: instanceId };
  }
}
