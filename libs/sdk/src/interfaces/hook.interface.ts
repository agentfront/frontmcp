import {Type} from './base.interface';

export type HookBase<In, Ctx> = (input: In, ctx?: Ctx) => Promise<void>;

export type HookType = Type<HookBase<any, any>>

