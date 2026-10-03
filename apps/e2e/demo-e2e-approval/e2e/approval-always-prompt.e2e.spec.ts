/**
 * `alwaysPrompt: true` with the documented setup, `ApprovalPlugin.init()` alone (#678).
 *
 * Through 1.8.7 every call of such a tool was refused, approved or not.
 */
import { describeAlwaysPrompt } from './helpers/always-prompt';

describeAlwaysPrompt('ApprovalPlugin.init()', 'apps/e2e/demo-e2e-approval/src/main.ts');
