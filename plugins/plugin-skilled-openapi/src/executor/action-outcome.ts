import type { AuthBinding } from '@frontmcp/adapters/skills';
import { redactJson } from '@frontmcp/utils';

import type { ErrorBodiesPolicy } from '../skilled-openapi.types';
import type { SkillActionResult } from './execute-skill-action';

/** The most characters of an API's error body a failed action passes on; a longer body is cut and ends with `…`. */
export const MAX_ERROR_BODY_LENGTH = 2048;

/** What a script's `callTool(actionId, input, { throwOnError: false })` returns. */
export interface ActionOutcome {
  ok: boolean;
  /** The HTTP status, or 0 when the call failed before an answer (authority, input, timeout, abort). */
  status: number;
  /** The answer's data; on an HTTP failure, the API's error body unless `outbound.errorBodies` is `'status-only'`. */
  data?: unknown;
  /** Why the call failed, for a failure that is not an API's error answer. */
  error?: string;
}

/** The outcome a script sees of one action call, with the API's error body redacted and capped. */
export function actionOutcome(
  result: SkillActionResult,
  errorBodies: ErrorBodiesPolicy,
  authBinding: AuthBinding,
): ActionOutcome {
  if (result.ok) {
    return { ok: true, status: result.status, ...(result.data !== undefined ? { data: result.data } : {}) };
  }
  if (result.error) return { ok: false, status: result.status, error: result.error };
  const body =
    errorBodies === 'status-only' ? undefined : cappedErrorBody(result.data, credentialFieldsOf(authBinding));
  return { ok: false, status: result.status, ...(body !== undefined ? { data: body } : {}) };
}

/** The error a failed action call throws in the script: its reason, or its status and the API's error body. */
export function actionFailureMessage(actionId: string, outcome: ActionOutcome): string {
  if (outcome.error) return outcome.error;
  const body = outcome.data === undefined ? '' : `: ${bodyText(outcome.data)}`;
  return `action "${actionId}" failed with status ${outcome.status}${body}`;
}

function cappedErrorBody(body: unknown, credentialFields: string[]): unknown {
  if (body === undefined || body === null || body === '') return undefined;
  const redacted = redactJson(body, credentialFields);
  const text = bodyText(redacted);
  return text.length > MAX_ERROR_BODY_LENGTH ? `${text.slice(0, MAX_ERROR_BODY_LENGTH)}…` : redacted;
}

function bodyText(body: unknown): string {
  return typeof body === 'string' ? body : JSON.stringify(body);
}

/** The fields an operation's credential travels in, which an API echoing its request must not pass back. */
function credentialFieldsOf(authBinding: AuthBinding): string[] {
  if (authBinding.kind === 'none') return [];
  if (authBinding.kind === 'apiKey') return [authBinding.name];
  return ['authorization'];
}
