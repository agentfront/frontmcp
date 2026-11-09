import type { AuthoritiesContextBuilder, AuthoritiesEngine, AuthoritiesMetadata } from '@frontmcp/auth';

import type { FrontMcpLogger } from '../common/interfaces/logger.interface';

/** Whether a listing shows an entry its `authorities` protect. A policy that throws leaves out only that entry. */
export async function isListedByAuthorities(
  engine: AuthoritiesEngine,
  contextBuilder: AuthoritiesContextBuilder,
  authorities: AuthoritiesMetadata,
  authInfo: Record<string, unknown>,
  entryName: string,
  logger?: Pick<FrontMcpLogger, 'warn'>,
): Promise<boolean> {
  try {
    const result = await engine.evaluate(authorities, contextBuilder.build(authInfo));
    return result.granted;
  } catch (error) {
    logger?.warn(
      `The authorities of "${entryName}" failed to answer, so it is left out of the list: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
