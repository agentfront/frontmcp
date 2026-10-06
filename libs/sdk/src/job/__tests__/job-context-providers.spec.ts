/**
 * A job's CONTEXT providers are built with the same request-scoped values a flow passes to
 * `buildViews()`: the request context and every context token an auth flow installed on it with
 * `setContextToken()`. Without the tokens, a job could not resolve a provider that depends on one.
 */
import 'reflect-metadata';

import { type JobEntry } from '../../common/entries/job.entry';
import { FRONTMCP_CONTEXT, FrontMcpContext } from '../../context';
import { jobContextProviders } from '../job-context-providers';

const ORCHESTRATED_ACCESSOR = Symbol('orchestrated-accessor');

function jobWithRecordedViews() {
  const buildViews = jest.fn(async () => ({ global: new Map(), context: new Map() }));
  const job = { providers: { buildViews } } as unknown as JobEntry;
  return { job, buildViews };
}

describe('jobContextProviders', () => {
  it('passes the request context and its installed context tokens to buildViews', async () => {
    const context = new FrontMcpContext({ sessionId: 'session-1', scopeId: 'scope' });
    const accessor = { kind: 'orchestrated' };
    context.setContextToken(ORCHESTRATED_ACCESSOR, accessor);
    const { job, buildViews } = jobWithRecordedViews();

    await jobContextProviders(job, context);

    expect(buildViews).toHaveBeenCalledTimes(1);
    const [sessionKey, contextDeps] = buildViews.mock.calls[0] as unknown as [string, Map<unknown, unknown>];
    expect(sessionKey).toBe('session-1');
    expect(contextDeps.get(FRONTMCP_CONTEXT)).toBe(context);
    expect(contextDeps.get(ORCHESTRATED_ACCESSOR)).toBe(accessor);
  });
});
