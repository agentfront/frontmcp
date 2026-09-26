/**
 * The documented setup, `ApprovalPlugin.init()` alone (GHSA-r848-p7wf-96rc).
 *
 * Through 1.8.0 this registered no approval check, so `deploy-service` ran whatever the caller sent.
 */
import { describeApprovalGate } from './helpers/approval-gate';

describeApprovalGate('ApprovalPlugin.init()', 'apps/e2e/demo-e2e-approval/src/main.ts');
