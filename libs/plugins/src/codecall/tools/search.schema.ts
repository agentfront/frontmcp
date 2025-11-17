// file: libs/plugins/src/codecall/tools/search.schema.ts
import { z } from 'zod';

export const searchToolInputSchema = {

};

export type SearchToolInput = z.baseObjectInputType<typeof searchToolInputSchema>;

export const searchToolOutputSchema = z.object({}).passthrough();
export type SearchToolOutput = z.infer<typeof searchToolOutputSchema>;
