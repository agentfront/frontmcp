// The browser and worker builds' `#shared-server`: the shared local server needs Node, so none of it is bundled
import { BrowserEntryPointUnavailableError } from '../errors/browser-entry-point.errors';
import type { runShared as runSharedOnNode } from './index';

export const runShared: typeof runSharedOnNode = async () => {
  throw new BrowserEntryPointUnavailableError('runShared');
};
