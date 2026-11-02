import 'reflect-metadata';

import { HookPhase, ToolHook } from '@frontmcp/sdk';

class SetupGate {}

export class InvalidHookOptions {
  // @ts-expect-error appliesTo is 'own-app', 'uncovered-apps' or 'all-apps'
  @ToolHook.Will('execute', { appliesTo: 'everywhere' })
  unknownReach(): void {}

  // @ts-expect-error before takes a list of hook targets
  @ToolHook.Will('execute', { before: 'setup-gate' })
  singleTarget(): void {}

  // @ts-expect-error after names hooks by string
  @ToolHook.Will('execute', { after: [SetupGate] })
  classTarget(): void {}
}

export function moveBand(): void {
  // @ts-expect-error the bands are read-only
  HookPhase.guard = 0;
}
