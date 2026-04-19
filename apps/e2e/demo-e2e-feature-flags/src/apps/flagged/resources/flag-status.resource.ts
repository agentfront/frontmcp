import { z } from '@frontmcp/lazy-zod';
import { Resource, ResourceContext } from '@frontmcp/sdk';

const outputSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  mimeType: z.literal('application/json'),
});

@Resource({
  name: 'flag-status',
  uri: 'flags://status',
  description: 'Resource gated behind a feature flag (enabled)',
  mimeType: 'application/json',
  featureFlag: 'flag-for-resource',
})
export default class FlagStatusResource extends ResourceContext<Record<string, string>, z.infer<typeof outputSchema>> {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    return {
      type: 'text' as const,
      text: JSON.stringify({
        status: 'accessible',
        flagKey: 'flag-for-resource',
        message: 'This resource is gated behind a feature flag',
      }),
      mimeType: 'application/json' as const,
    };
  }
}
