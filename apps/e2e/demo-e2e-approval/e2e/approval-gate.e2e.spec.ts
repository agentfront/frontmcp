/**
 * The reporter's setup for GHSA-r848-p7wf-96rc: `ApprovalPlugin.init()` with `ApprovalCheckPlugin`
 * listed as well.
 *
 * `deploy-service` requires approval and pre-approves the `deployment/prod-eu-blue` context. The
 * report's third call named that context in its own arguments and skipped the gate.
 */
import { describeApprovalGate } from './helpers/approval-gate';

describeApprovalGate(
  'ApprovalPlugin.init() and ApprovalCheckPlugin',
  'apps/e2e/demo-e2e-approval/src/main-explicit-check.ts',
);
