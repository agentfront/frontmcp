import { internalZ as z, type ZodType } from '@frontmcp/lazy-zod';

import { InvalidInputError } from '../../errors/mcp.error';
import { type ElicitOptions, type ElicitResult } from '../elicitation.types';

/**
 * The answer as the caller receives it, whatever the client sent: content only for an accepted form-mode answer,
 * and only once it matches the requested schema (a URL-mode answer's outcome reaches the server through the page).
 *
 * @throws {InvalidInputError} When accepted form-mode content does not match the requested schema
 */
export async function checkedElicitAnswer<S extends ZodType>(
  answer: ElicitResult<unknown>,
  requestedSchema: S,
  options?: ElicitOptions,
): Promise<ElicitResult<S extends ZodType<infer O> ? O : unknown>> {
  type Result = ElicitResult<S extends ZodType<infer O> ? O : unknown>;
  if (answer.status !== 'accept' || options?.mode === 'url') return { status: answer.status } as Result;
  const schema = requestedSchema instanceof z.ZodType ? requestedSchema : z.object(requestedSchema as z.ZodRawShape);
  const parsedContent = await schema.safeParseAsync(answer.content);
  if (!parsedContent.success) {
    throw new InvalidInputError(
      'The elicitation answer does not match the requested schema',
      parsedContent.error.issues,
    );
  }
  return { status: 'accept', content: parsedContent.data } as Result;
}
