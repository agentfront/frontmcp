import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';

const outputSchema = z.object({
  runtime: z.string(),
});

type Output = z.infer<typeof outputSchema>;

/**
 * Resource constrained to browser runtime. Should NOT be visible in e2e tests.
 */
@Resource({
  name: 'browser-storage',
  uri: 'env://browser-storage',
  description: 'Browser localStorage info (browser-only resource, should be filtered)',
  mimeType: 'application/json',
  availableWhen: { runtime: ['browser'] },
})
export default class BrowserStorageResource extends ResourceContext<Record<string, never>, Output> {
  async execute(): Promise<Output> {
    return { runtime: 'browser' };
  }
}
