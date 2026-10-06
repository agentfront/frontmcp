import { type Token } from '@frontmcp/di';

import { type ProviderRegistryInterface } from '../common';
import { type JobEntry } from '../common/entries/job.entry';
import { FRONTMCP_CONTEXT, FrontMcpContext } from '../context';
import { FlowContextProviders } from '../provider/flow-context-providers';

/**
 * The providers a job run resolves against (#705): the job's own provider hierarchy (its app's)
 * plus the CONTEXT-scoped providers it defines, built for `context` and the context tokens installed
 * on it. So `this.context` and accessors such as `this.remember` and `this.featureFlags` work inside
 * the job.
 *
 * @param job - The job about to run
 * @param context - The request context the run belongs to
 * @returns Context-aware providers to create the job context with
 */
export async function jobContextProviders(job: JobEntry, context: FrontMcpContext): Promise<ProviderRegistryInterface> {
  const contextDeps = new Map<Token, unknown>([[FRONTMCP_CONTEXT, context]]);
  for (const [token, instance] of context.getContextTokens()) contextDeps.set(token as Token, instance);
  const views = await job.providers.buildViews(context.sessionId, contextDeps);
  return new FlowContextProviders(job.providers, views.context);
}

/**
 * A context for a run that outlives the request that started it: the same session, auth, trace,
 * metadata and context tokens, a request id of its own, and no transport.
 *
 * @param context - The request context of the caller
 * @returns The context the background run uses
 */
export function detachedRunContext(context: FrontMcpContext): FrontMcpContext {
  const runContext = new FrontMcpContext({
    sessionId: context.sessionId,
    authInfo: context.authInfo,
    scopeId: context.scopeId,
    traceContext: context.traceContext,
    metadata: context.metadata,
    config: context.config,
    platformEnv: context.platformEnv,
  });
  for (const [token, instance] of context.getContextTokens()) runContext.setContextToken(token, instance);
  return runContext;
}
