import { isEdgeRuntime, type OutboundTargetOptions } from '@frontmcp/utils';

/** What the events feature tells the hardened fetch about a callback target. */
export interface EventOutboundTargetOptions extends OutboundTargetOptions {
  /** Lets the platform resolve the host where the runtime cannot pin DNS. Set on edge runtimes only. */
  allowPlatformDns?: boolean;
}

/** The target options of every request to a callback: local targets when configured, platform DNS on edge only. */
export function eventOutboundTargetOptions(allowLocal: boolean): EventOutboundTargetOptions {
  return isEdgeRuntime() ? { allowLocal, allowPlatformDns: true } : { allowLocal };
}
