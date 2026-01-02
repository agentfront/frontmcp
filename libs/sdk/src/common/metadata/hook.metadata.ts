import { Token } from '@frontmcp/di';
import { FlowName } from './flow.metadata';
import { EntryOwnerRef } from '../entries/base.entry';

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
