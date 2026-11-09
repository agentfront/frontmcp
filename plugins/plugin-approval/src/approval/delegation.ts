/**
 * Delegation chains: a delegate that delegates further, bounded by `maxDelegationDepth`.
 *
 * @module @frontmcp/plugin-approval
 */

import type { ApprovalGrantor, DelegationContext, DelegationLink } from './types';

/** How many delegations a context stands for: its own and those in its `chain`. */
export function delegationDepth(context: DelegationContext): number {
  return (context.chain?.length ?? 0) + 1;
}

/**
 * Why a delegated grant can't be honoured, or `undefined` when it can: a chain deeper than `maxDepth`, a link whose
 * delegator is not the previous link's delegate, or a party that appears twice.
 */
export function delegationProblem(context: DelegationContext, maxDepth: number): string | undefined {
  const links: DelegationLink[] = [...(context.chain ?? []), context];
  if (links.length > maxDepth) {
    return `the delegation chain is ${links.length} deep, and maxDelegationDepth is ${maxDepth}`;
  }
  const parties = new Set<string>([links[0].delegatorId]);
  for (let index = 0; index < links.length; index++) {
    const link = links[index];
    if (index > 0 && link.delegatorId !== links[index - 1].delegateId) {
      return `the delegation chain is broken: ${link.delegatorId} was not delegated to by ${links[index - 1].delegatorId}`;
    }
    if (parties.has(link.delegateId)) return `the delegation chain names ${link.delegateId} twice`;
    parties.add(link.delegateId);
  }
  return undefined;
}

/** {@link delegationProblem} for a grantor: `undefined` for one that names no delegation. */
export function grantorDelegationProblem(grantor: ApprovalGrantor, maxDepth: number): string | undefined {
  return grantor.delegationContext ? delegationProblem(grantor.delegationContext, maxDepth) : undefined;
}

/**
 * The context of a delegate that delegates further: `context.delegateId` authorizes `delegateId`, and `context` joins
 * the chain.
 *
 * @example
 * ```typescript
 * const toPlanner = { delegatorId: 'user-123', delegateId: 'planner-agent', purpose: 'release' };
 * const toDeployer = extendDelegation(toPlanner, 'deploy-agent', { purpose: 'deploy step' });
 * // { delegatorId: 'planner-agent', delegateId: 'deploy-agent', purpose: 'deploy step',
 * //   chain: [{ delegatorId: 'user-123', delegateId: 'planner-agent', purpose: 'release' }] }
 * grantedBy: agentGrantor('deploy-agent', toDeployer)
 * ```
 */
export function extendDelegation(
  context: DelegationContext,
  delegateId: string,
  options: Pick<DelegationContext, 'purpose' | 'constraints'> = {},
): DelegationContext {
  const { delegatorId, delegateId: delegate, purpose } = context;
  return {
    delegatorId: delegate,
    delegateId,
    ...options,
    chain: [...(context.chain ?? []), { delegatorId, delegateId: delegate, ...(purpose ? { purpose } : {}) }],
  };
}
