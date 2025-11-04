import { FlowType } from '../interfaces';
import { FlowMetadata } from '../metadata';

export enum FlowKind {
  CLASS_TOKEN = 'CLASS_TOKEN',
}

export type FlowClassToken = {
  kind: FlowKind.CLASS_TOKEN;
  provide: FlowType;
  metadata: FlowMetadata<never>
};

export type FlowRecord =
  | FlowClassToken
