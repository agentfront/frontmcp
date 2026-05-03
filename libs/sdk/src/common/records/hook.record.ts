import { type HookType } from '../interfaces';
import { type HookMetadata } from '../metadata';

export enum HookKind {
  METHOD_TOKEN = 'METHOD_TOKEN',
}

export type HooksMethodToken = {
  kind: HookKind.METHOD_TOKEN;
  provide: HookType;
  metadata: HookMetadata;
};

export type HookRecord = HooksMethodToken;
