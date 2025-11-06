import {FlowName} from "./flow.metadata";
import {Token} from "../interfaces";
import {z} from "zod";

export type HookStageType = 'stage' | 'will' | 'did' | 'around';
export type HookPriority = number;


export interface HookOptions<Ctx> {
  priority?: HookPriority;
  filter?: (ctx: Ctx) => boolean | Promise<boolean>;
}

export interface TokenHookMetadata {
  hooks: HookMetadata[];
}

export interface HookMetadata<Ctx = any> extends HookOptions<Ctx> {
  type: HookStageType;
  flow: string,
  stage: string;
  target: Token;
  method: string;
  static?: boolean;
}