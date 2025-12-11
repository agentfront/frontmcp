/**
 * @file core/index.ts
 * @description Core utilities for FrontMCP Web Components.
 *
 * @module @frontmcp/ui/web-components/core
 */

export { FmcpElement, type FmcpElementConfig, type FmcpRenderEventDetail } from './base-element';

export {
  parseAttributeValue,
  kebabToCamel,
  camelToKebab,
  getObservedAttributesFromSchema,
  mergeAttributeIntoOptions,
  type ParsedAttribute,
} from './attribute-parser';
