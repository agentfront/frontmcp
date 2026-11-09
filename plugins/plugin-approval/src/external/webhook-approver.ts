/**
 * `mode: 'webhook'` with `webhook.url`: a call that needs an approval sends one signed request to the approval system,
 * which decides by POSTing back to `webhook.callbackPath`.
 *
 * @module @frontmcp/plugin-approval
 */

import { z } from '@frontmcp/lazy-zod';
import { getPinnedPublicUrl, httpRespond, type FrontMcpLogger } from '@frontmcp/sdk';

import { approvalGrantorSchema, approvalScopeSchema } from '../approval';
import type { ResolvedWebhook } from '../approval.options';
import type { ChallengeService } from '../services/challenge.service';
import type { WebhookPayload } from '../types';
import {
  pendingRequestKey,
  type ApprovalDecisionRecorder,
  type ExternalApprovalOutcome,
  type ExternalApprover,
  type PendingApprovalCall,
} from './approval-decisions';
import { originOf, OutboundRequestError, postJson } from './outbound-request';
import {
  checkSignature,
  signatureHeaders,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from './webhook-signature';

/** The largest callback body the route reads, in bytes. */
export const MAX_CALLBACK_BYTES = 16 * 1024;

const callbackSchema = z.object({
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  approved: z.boolean(),
  scope: approvalScopeSchema.optional(),
  ttlMs: z.number().positive().finite().optional(),
  grantedBy: approvalGrantorSchema.optional(),
  reason: z.string().max(1000).optional(),
});

/** The callback route's JSON answer. */
export type CallbackAnswer = ReturnType<typeof httpRespond.json>;

/** The request the callback route reads: its headers and the exact bytes of its body. */
export interface CallbackRequest {
  headers: Record<string, unknown>;
  bodyBytes?: Uint8Array;
}

function refusal(status: number, error: string, description: string): CallbackAnswer {
  return httpRespond.json({ error, error_description: description }, { status });
}

function headerOf(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

/** Every well-formed, signed callback gets this answer, so the route never says whether an approval was pending. */
function received(): CallbackAnswer {
  return httpRespond.json({ status: 'received' }, { status: 202 });
}

/** What the webhook reads and writes: the pending requests, and the store decisions go to. */
export interface WebhookDependencies {
  readonly challenges: ChallengeService;
  readonly decisions: ApprovalDecisionRecorder;
}

export class WebhookApprover implements ExternalApprover {
  readonly via = 'webhook';

  constructor(
    private readonly webhook: ResolvedWebhook,
    private readonly dependencies: WebhookDependencies,
    private readonly logger: FrontMcpLogger,
  ) {}

  private get challenges(): ChallengeService {
    return this.dependencies.challenges;
  }

  /**
   * Sends the approval request for a refused call, once per caller and tool until it is decided or `challengeTtl`
   * passes, and reports the call as pending: the decision arrives on the callback route.
   */
  async requestApproval(call: PendingApprovalCall): Promise<ExternalApprovalOutcome> {
    const pendingKey = pendingRequestKey(call);
    const ttlSeconds = this.webhook.challengeTtlSeconds;
    if (!(await this.challenges.claimPendingRequest(pendingKey, ttlSeconds))) return 'pending';

    const { requirement } = call;
    const requestedScope = requirement.defaultScope ?? 'session';
    const requestInfo = {
      toolName: call.toolName,
      category: requirement.category,
      riskLevel: requirement.riskLevel,
      customMessage: requirement.approvalMessage,
    };
    const { codeVerifier, codeChallenge, expiresAt } = await this.challenges.createChallenge({
      toolId: call.toolId,
      sessionId: call.sessionId,
      userId: call.userId,
      context: call.context,
      requestedScope,
      requestInfo,
      ttlSeconds,
    });
    const publicUrl = getPinnedPublicUrl();
    const payload: WebhookPayload = {
      type: 'approval.requested',
      codeChallenge,
      codeVerifier,
      toolId: call.toolId,
      toolName: call.toolName,
      category: requestInfo.category,
      riskLevel: requestInfo.riskLevel,
      approvalMessage: requestInfo.customMessage,
      requestedScope,
      allowedScopes: requirement.allowedScopes,
      maxTtlMs: requirement.maxTtlMs,
      userId: call.userId,
      callbackPath: this.webhook.callbackPath,
      callbackUrl: publicUrl ? `${publicUrl}${this.webhook.callbackPath}` : undefined,
      expiresAt,
      timestamp: Date.now(),
      jwt: this.webhook.includeJwt ? call.accessToken : undefined,
    };
    const body = JSON.stringify(payload);

    try {
      const answer = await postJson({
        url: this.webhook.url,
        body,
        headers: signatureHeaders(this.webhook.signingKey, body),
        signal: call.signal,
      });
      if (answer.status < 200 || answer.status >= 300) throw new OutboundRequestError(`answered ${answer.status}`);
      await this.challenges.markWebhookSent(codeChallenge);
    } catch (error) {
      if (!(error instanceof OutboundRequestError)) throw error;
      await this.challenges.deleteChallenge(codeChallenge);
      await this.challenges.releasePendingRequest(pendingKey);
      this.logger.warn(
        `ApprovalPlugin: the approval request for ${call.toolId} to ${originOf(this.webhook.url)} failed: ${error.message}`,
      );
    }
    return 'pending';
  }

  /**
   * A decision POSTed to the callback route. It must be signed with `webhook.secret` within the last five minutes and
   * name a pending request's `codeVerifier`; the request is used up, so a replay does nothing. Every signed,
   * well-formed callback gets the same `202`, whether or not it matched a request.
   */
  async handleCallback(request: CallbackRequest): Promise<CallbackAnswer> {
    const { bodyBytes } = request;
    if (!bodyBytes || bodyBytes.byteLength === 0) {
      return refusal(400, 'invalid_request', 'the body must be the decision, as JSON');
    }
    if (bodyBytes.byteLength > MAX_CALLBACK_BYTES) {
      return refusal(413, 'payload_too_large', `the body must be ${MAX_CALLBACK_BYTES} bytes or less`);
    }
    const body = new TextDecoder().decode(bodyBytes);
    const signature = checkSignature(this.webhook.signingKey, {
      id: headerOf(request.headers, WEBHOOK_ID_HEADER),
      timestamp: headerOf(request.headers, WEBHOOK_TIMESTAMP_HEADER),
      signature: headerOf(request.headers, WEBHOOK_SIGNATURE_HEADER),
      body,
    });
    if (signature !== 'valid') {
      this.logger.warn(`ApprovalPlugin: refused an approval callback: signature ${signature}`);
      return refusal(401, 'invalid_signature', 'the callback must be signed with webhook.secret, within five minutes');
    }

    let decision: z.infer<typeof callbackSchema>;
    try {
      decision = callbackSchema.parse(JSON.parse(body));
    } catch {
      return refusal(
        400,
        'invalid_request',
        'the body must be { codeVerifier, approved, scope?, ttlMs?, grantedBy?, reason? }',
      );
    }

    const pending = await this.challenges.consume(decision.codeVerifier);
    if (!pending) return received();
    await this.challenges.releasePendingRequest(pendingRequestKey(pending));

    const subject = {
      toolId: pending.toolId,
      sessionId: pending.sessionId,
      userId: pending.userId,
      context: pending.context,
    };
    const outcome = {
      scope: decision.scope,
      ttlMs: decision.ttlMs,
      decidedBy: decision.grantedBy,
      reason: decision.reason,
    };
    if (decision.approved) {
      await this.dependencies.decisions.approve(subject, outcome, 'webhook');
    } else {
      await this.dependencies.decisions.deny(
        subject,
        outcome,
        decision.ttlMs ?? this.webhook.challengeTtlSeconds * 1000,
        'webhook',
      );
    }
    return received();
  }
}
