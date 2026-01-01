import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';

const outputSchema = z.object({
  app: z.literal('isolated'),
  type: z.literal('standalone'),
  message: z.string(),
});

type Output = z.infer<typeof outputSchema>;

@Resource({
  uri: 'isolated://info',
  name: 'Isolated Info',
  description: 'Information about the isolated standalone app',
  mimeType: 'application/json',
})
export default class IsolatedInfoResource extends ResourceContext<Record<string, never>, Output> {
  async execute(): Promise<Output> {
    return {
      app: 'isolated',
      type: 'standalone',
      message: 'This resource is only accessible via the isolated app scope',
    };
  }
}
