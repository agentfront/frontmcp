export type FlowHookKind = 'stage' | 'will' | 'did' | 'around';
export type FlowHookPriority = number;

export type FlowHookMetadata<Ctx = any> = {
  type: 'flow';
  hooks: FlowHookMeta<Ctx>[];
};

export type FlowHookMeta<Ctx = any> = {
  kind: FlowHookKind;
  stage: string;
  method: string;
  priority?: FlowHookPriority;
  filter?: (ctx: Ctx) => boolean | Promise<boolean>;
  static?: boolean;
};

export interface FlowHookOptions<Ctx> {
  priority?: FlowHookPriority;
  filter?: (ctx: Ctx) => boolean | Promise<boolean>;
  name?: string;
}