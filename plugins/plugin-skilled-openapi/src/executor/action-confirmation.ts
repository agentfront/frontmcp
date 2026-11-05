import { type SkillAuditConfirmation } from '@frontmcp/adapters/skills';
import { z } from '@frontmcp/lazy-zod';
import {
  ElicitationDisabledError,
  ElicitationFallbackRequired,
  ElicitationNotSupportedError,
  ElicitationTimeoutError,
  MissingClientCapabilityError,
  type ElicitResult,
} from '@frontmcp/sdk';

import { type HiddenOpEntry, type HiddenOpRegistry, type OperationListings } from '../registry/hidden-op.registry';
import { type AuthorityGuard } from '../security/authority-guard';
import { type VisibleListings } from '../security/skill-visibility';
import { type SkilledOpenApiConfig } from '../skilled-openapi.symbols';
import { type ConfirmOptions, type WhenConfirmationUnsupported } from '../skilled-openapi.types';

/** The question a confirmation asks: one yes/no field. */
export const confirmationSchema = z.object({ confirmed: z.boolean().describe('Run it') });

/** Asks the user a confirmation question, through the `this.elicit` of the tool that runs the action. */
export type AskUser = (message: string) => Promise<ElicitResult<{ confirmed: boolean }>>;

/** One action a confirmation names, with the input it runs with once the call is known. */
export interface ConfirmationSubject {
  entry: HiddenOpEntry;
  input?: Record<string, unknown>;
}

/** A call that may send its request: the user said yes, or no one could be asked and `whenUnsupported` allows it. */
export interface AllowedCall {
  confirmation: Extract<SkillAuditConfirmation, 'confirmed' | 'skipped'>;
}

/** A call that may not send its request, and why. */
export interface RefusedCall {
  confirmation: Extract<SkillAuditConfirmation, 'declined' | 'unanswered'>;
  refusal: string;
}

/** What the confirmation of a call decided, as the audit log records it. */
export type ConfirmationDecision = AllowedCall | RefusedCall;

/** Whether an action call that needs the user's confirmation may send its request. */
export type ConfirmAction = (call: Required<ConfirmationSubject>) => Promise<ConfirmationDecision>;

const MAX_INPUT_TEXT_LENGTH = 1000;

/** A string in a script that may be an action id, such as the first argument of `callTool('voidInvoice', …)`. */
const QUOTED_ACTION_ID = /(['"`])([\w.:-]+)\1/g;

/** Whether the `confirm` option names the action: by its method, its id, or a tag of its operation or of a skill listing it. */
export function needsConfirmation(confirm: ConfirmOptions | undefined, listings: OperationListings): boolean {
  if (!confirm) return false;
  const { op } = listings[0];
  if (confirm.methods?.includes(op.httpMethod) || confirm.operations?.includes(op.operationId)) return true;
  const tags = [...(op.tags ?? []), ...listings.flatMap((listing) => listing.skillTags ?? [])];
  return tags.some((tag) => confirm.tags?.includes(tag));
}

/** The confirmation of one action call: the user is asked about it, and its input, before its request. */
export function askingBeforeEachCall(askUser: AskUser, whenUnsupported: WhenConfirmationUnsupported): ConfirmAction {
  return (call) => confirmWithUser(askUser, [call], whenUnsupported);
}

/** Asks once, before the script starts, about the matching actions it names and the caller may run; others are refused. */
export async function confirmWorkflow(args: {
  script: string;
  config: SkilledOpenApiConfig;
  guard: AuthorityGuard;
  visibleListings: VisibleListings;
  hiddenOps: HiddenOpRegistry;
  authInfo: unknown;
  askUser: AskUser;
}): Promise<{ refusal: string } | { confirmAction: ConfirmAction }> {
  const { script, config, guard, visibleListings, hiddenOps, authInfo, askUser } = args;
  const askedActionIds = new Set<string>();
  if (!config.confirm) return { confirmAction: confirmingAskedActions(askedActionIds) };

  const mayRun = async (listings: OperationListings): Promise<boolean> => {
    for (const entry of await visibleListings(listings)) {
      const allowed = await guard.canDiscover({
        policy: entry.op.requiredAuthorities,
        skillPolicy: entry.skillRequiredAuthorities,
        isPublic: entry.op.public,
        unprotectedOps: config.unprotectedOps,
        authInfo: (authInfo ?? {}) as Parameters<AuthorityGuard['canDiscover']>[0]['authInfo'],
      });
      if (allowed) return true;
    }
    return false;
  };
  const subjects: ConfirmationSubject[] = [];
  for (const actionId of new Set([...script.matchAll(QUOTED_ACTION_ID)].map((match) => match[2]))) {
    const listings = hiddenOps.listingsOf(actionId);
    if (!listings || !needsConfirmation(config.confirm, listings) || !(await mayRun(listings))) continue;
    subjects.push({ entry: listings[0] });
    askedActionIds.add(actionId);
  }
  if (subjects.length === 0) return { confirmAction: confirmingAskedActions(askedActionIds) };

  const decision = await confirmWithUser(askUser, subjects, config.confirm.whenUnsupported);
  if ('refusal' in decision) return { refusal: decision.refusal };
  return { confirmAction: confirmingAskedActions(askedActionIds, decision) };
}

/** A workflow's calls of the actions it asked about carry its answer; other actions that need confirmation are refused. */
function confirmingAskedActions(askedActionIds: ReadonlySet<string>, answer?: AllowedCall): ConfirmAction {
  return async ({ entry }) => {
    const actionId = entry.op.operationId;
    return answer && askedActionIds.has(actionId) ? answer : notAskedByWorkflow(actionId);
  };
}

/** Ask the user to confirm the actions: whether they may run, and why not when they may not. */
async function confirmWithUser(
  askUser: AskUser,
  subjects: readonly ConfirmationSubject[],
  whenUnsupported: WhenConfirmationUnsupported,
): Promise<ConfirmationDecision> {
  const actionIds = subjects.map(({ entry }) => entry.op.operationId).join(', ');
  let answer: ElicitResult<{ confirmed: boolean }>;
  try {
    answer = await askUser(confirmationMessage(subjects));
  } catch (error) {
    if (error instanceof ElicitationTimeoutError) {
      return { confirmation: 'unanswered', refusal: `the user did not answer in time: ${actionIds}` };
    }
    const unavailable = whyUserCannotBeAsked(error);
    if (!unavailable) throw error;
    if (whenUnsupported === 'allow') return { confirmation: 'skipped' };
    const refusal = `the user's confirmation is needed for ${actionIds}, and ${unavailable}; nothing was sent`;
    return { confirmation: 'unanswered', refusal };
  }
  const confirmed = answer.status === 'accept' && answer.content?.confirmed === true;
  return confirmed
    ? { confirmation: 'confirmed' }
    : { confirmation: 'declined', refusal: `the user declined: ${actionIds}` };
}

function whyUserCannotBeAsked(error: unknown): string | undefined {
  if (error instanceof ElicitationDisabledError) return "this server can't ask for it: elicitation is disabled";
  const clientCannotAsk =
    error instanceof ElicitationFallbackRequired ||
    error instanceof ElicitationNotSupportedError ||
    error instanceof MissingClientCapabilityError;
  return clientCannotAsk ? "this client can't ask for it: it doesn't support elicitation" : undefined;
}

function confirmationMessage(subjects: readonly ConfirmationSubject[]): string {
  if (subjects.length === 1 && subjects[0].input) return `Run ${actionText(subjects[0])}?`;
  const actionLines = subjects.map((subject) => `- ${actionText(subject)}`).join('\n');
  return `This workflow can run these actions, as many times as its script calls them:\n${actionLines}\nRun it?`;
}

function actionText({ entry: { op }, input }: ConfirmationSubject): string {
  const action = `${op.operationId}: ${op.summary ? `${op.summary} ` : ''}(${op.httpMethod} ${op.pathTemplate})`;
  if (!input || Object.keys(input).length === 0) return action;
  const inputText = JSON.stringify(input);
  const shownInput =
    inputText.length > MAX_INPUT_TEXT_LENGTH ? `${inputText.slice(0, MAX_INPUT_TEXT_LENGTH)}…` : inputText;
  return `${action} with ${shownInput}`;
}

function notAskedByWorkflow(actionId: string): RefusedCall {
  const refusal =
    `action "${actionId}" needs the user's confirmation, which run_workflow asks for before the script starts, ` +
    `for the actions it names: write the actionId as a string, as in callTool('${actionId}', …), or run it with execute_action`;
  return { confirmation: 'unanswered', refusal };
}
