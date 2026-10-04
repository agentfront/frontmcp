import { z } from '@frontmcp/lazy-zod';
import { Resource, ResourceContext } from '@frontmcp/sdk';

const outputSchema = z.object({
  status: z.string(),
  owner: z.string(),
});

type Output = z.infer<typeof outputSchema>;

@Resource({
  uri: 'server://status',
  name: 'Server Status',
  description: 'Status of the server shared by every app',
  mimeType: 'application/json',
})
export default class ServerStatusResource extends ResourceContext<Record<string, never>, Output> {
  async execute(): Promise<Output> {
    return { status: 'up', owner: 'server' };
  }
}
