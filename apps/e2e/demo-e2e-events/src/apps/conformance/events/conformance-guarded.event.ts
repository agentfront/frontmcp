import { z } from '@frontmcp/lazy-zod';
import { event } from '@frontmcp/sdk';

import { conformanceState } from '../conformance-upstream';

/** Test-only: an event a caller may read until the `conformance_revoke` tool revokes their access. */
export const conformanceGuarded = event({
  name: 'conformance.guarded',
  description: 'Test-only: readable until access is revoked',
  payloadSchema: { seq: z.number().int(), topic: z.string() },
  // Access is checked again with the authorities, every subscriptions.reauthorizeEveryMs
  authorities: { guards: [(context) => !conformanceState.revokedSubjects.has(context.user.sub ?? '')] },
});

/** Test-only: an event offered by webhook only. */
export const conformanceWebhookOnly = event({
  name: 'conformance.webhook-only',
  payloadSchema: { seq: z.number().int() },
  delivery: ['webhook'],
});

/** Test-only: an event offered by poll only. */
export const conformancePollOnly = event({
  name: 'conformance.poll-only',
  payloadSchema: { seq: z.number().int() },
  delivery: ['poll'],
});
