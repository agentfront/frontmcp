import {FlowName} from "./flow.metadata";

export type HookType = 'stage' | 'will' | 'did' | 'around';
export type HookPriority = number;

export type HookMetadata<Ctx = any> = {
  type: HookType;
  flow: FlowName,
  stage: string;
  method: string;
  priority?: HookPriority;
  filter?: (ctx: Ctx) => boolean | Promise<boolean>;
  static?: boolean;
};

export interface HookOptions<Ctx> {
  priority?: HookPriority;
  filter?: (ctx: Ctx) => boolean | Promise<boolean>;
  name?: string;
}