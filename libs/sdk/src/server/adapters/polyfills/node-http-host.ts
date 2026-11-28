import { type ExpressHostAdapterOptions } from '../host-adapter.shared';
import { NodeHttpHostAdapter } from '../node-http.host.adapter';
import { detectExpressFlavor } from '../node-http/flavor';

/** The node:http host for these options, or undefined when it cannot stand in for the installed Express. */
export function createNodeHttpHost(options: ExpressHostAdapterOptions): NodeHttpHostAdapter | undefined {
  const flavor = detectExpressFlavor();
  return flavor ? new NodeHttpHostAdapter(options, flavor) : undefined;
}
