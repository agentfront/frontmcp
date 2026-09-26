import { type z } from '@frontmcp/lazy-zod';

import {
  enforceIpFilter,
  Flow,
  FlowBase,
  FlowHooksOf,
  httpInputSchema,
  httpOutputSchema,
  type FlowPlan,
  type FlowRunOptions,
} from '../../common';

const plan = {
  pre: ['checkIpFilter'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'http:ip-filter': FlowRunOptions<
      HttpIpFilterFlow,
      typeof plan,
      typeof httpInputSchema,
      typeof httpOutputSchema,
      z.ZodObject<Record<string, never>>
    >;
  }
}

const name = 'http:ip-filter' as const;
const { Stage } = FlowHooksOf(name);

/** `throttle.ipFilter` for HTTP routes that are not flows themselves, such as `http.routes`; no output means allowed. */
@Flow({
  name,
  plan,
  access: 'public',
  inputSchema: httpInputSchema,
  outputSchema: httpOutputSchema,
})
export default class HttpIpFilterFlow extends FlowBase<typeof name> {
  @Stage('checkIpFilter')
  async checkIpFilter() {
    enforceIpFilter(this.scope, this.tryGetContext()?.metadata.clientIp);
  }
}
