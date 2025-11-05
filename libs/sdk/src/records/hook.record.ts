import {HookType} from '../interfaces';
import {HookMetadata} from '../metadata';

export enum HookKind {
  METHOD_TOKEN = 'METHOD_TOKEN',
}

export type HookSMethodToken = {
  kind: HookKind.METHOD_TOKEN;
  provide: HookType;
  metadata: HookMetadata<never>
};

export type HookRecord =
  | HookSMethodToken
