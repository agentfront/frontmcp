/**
 * `alwaysPrompt: true` with `ApprovalCheckPlugin` listed next to `ApprovalPlugin.init()` (#678):
 * two gates over one store still use up one approval per call, not two.
 */
import { describeAlwaysPrompt } from './helpers/always-prompt';

describeAlwaysPrompt(
  'ApprovalPlugin.init() and ApprovalCheckPlugin',
  'apps/e2e/demo-e2e-approval/src/main-explicit-check.ts',
);
