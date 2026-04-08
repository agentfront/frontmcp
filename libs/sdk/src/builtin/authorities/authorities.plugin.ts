/**
 * Authorities Plugin (Legacy)
 *
 * This plugin is no longer the enforcement mechanism for authorities.
 * Authority enforcement is handled by native flow stages:
 * - `checkEntryAuthorities` in call flows (tool, resource, prompt, agent)
 * - `filterByAuthorities` in list flows
 *
 * The plugin exists only for backward compatibility with code that
 * references `AuthoritiesPlugin`. The authorities engine is now
 * configured directly via `@FrontMcp({ authorities: { ... } })`.
 *
 * @deprecated Configure authorities via `@FrontMcp({ authorities })` instead.
 */

import {
  AuthoritiesEngine,
  AuthoritiesContextBuilder,
  AuthoritiesProfileRegistry,
  AuthoritiesEvaluatorRegistry,
} from '@frontmcp/auth';
import { DynamicPlugin } from '../../common/dynamic/dynamic.plugin';
import { Plugin } from '../../common/decorators/plugin.decorator';
import type { AuthoritiesPluginOptions } from './authorities.plugin.options';

@Plugin({
  name: 'authorities',
  description: 'Legacy authorities plugin — use @FrontMcp({ authorities }) instead',
})
export default class AuthoritiesPlugin extends DynamicPlugin<AuthoritiesPluginOptions> {
  /** The evaluation engine — accessed by scope during init */
  readonly engine: AuthoritiesEngine;
  /** The context builder — accessed by scope during init */
  readonly contextBuilder: AuthoritiesContextBuilder;

  constructor(options: AuthoritiesPluginOptions = {}) {
    super();

    const profileRegistry = new AuthoritiesProfileRegistry();
    if (options.profiles) {
      profileRegistry.registerAll(options.profiles);
    }

    const evaluatorRegistry = new AuthoritiesEvaluatorRegistry();
    if (options.evaluators) {
      evaluatorRegistry.registerAll(options.evaluators);
    }

    this.engine = new AuthoritiesEngine(profileRegistry, evaluatorRegistry);
    this.contextBuilder = new AuthoritiesContextBuilder({
      claimsMapping: options.claimsMapping,
      claimsResolver: options.claimsResolver,
      relationshipResolver: options.relationshipResolver,
    });
  }
}
