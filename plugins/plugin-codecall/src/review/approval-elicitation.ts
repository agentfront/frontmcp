import { z } from '@frontmcp/lazy-zod';
import type { FrontMcpContext, ScopeEntry } from '@frontmcp/sdk';

import type { PendingApproval } from './run-review';

/** The form a person answers to approve a call or a script. */
export const approvalAnswerSchema = z.object({ approve: z.boolean().describe('Allow it') });

const MAX_ARGUMENTS_PREVIEW_CHARS = 500;

/** The request's exchange under protocol 2026-07-28, where a client declares elicitation per request. */
interface ElicitationExchange {
  getMrtrExchange?(): { supportsElicitation?(mode: 'form'): boolean } | undefined;
}

/** Whether the server may ask the client's user: elicitation is on, and the client declared it. */
export function clientCanElicit(scope: ScopeEntry, context: FrontMcpContext | undefined): boolean {
  if (scope.metadata.elicitation?.enabled !== true || !context) return false;
  const exchange = (context as ElicitationExchange).getMrtrExchange?.();
  if (exchange) return exchange.supportsElicitation?.('form') === true;
  return scope.notifications.getClientCapabilities(context.sessionId)?.elicitation !== undefined;
}

/** What the person is asked: the reason, and the tool and arguments of the call it covers. */
export function approvalQuestionOf(reason: string, pending: PendingApproval): string {
  if (!pending.call) return `${reason}\n\nAllow this script to run?`;
  const argumentsText = JSON.stringify(pending.call.args) ?? 'undefined';
  const preview =
    argumentsText.length > MAX_ARGUMENTS_PREVIEW_CHARS
      ? `${argumentsText.slice(0, MAX_ARGUMENTS_PREVIEW_CHARS)}...`
      : argumentsText;
  return `${reason}\n\nTool: ${pending.call.toolName}\nArguments: ${preview}\n\nAllow this call?`;
}
