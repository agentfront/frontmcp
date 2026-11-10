import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { conformanceState } from '../conformance-upstream';
import { conformanceEmitted } from '../events/conformance-emitted.event';
import { conformanceGuarded } from '../events/conformance-guarded.event';

const emitInput = {
  topic: z.string().default('default'),
  count: z.number().int().positive().default(1),
  event: z.enum(['conformance.emitted', 'conformance.guarded']).default('conformance.emitted'),
  audienceSub: z.string().optional().describe('Only the subscriptions of this subject'),
  eventId: z.string().optional().describe('The id the upstream gave the occurrence; one occurrence only'),
};
type EmitInput = z.infer<z.ZodObject<typeof emitInput>>;

let nextSeq = 1;

/** Test-only: publishes `count` occurrences, numbered from 1 across the server's life. */
@Tool({
  name: 'conformance_emit',
  description: 'Test-only: publish occurrences of a conformance event',
  inputSchema: emitInput,
})
export class ConformanceEmitTool extends ToolContext {
  /** Publish the occurrences one by one and answer their ids. */
  async execute({ topic, count, event, audienceSub, eventId }: EmitInput) {
    const target = event === 'conformance.guarded' ? conformanceGuarded : conformanceEmitted;
    const eventIds: string[] = [];
    for (let index = 0; index < count; index++) {
      const audience = audienceSub ? { sub: audienceSub } : undefined;
      const published = await this.events.publish(target, { seq: nextSeq++, topic }, { audience, eventId });
      eventIds.push(published.eventId);
    }
    return { eventIds };
  }
}

const upstreamInput = {
  action: z.enum(['append', 'fail', 'gap', 'forget', 'reset']),
  topic: z.string().default('default'),
  count: z.number().int().positive().default(1),
};
type UpstreamInput = z.infer<z.ZodObject<typeof upstreamInput>>;

/** Test-only: steers the upstream of `conformance.replayed`, including the failures a healthy one never has. */
@Tool({
  name: 'conformance_upstream',
  description: 'Test-only: steer the conformance upstream',
  inputSchema: upstreamInput,
})
export class ConformanceUpstreamTool extends ToolContext {
  /** Append changes, fail the next `check()` calls, skip ahead once, forget old positions, or reset. */
  async execute({ action, topic, count }: UpstreamInput) {
    const state = conformanceState;
    if (action === 'append') state.append(topic, count);
    if (action === 'fail') state.failuresLeft = count;
    if (action === 'gap') state.gapNext = true;
    if (action === 'forget') state.retainedFrom = state.changes.length;
    if (action === 'reset') state.reset();
    return { position: state.changes.length };
  }
}

const revokeInput = { sub: z.string(), revoked: z.boolean().default(true) };
type RevokeInput = z.infer<z.ZodObject<typeof revokeInput>>;

/** Test-only: revokes, or restores, a subject's access to `conformance.guarded`. */
@Tool({ name: 'conformance_revoke', description: 'Test-only: revoke a subject', inputSchema: revokeInput })
export class ConformanceRevokeTool extends ToolContext {
  /** Add the subject to the revoked set, or take it out. */
  async execute({ sub, revoked }: RevokeInput) {
    if (revoked) conformanceState.revokedSubjects.add(sub);
    else conformanceState.revokedSubjects.delete(sub);
    return { revoked };
  }
}
