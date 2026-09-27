import { type Token } from '@frontmcp/di';

import { type EntryOwnerRef } from '../entries/base.entry';
import { type FlowName } from './flow.metadata';

export type HookStageType = 'stage' | 'will' | 'did' | 'around';
export type HookPriority = number;

/**
 * Which entries a hook of a plugin installed on an app runs for, in the flows about one entry
 * (`tools/call`, `resources/read`, `prompts/get`, `completion/complete`). Hooks of server-level
 * plugins, and every hook in list flows, run for every app's entries regardless.
 *
 * - `'own-app'` (default): only the entries of the app the plugin is installed on.
 * - `'uncovered-apps'`: those, plus the entries of any other app for which no instance of the
 *   same hook (same class and method) runs, from that app or from a server-level plugin. Meant
 *   for gates that metadata on an entry asks for, such as approval or feature flags, so an entry
 *   in an app without the plugin is not left ungated.
 */
export type HookAppliesTo = 'own-app' | 'uncovered-apps';

export interface HookOptions<Ctx> {
  priority?: HookPriority;
  filter?: (ctx: Ctx) => boolean | Promise<boolean>;
  appliesTo?: HookAppliesTo;
}

export interface TokenHookMetadata {
  hooks: HookMetadata[];
}

export interface HookMetadata<Name extends FlowName = FlowName, Stage = string, Ctx = any> extends HookOptions<Ctx> {
  type: HookStageType;
  flow: Name;
  stage: Stage;
  target: Token | null; // null for TC39 decorators until resolved at execution time
  method: string;
  static?: boolean;
  owner?: EntryOwnerRef;
}
