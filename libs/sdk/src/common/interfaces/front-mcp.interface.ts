import { type FrontMcpConfigType } from '../metadata';

export interface FrontMcpInterface {
  readonly config: FrontMcpConfigType;
  readonly ready: Promise<void>;
}
