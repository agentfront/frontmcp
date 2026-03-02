import { GreetTool, CalculateTool, RandomNumberTool } from '../entries/tools';
import { ReadDomTool } from '../entries/dom-tool';
import { AppInfoResource, NoteResource } from '../entries/resources';
import { SummarizePrompt, CodeReviewPrompt } from '../entries/prompts';

export interface CatalogEntry<T = unknown> {
  id: string;
  name: string;
  description: string;
  entry: T;
}

export const toolCatalog: CatalogEntry[] = [
  { id: 'greet', name: 'Greet', description: 'Greet a person by name', entry: GreetTool },
  { id: 'calculate', name: 'Calculate', description: 'Math operations on two numbers', entry: CalculateTool },
  {
    id: 'random_number',
    name: 'Random Number',
    description: 'Generate a random integer in a range',
    entry: RandomNumberTool,
  },
  { id: 'read_dom', name: 'Read DOM', description: 'Read DOM elements by ID or CSS selector', entry: ReadDomTool },
];

export const resourceCatalog: CatalogEntry[] = [
  { id: 'app-info', name: 'App Info', description: 'Application metadata (app://info)', entry: AppInfoResource },
  { id: 'note', name: 'Notes', description: 'Notes by ID (notes://notes/{id})', entry: NoteResource },
];

export const promptCatalog: CatalogEntry[] = [
  { id: 'summarize', name: 'Summarize', description: 'Generate a summarization prompt', entry: SummarizePrompt },
  { id: 'code_review', name: 'Code Review', description: 'Generate a code review prompt', entry: CodeReviewPrompt },
];

export function lookupEntries(catalog: CatalogEntry[], ids: string[]): unknown[] {
  return ids.map((id) => catalog.find((c) => c.id === id)?.entry).filter(Boolean) as unknown[];
}
