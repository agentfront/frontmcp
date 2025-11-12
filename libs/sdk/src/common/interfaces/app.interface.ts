import { Type, ValueType } from './base.interface';
import { AppMetadata } from '../metadata';

export interface AppInterface {

}

export type AppValueType<Provide> = ValueType<Provide> & AppMetadata;

export type AppType<T extends AppInterface = any> =
  | Type<T>
  | AppValueType<T>