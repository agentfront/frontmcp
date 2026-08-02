import { z } from '@frontmcp/lazy-zod';
import { Resource, ResourceContext } from '@frontmcp/sdk';

const outputSchema = z.object({
  env: z.string(),
  featureFlags: z.array(z.string()),
});

type Output = z.infer<typeof outputSchema>;

@Resource({
  uri: 'proto://config',
  name: 'Proto Config',
  description: 'Static configuration document used by the protocol conformance suite',
  mimeType: 'application/json',
})
export default class ConfigResource extends ResourceContext<Record<string, never>, Output> {
  async execute(): Promise<Output> {
    return { env: 'e2e', featureFlags: ['protocol-2026'] };
  }
}
