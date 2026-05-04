import { type Token } from '@frontmcp/di';

import { type EntryOwnerRef } from '../entries/base.entry';
import { type FlowName } from './flow.metadata';

export type HookStageType = 'stage' | 'will' | 'did' | 'around';
export type HookPriority = number;

export interface HookOptions<Ctx> {
  priority?: HookPriority;
  filter?: (ctx: Ctx) => boolean | Promise<boolean>;
}

export interface TokenHookMetadata {
  hooks: HookMetadata[];
}

export interface HookMetadata<Name extends FlowName = FlowName, Stage = string, Ctx = any> extends HookOptions<Ctx> {
  type: HookStageType;
  flow: Name;
  stage: Stage;
  target: Token | null; // null for TC39 decorators until resolved at execution time
  method: string;
  static?: boolean;
  owner?: EntryOwnerRef;
}
