import {
  AuthoritiesContextBuilder,
  AuthoritiesEngine,
  AuthoritiesEvaluatorRegistry,
  AuthoritiesProfileRegistry,
  type AuthoritiesEvaluator,
  type AuthoritiesPolicyMetadata,
  type AuthoritiesScopeMapping,
} from '@frontmcp/auth';

/** The authorities engine for `@FrontMcp({ authorities })`: its `profiles` and `evaluators`. */
export function createAuthoritiesEngine(config: Record<string, unknown>): AuthoritiesEngine {
  const profileRegistry = new AuthoritiesProfileRegistry();
  if (config['profiles']) {
    profileRegistry.registerAll(config['profiles'] as Record<string, AuthoritiesPolicyMetadata>);
  }
  const evaluatorRegistry = new AuthoritiesEvaluatorRegistry();
  if (config['evaluators']) {
    evaluatorRegistry.registerAll(config['evaluators'] as Record<string, AuthoritiesEvaluator>);
  }
  return new AuthoritiesEngine(profileRegistry, evaluatorRegistry);
}

type ContextBuilderOptions = NonNullable<ConstructorParameters<typeof AuthoritiesContextBuilder>[0]>;

/** What a scope enforces `@FrontMcp({ authorities })` with: the engine, the context builder and the scope mapping. */
export function authoritiesFromConfig(config: Record<string, unknown>): {
  engine: AuthoritiesEngine;
  contextBuilder: AuthoritiesContextBuilder;
  scopeMapping: AuthoritiesScopeMapping | undefined;
} {
  return {
    engine: createAuthoritiesEngine(config),
    contextBuilder: new AuthoritiesContextBuilder({
      claimsMapping: config['claimsMapping'] as ContextBuilderOptions['claimsMapping'],
      claimsResolver: config['claimsResolver'] as ContextBuilderOptions['claimsResolver'],
      relationshipResolver: config['relationshipResolver'] as ContextBuilderOptions['relationshipResolver'],
    }),
    scopeMapping: config['scopeMapping'] as AuthoritiesScopeMapping | undefined,
  };
}
