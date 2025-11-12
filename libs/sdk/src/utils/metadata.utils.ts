import 'reflect-metadata';
import { META_ASYNC_WITH, Type } from '../common';

export function getMetadata<T = any>(key: any, target: any, propertyKey?: string | symbol): T | undefined {
  // Reflect.getMetadata is provided by reflect-metadata polyfill
  return (propertyKey !== undefined)
    ? Reflect.getMetadata(key, target, propertyKey)
    : Reflect.getMetadata(key, target);
}

export function setMetadata(key: any, value: any, target: any, propertyKey?: string | symbol): void {
  if (propertyKey !== undefined) {
    (Reflect as any).defineMetadata(key, value, target, propertyKey);
  } else {
    (Reflect as any).defineMetadata(key, value, target);
  }
}

export function  hasAsyncWith(klass: Type<any>): boolean {
  return (
    !!getMetadata(META_ASYNC_WITH, klass) &&
    typeof (klass as any).with === 'function'
  );
}
