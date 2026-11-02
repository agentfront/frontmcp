// file: libs/sdk/src/answer/client-profile.ts

import type { CallToolResult } from '@frontmcp/protocol';
import { globToRegex } from '@frontmcp/utils';

import type { ResourceMetadata } from '../common/metadata/resource.metadata';
import type {
  ClientAnnotationsMode,
  ClientProfile,
  ClientProfilesOptionsInterface,
  StructuredAnswerMode,
} from '../common/types/options/clients';
import { SKILL_MD_PRIORITY } from '../skill/sep-2640/sep-2640.constants';

type ResourceAnnotations = ResourceMetadata['annotations'];

/** Where a request's client name comes from, most specific first. */
export interface ClientNameSources {
  /** The request context: MCP 2026-07-28 clients send `clientInfo` with each request. */
  context?: { clientInfo?: { name: string } };
  /** The session payload, where `initialize` recorded the client name. */
  authInfo?: { sessionId?: string; sessionIdPayload?: { clientName?: string } };
  notifications?: { getClientInfo(sessionId: string): { name: string } | undefined };
}

const SUMMARY_KEYS = 12;
const SHORT_STRING = 40;
/** Longer names match no profile: a glob with several `*` backtracks on a long name a client picks. */
const MAX_CLIENT_NAME_LENGTH = 256;

const compiledProfiles = new WeakMap<ClientProfilesOptionsInterface, Array<[RegExp, ClientProfile]>>();

function compile(clients: ClientProfilesOptionsInterface): Array<[RegExp, ClientProfile]> {
  const known = compiledProfiles.get(clients);
  if (known) return known;
  const compiled = Object.entries(clients).map(([glob, profile]): [RegExp, ClientProfile] => [
    globToRegex(glob.toLowerCase()),
    profile,
  ]);
  compiledProfiles.set(clients, compiled);
  return compiled;
}

/**
 * The profile of the first `clients` glob that matches the client name, without regard to case.
 * A name over 256 characters matches none.
 */
export function resolveClientProfile(
  clients: ClientProfilesOptionsInterface | undefined,
  clientName: string | undefined,
): ClientProfile | undefined {
  if (!clients || clientName === undefined || clientName.length > MAX_CLIENT_NAME_LENGTH) return undefined;
  const lowerName = clientName.toLowerCase();
  return compile(clients).find(([matcher]) => matcher.test(lowerName))?.[1];
}

/** The `clientInfo.name` the caller sent: with this request, else at the session's `initialize`. */
export function callerClientName({ context, authInfo, notifications }: ClientNameSources): string | undefined {
  const sessionId = authInfo?.sessionId;
  return (
    context?.clientInfo?.name ??
    authInfo?.sessionIdPayload?.clientName ??
    (sessionId ? notifications?.getClientInfo(sessionId)?.name : undefined)
  );
}

/** The `clients` profile the caller's `clientInfo.name` matches; nothing is looked up without profiles. */
export function callerClientProfile(
  clients: ClientProfilesOptionsInterface | undefined,
  sources: ClientNameSources,
): ClientProfile | undefined {
  return clients ? resolveClientProfile(clients, callerClientName(sources)) : undefined;
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return ` (${value.length} ${value.length === 1 ? 'item' : 'items'})`;
  if (typeof value === 'object' && value !== null) return ` (${Object.keys(value).length} keys)`;
  if (typeof value === 'string') {
    return value.length <= SHORT_STRING ? `: ${JSON.stringify(value)}` : ` (${value.length} characters)`;
  }
  return `: ${String(value)}`;
}

/** The one-line text `structured: 'only'` sends in place of the JSON. */
export function summarizeStructuredContent(structuredContent: Record<string, unknown>): string {
  const keys = Object.keys(structuredContent);
  const described = keys.slice(0, SUMMARY_KEYS).map((key) => `${key}${describeValue(structuredContent[key])}`);
  if (keys.length > SUMMARY_KEYS) described.push(`${keys.length - SUMMARY_KEYS} more keys`);
  return described.length > 0
    ? `The answer is in structuredContent: ${described.join(', ')}.`
    : 'The answer is in structuredContent.';
}

/**
 * A tool answer shaped for a client's `structured` mode, or `undefined` when it stays as it is.
 * `'only'` needs the client to know the output schema (`listsOutputSchema`) and leaves errors alone.
 */
export function shapeToolAnswer(
  result: CallToolResult,
  mode: StructuredAnswerMode,
  listsOutputSchema: boolean,
): CallToolResult | undefined {
  const { structuredContent } = result;
  if (mode === 'both' || structuredContent === undefined) return undefined;
  if (mode === 'text') {
    const { structuredContent: _dropped, ...textOnly } = result;
    return textOnly;
  }
  if (!listsOutputSchema || result.isError) return undefined;
  const structuredText = JSON.stringify(structuredContent);
  const summary = summarizeStructuredContent(structuredContent);
  return {
    ...result,
    content: result.content.map((block) =>
      block.type === 'text' && block.text === structuredText ? { ...block, text: summary } : block,
    ),
  };
}

/**
 * The annotations a client receives for a resource: `'no-numbers'` drops `priority`, and `'full'`
 * gives a skill's `SKILL.md` (`skillMd`) the annotations `skillsConfig.resourceAnnotations: 'full'` does.
 */
export function annotationsForClient(
  annotations: ResourceAnnotations,
  mode: ClientAnnotationsMode | undefined,
  skillMd: boolean,
): ResourceAnnotations {
  if (mode === 'no-numbers') {
    if (!annotations || annotations.priority === undefined) return annotations;
    const { priority: _dropped, ...withoutNumbers } = annotations;
    return Object.keys(withoutNumbers).length > 0 ? withoutNumbers : undefined;
  }
  if (mode === 'full' && skillMd) {
    return { audience: ['assistant'], ...annotations, priority: SKILL_MD_PRIORITY };
  }
  return annotations;
}
