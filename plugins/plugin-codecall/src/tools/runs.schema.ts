import { z } from '@frontmcp/lazy-zod';

import { looseObjectSchema, pausedRunSchema } from './execute.schema';

const runIdSchema = z.string().length(36).describe('The runId of a codecall:execute result');

export const resumeToolDescription = `Resume a run whose codecall:execute result has "paused": it stopped before a call that did not run.
The calls before it get their recorded results without running again; the paused call runs now, then the rest of the script.
Fix the cause first: a person approves it, or send corrected "arguments" for that call only.
The answer is a codecall:execute result, which may pause again. A run resumes once; after "expiresAt" it is not found.`;

/** A codecall:execute result, listed loosely: the description says so, and execute's outputSchema lists it. */
export const resumeToolOutputSchema = z.looseObject({ status: z.string() });

export const resumeToolInputSchema = {
  runId: runIdSchema,
  arguments: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Corrected arguments for the call the run paused before; every other call keeps its own. A run paused at that call again keeps the ones sent last',
    ),
};

export type ResumeToolInput = z.infer<z.ZodObject<typeof resumeToolInputSchema>>;

export const statusToolDescription = `The status of a run: how it ended, or that it is paused before a call (and until when), or being resumed, or cancelled.`;

export const cancelToolDescription = `Cancel a paused run: it can no longer be resumed. The calls it already made keep their effects.`;

export const runIdToolInputSchema = { runId: runIdSchema };

export type RunIdToolInput = z.infer<z.ZodObject<typeof runIdToolInputSchema>>;

export const runStatusOutputSchema = z.object({
  runId: z.string(),
  /** How the run ended (a codecall:execute status), `paused`, `resuming` while a resume runs it, or `cancelled`. */
  status: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  /** The calls its journal holds. */
  calls: z.number(),
  paused: looseObjectSchema.optional(),
});

export type RunStatusOutput = Omit<z.infer<typeof runStatusOutputSchema>, 'paused'> & {
  paused?: z.infer<typeof pausedRunSchema>;
};
