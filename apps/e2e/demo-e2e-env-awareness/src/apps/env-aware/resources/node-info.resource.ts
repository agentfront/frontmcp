import { z } from '@frontmcp/lazy-zod';
import { Resource, ResourceContext } from '@frontmcp/sdk';

const outputSchema = z.object({
  runtime: z.string(),
  version: z.string(),
});

type Output = z.infer<typeof outputSchema>;

/**
 * Resource constrained to Node.js runtime. Should be visible in e2e tests.
 */
@Resource({
  name: 'node-info',
  uri: 'env://node-info',
  description: 'Node.js runtime info (Node-only resource)',
  mimeType: 'application/json',
  availableWhen: { runtime: ['node'] },
})
export default class NodeInfoResource extends ResourceContext<Record<string, never>, Output> {
  async execute(): Promise<Output> {
    return { runtime: 'node', version: process.version };
  }
}
