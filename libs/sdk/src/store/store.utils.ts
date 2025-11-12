import { Scope } from '../scope/scope.instance';

export function makeScopeSegment(scope: Scope): string { return String(scope); }

export function buildDataKey(scope: Scope, prefix: string, key: string): string {
  return `${makeScopeSegment(scope)}:${prefix}${key}`;
}

export function buildChannel(scope: Scope, prefix: string, channel: string): string {
  return `${makeScopeSegment(scope)}:${prefix}__ch__:${channel}`;
}

export const Json = {
  encode<T>(value: T): string { return JSON.stringify(value); },
  decode<T>(str: string | null): T | null { return str == null ? null : (JSON.parse(str) as T); },
};
