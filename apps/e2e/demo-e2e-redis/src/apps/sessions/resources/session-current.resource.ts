import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getSessionStore } from '../data/session.store';

const outputSchema = z.object({
  sessionId: z.string(),
  keys: z.array(z.string()),
  data: z.record(z.string(), z.string()),
});

@Resource({
  uri: 'session://current',
  name: 'Current Session',
  description: 'Current session data',
  mimeType: 'application/json',
})
export default class SessionCurrentResource extends ResourceContext<
  Record<string, never>,
  z.infer<typeof outputSchema>
> {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    // Use shared session ID from authInfo so data is consistent across tools and resources
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const store = getSessionStore(sessionId);

    const data = store.getAll();

    return {
      sessionId,
      keys: Object.keys(data),
      data,
    };
  }
}
