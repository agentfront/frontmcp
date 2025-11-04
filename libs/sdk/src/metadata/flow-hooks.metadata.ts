export type FlowHookKind = 'stage' | 'will' | 'did' | 'around';

export type FlowHookMetadata<Ctx = any> = {
  type: 'flow';
  hooks: FlowHookMeta<Ctx>[];
};

export type FlowHookMeta<Ctx = any> = {
  kind: FlowHookKind;
  stage: string;
  method: string;
  priority?: number;
  filter?: (ctx: Ctx) => boolean | Promise<boolean>;
  static?: boolean;
};


export type HookKind = 'stage' | 'will' | 'did' | 'around';
export type Priority = number;

export interface FlowHookOptions<Ctx> {
  priority?: Priority;
  filter?: (ctx: Ctx) => boolean | Promise<boolean>;
  name?: string;
}