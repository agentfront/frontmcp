// file: libs/browser/src/entries/index.ts
/**
 * Browser-specific entry classes.
 *
 * These extend the SDK's base entry classes with browser-specific
 * functionality like Valtio store access and component registries.
 */

export {
  BrowserToolEntry,
  type BrowserToolMetadata,
  type BrowserStore,
  type UIResourceOptions,
} from './browser-tool.entry';

export {
  BrowserResourceEntry,
  type BrowserResourceMetadata,
  type BrowserResourceTemplateMetadata,
} from './browser-resource.entry';

export { BrowserPromptEntry, type BrowserPromptMetadata } from './browser-prompt.entry';

// Built-in entries
export * from './built-in';
