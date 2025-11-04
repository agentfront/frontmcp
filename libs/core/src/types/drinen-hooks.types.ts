import { Type } from '@frontmcp/sdk';

export type AnyStage = string & {};


export interface GenericHook<Ctx = unknown> {
  providedBy: string;
  priority?(): number;
  filter?(ctx: Ctx): boolean | Promise<boolean>;
  aroundExecute?: (ctx: Ctx, next: () => Promise<unknown>) => Promise<unknown>;
  [stage: string]: any; // stage handler methods (will*/did*/on*)
}

export interface CollectHooksFn<Ctx> {
  (
    stage: AnyStage,
    options: {
      resolve: <T>(cls: any) => T;
      globalHooksByStage?: Partial<Record<AnyStage, Type[]>>;
      localHooksByStage?: Partial<Record<AnyStage, Type[]>>;
      ctx: Ctx;
      owner?: { name?: string };
    },
  ): Promise<GenericHook<Ctx>[]>;
}
