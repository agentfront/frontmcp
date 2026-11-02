import { assertNode } from '../crypto/runtime';

let childProcess: typeof import('child_process') | null = null;

/** `child_process`, loaded on first use so the browser and edge builds never import it. */
export function getChildProcess(): typeof import('child_process') {
  if (!childProcess) {
    assertNode('Process operations');
    childProcess = require('child_process') as typeof import('child_process');
  }
  return childProcess;
}
