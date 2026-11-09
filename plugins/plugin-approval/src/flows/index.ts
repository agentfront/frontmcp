/**
 * Flow exports for ApprovalPlugin.
 *
 * `approval:webhook-callback` serves `webhook.callbackPath` in webhook mode; recheck polling runs inside the approval
 * gate, in `tools:call-tool`.
 *
 * @module @frontmcp/plugin-approval
 */

export { default as ApprovalCallbackFlow } from '../external/approval-callback.flow';
