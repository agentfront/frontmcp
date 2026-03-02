/**
 * Component Module
 *
 * Polymorphic UI component loading — resolve npm packages,
 * local files, URLs, or inline functions into renderable HTML.
 *
 * @packageDocumentation
 */

// Types
export type {
  NpmSource,
  FileSource,
  ImportSource,
  FunctionSource,
  UISource,
  UIConfig,
  ComponentMeta,
  ResolvedComponent,
} from './types';

export { isNpmSource, isFileSource, isImportSource, isFunctionSource, FRONTMCP_META_KEY } from './types';

// Loader
export { resolveUISource, generateMountScript } from './loader';

// Renderer
export { renderComponent } from './renderer';
