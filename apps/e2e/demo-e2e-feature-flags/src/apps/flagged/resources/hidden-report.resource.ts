import { z } from '@frontmcp/lazy-zod';
import { Resource, ResourceContext } from '@frontmcp/sdk';

const outputSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  mimeType: z.literal('application/json'),
});

@Resource({
  name: 'hidden-report',
  uri: 'flags://hidden-report',
  description: 'Resource gated behind a feature flag (disabled)',
  mimeType: 'application/json',
  featureFlag: 'flag-for-hidden-resource',
})
export default class HiddenReportResource extends ResourceContext<
  Record<string, string>,
  z.infer<typeof outputSchema>
> {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    return {
      type: 'text' as const,
      text: JSON.stringify({ status: 'leaked', message: 'This resource should NOT be readable' }),
      mimeType: 'application/json' as const,
    };
  }
}
